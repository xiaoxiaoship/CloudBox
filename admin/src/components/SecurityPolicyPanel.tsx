import { useEffect, useMemo, useRef, useState } from 'react';
import { SecurityCountsDialog } from './SecurityCountsDialog.tsx';
import { autoT as t } from '../i18n.ts';
import { ConfirmDialog, Modal } from './Dialog.tsx';
import type { ToastState } from './Dialog.tsx';
import type { SecurityBanEntry } from '../../../src/shared/ipcTypes.ts';
import { SettingsIcon } from './Icons.tsx';

export type PolicyFeatureId =
  | 'loginFailure'
  | 'registrationLimit'
  | 'cap'
  | 'renameLimit'
  | 'concurrentSessions'
  | 'historyIpLimit'
  | 'concurrentIpLimit'
  | 'ips'
  | 'apiFlood'
  | 'globalIpBanCount'
  | 'globalAccountBanCount';

export type PolicyScope = 'ip' | 'account' | 'global';

export interface PolicyRule {
  feature: PolicyFeatureId;
  scope: PolicyScope;
  config: Record<string, number | string>;
}

export interface SecurityPolicyData {
  rules: PolicyRule[];
  savedRules: PolicyRule[];
  ipBan: { threshold: number; minutes: number };
  accountBan: { threshold: number; minutes: number };
  globalBan?: { threshold: number; recoveryMinutes: number };
  accessLists: { ipAllow: string[]; ipDeny: string[]; accountAllow: string[]; accountDeny: string[] };
}

interface FeatureDefinition {
  id: PolicyFeatureId;
  name: string;
  description: string;
  group: '通用' | '适用于 IP 与全局' | '适用于账户与全局' | '仅全局';
  scopes: PolicyScope[];
  defaults: Record<string, number | string>;
  allowCrossScopeMove?: boolean;
}

const FEATURES: FeatureDefinition[] = [
  {
    id: 'loginFailure',
    name: '登录失败限制',
    description: '统计登录失败次数，达到阈值后阻止登录。',
    group: '通用',
    scopes: ['ip', 'account'],
    defaults: { mode: 'window', windowMinutes: 15, threshold: 5, banMode: 'variable', fixedMinutes: 5, baseMinutes: 1, maxMinutes: 60 },
  },
  {
    id: 'registrationLimit',
    name: '注册量限制',
    description: '统计同一 IP 在时间窗口内成功注册的账号数。',
    group: '适用于 IP 与全局',
    scopes: ['ip'],
    defaults: { windowMinutes: 10, threshold: 2, banMinutes: 10 },
  },
  {
    id: 'cap',
    name: 'Cap 人机验证',
    description: '触发阈值后要求完成一次静默 PoW 验证。',
    group: '通用',
    scopes: ['ip', 'account'],
    defaults: { threshold: 3, mode: 'window', windowMinutes: 15 },
    allowCrossScopeMove: false,
  },
  {
    id: 'ips',
    name: 'IPS 攻击特征拦截',
    description: '命中攻击特征时仅拦截本次请求并计数，不自动封禁 IP。',
    group: '适用于 IP 与全局',
    scopes: ['ip', 'global'],
    defaults: { recordValue: 1 },
  },
  {
    id: 'renameLimit',
    name: '改名限制',
    description: '限制账户在时间窗口内的改名次数。',
    group: '适用于账户与全局',
    scopes: ['account'],
    defaults: { windowHours: 24, threshold: 1, banHours: 24 },
  },
  {
    id: 'concurrentSessions',
    name: '同时在线人数',
    description: '限制同时连接的客户端数量；IP 维度按连接数计算。',
    group: '通用',
    scopes: ['ip', 'account'],
    defaults: { max: 3, banMinutes: 5 },
  },
  {
    id: 'historyIpLimit',
    name: '历史 IP 计数限制',
    description: '限制账户在统计周期内出现过的不同登录 IP 数量。',
    group: '适用于账户与全局',
    scopes: ['account'],
    defaults: { max: 5, windowDays: 30, banMinutes: 60 },
  },
  {
    id: 'concurrentIpLimit',
    name: '同时在线 IP 量限制',
    description: '限制单个账户当前同时在线的不同 IP 数量。',
    group: '适用于账户与全局',
    scopes: ['account'],
    defaults: { max: 3, banMinutes: 5 },
  },
  {
    id: 'apiFlood',
    name: 'API 泛洪拦截',
    description: '按分钟统计 API 请求量，仅计数并触发上层全局阈值。',
    group: '通用',
    scopes: ['ip', 'account', 'global'],
    defaults: { windowMinutes: 1, threshold: 120, recordValue: 1 },
  },
  {
    id: 'globalIpBanCount',
    name: '计入 IP 全局封禁数',
    description: '仅放入全局策略时生效，把一次 IP 级触发计入全局阈值。',
    group: '仅全局',
    scopes: ['global'],
    defaults: { recordValue: 1 },
  },
  {
    id: 'globalAccountBanCount',
    name: '计入账户全局封禁数',
    description: '仅放入全局策略时生效，把一次账户级触发计入全局阈值。',
    group: '仅全局',
    scopes: ['global'],
    defaults: { recordValue: 1 },
  },
];

for (const feature of FEATURES) {
  if (feature.group !== '仅全局' && !feature.scopes.includes('global')) feature.scopes.push('global');
}

const FEATURE_BY_ID = new Map(FEATURES.map((feature) => [feature.id, feature]));
const SAVED_RULES_KEY = 'cloudbox.security.savedPolicyRules';

function scrollDragging(element: HTMLElement | null, delta: number): void {
  let current = element?.parentElement ?? null;
  while (current) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight) current.scrollBy(0, delta);
    current = current.parentElement;
  }
  const root = document.scrollingElement as HTMLElement | null;
  root?.scrollBy(0, delta);
}

function readSavedRulesFallback(): PolicyRule[] {
  try {
    const raw = localStorage.getItem(SAVED_RULES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PolicyRule[];
    return Array.isArray(parsed) ? parsed.filter((rule) => FEATURE_BY_ID.has(rule.feature)) : [];
  } catch { return []; }
}

const GROUPS: Array<'通用' | '适用于 IP 与全局' | '适用于账户与全局' | '仅全局'> = ['通用', '适用于 IP 与全局', '适用于账户与全局', '仅全局'];

export function defaultPolicy(): SecurityPolicyData {
  return {
    rules: [
      { feature: 'loginFailure', scope: 'ip', config: { recordValue: 1, mode: 'window', windowMinutes: 15, threshold: 30, banMode: 'fixed', fixedMinutes: 5, baseMinutes: 1, maxMinutes: 60 } },
      { feature: 'loginFailure', scope: 'account', config: { recordValue: 1, mode: 'window', windowMinutes: 15, threshold: 10, banMode: 'variable', fixedMinutes: 2, baseMinutes: 1, maxMinutes: 60 } },
      { feature: 'concurrentSessions', scope: 'account', config: { recordValue: 1, max: 10, banMinutes: 5 } },
      { feature: 'renameLimit', scope: 'account', config: { recordValue: 1, windowHours: 24, threshold: 3, banHours: 24 } },
      { feature: 'cap', scope: 'ip', config: { recordValue: 1, threshold: 3, mode: 'window', windowMinutes: 15 } },
      { feature: 'apiFlood', scope: 'global', config: { recordValue: 1, windowMinutes: 1, threshold: 256 } },
      { feature: 'ips', scope: 'ip', config: { recordValue: 5 } },
      { feature: 'concurrentSessions', scope: 'global', config: { recordValue: 1, max: 500, banMinutes: 5 } },
      { feature: 'registrationLimit', scope: 'ip', config: { recordValue: 1, windowMinutes: 10, threshold: 2, banMinutes: 10 } },
    ],
    savedRules: [
      { feature: 'concurrentIpLimit', scope: 'account', config: { max: 1, banMinutes: 5 } },
      { feature: 'cap', scope: 'ip', config: { threshold: 3 } },
      { feature: 'globalAccountBanCount', scope: 'global', config: { recordValue: 1 } },
    ],
    ipBan: { threshold: 10, minutes: 30 },
    accountBan: { threshold: 10, minutes: 30 },
    globalBan: { threshold: 15, recoveryMinutes: 5 },
    accessLists: { ipAllow: [], ipDeny: [], accountAllow: [], accountDeny: [] },
  };
}

export function parsePolicy(raw: string | undefined): SecurityPolicyData {
  if (!raw) return defaultPolicy();
  try {
    const parsed = JSON.parse(raw) as Partial<SecurityPolicyData>;
    return {
      rules: Array.isArray(parsed.rules) ? parsed.rules.filter((rule) => FEATURE_BY_ID.has(rule.feature)) : [],
      savedRules: Array.isArray(parsed.savedRules) ? parsed.savedRules.filter((rule) => FEATURE_BY_ID.has(rule.feature)) : [],
      ipBan: { ...defaultPolicy().ipBan, ...(parsed.ipBan ?? {}) },
      accountBan: { ...defaultPolicy().accountBan, ...(parsed.accountBan ?? {}) },
      globalBan: { ...defaultPolicy().globalBan!, ...(parsed.globalBan ?? {}) },
      accessLists: { ...defaultPolicy().accessLists, ...(parsed.accessLists ?? {}) } as SecurityPolicyData['accessLists'],
    };
  } catch {
    return defaultPolicy();
  }
}

export function serializePolicy(policy: SecurityPolicyData): string {
  return JSON.stringify(policy);
}

function ruleConfig(rule: PolicyRule): Record<string, number | string> {
  return { recordValue: 1, ...(FEATURE_BY_ID.get(rule.feature)?.defaults ?? {}), ...rule.config };
}

interface SecurityPolicyPanelProps {
  rawPolicy: string;
  onChange: (raw: string) => void;
  notify: (kind: ToastState['kind'], message: string) => void;
  accounts: Array<{ id: number; username: string; status: string; lockedUntil: number | null; renameLimitedUntil: number | null }>;
  rateLimits: Array<{ ip: string; until: number; endpoint: string }>;
  bans: SecurityBanEntry[];
  onClearBan: (id: number) => Promise<void>;
  onClearAccount: (userId: number) => void;
  onClearIp: (ip: string) => void;
  onRefresh: () => Promise<void>;
  onClearAll: () => Promise<void>;
  capSettings: { enabled: boolean; loginFailures: number; registrationLimit: number; shareLimit: number };
  onCapSettingsChange: (value: { enabled: boolean; loginFailures: number; registrationLimit: number; shareLimit: number }) => void;
}

export function SecurityPolicyPanel({
  rawPolicy,
  onChange,
  notify,
  accounts,
  rateLimits,
  bans,
  onClearBan,
  onClearAccount,
  onClearIp,
  onRefresh,
  onClearAll,
  capSettings,
  onCapSettingsChange,
}: SecurityPolicyPanelProps) {
  const policy = useMemo(() => {
    const next = parsePolicy(rawPolicy);
    if (next.savedRules.length === 0) {
      const fallback = readSavedRulesFallback();
      if (fallback.length > 0) next.savedRules = fallback;
    }
    return next;
  }, [rawPolicy]);
  const [drag, setDrag] = useState<{ feature: PolicyFeatureId; from: PolicyScope | 'saved' | null; index: number | null; origin?: PolicyScope } | null>(null);
  const [over, setOver] = useState<PolicyScope | 'saved' | null>(null);
  const [editing, setEditing] = useState<{ rule: PolicyRule; index: number; saved: boolean } | null>(null);
  const [removeCandidate, setRemoveCandidate] = useState<number | null>(null);
  const [removeSavedCandidate, setRemoveSavedCandidate] = useState<number | null>(null);
  const [bansOpen, setBansOpen] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const dropHandled = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const recordCount = (scope: PolicyScope): number => policy.rules.filter((rule) => rule.scope === scope && bans.some((ban) => ban.scope === scope && ban.feature === rule.feature)).reduce((sum, rule) => sum + Math.max(1, Number(rule.config.recordValue ?? 1)), 0);
  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      if (drag === null) return;
      const edge = 190;
      const speed = (distance: number): number => Math.min(60, Math.max(16, Math.round((edge - distance) * 0.35)));
      if (event.clientY < edge) scrollDragging(rootRef.current, -speed(event.clientY));
      else if (window.innerHeight - event.clientY < edge) scrollDragging(rootRef.current, speed(window.innerHeight - event.clientY));
    };
    const onWheel = (event: WheelEvent): void => {
      if (drag === null) return;
      scrollDragging(rootRef.current, event.deltaY);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('wheel', onWheel, { passive: true, capture: true });
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('wheel', onWheel, true);
    };
  }, [drag]);
  useEffect(() => {
    const hasCap = policy.rules.some((rule) => rule.feature === 'cap');
    if (hasCap !== capSettings.enabled) onCapSettingsChange({ ...capSettings, enabled: hasCap });
  }, [policy.rules.length, capSettings.enabled]);

  const save = (next: SecurityPolicyData): void => {
    try { localStorage.setItem(SAVED_RULES_KEY, JSON.stringify(next.savedRules)); } catch { /* ignore */ }
    const hasCap = next.rules.some((rule) => rule.feature === 'cap');
    if (hasCap !== capSettings.enabled) onCapSettingsChange({ ...capSettings, enabled: hasCap });
    onChange(serializePolicy(next));
  };
  const rulesFor = (scope: PolicyScope): PolicyRule[] => policy.rules.filter((rule) => rule.scope === scope);

  const canDrop = (feature: PolicyFeatureId, scope: PolicyScope): boolean =>
    FEATURE_BY_ID.get(feature)?.scopes.includes(scope) ?? false;

  const onDrop = (scope: PolicyScope, event: React.DragEvent): void => {
    event.preventDefault();
    setOver(null);
    const feature = event.dataTransfer.getData('text/cap-feature') as PolicyFeatureId;
    if (!feature || !FEATURE_BY_ID.has(feature)) return;
    dropHandled.current = true;
    const rules = [...policy.rules];
    const savedRules = [...policy.savedRules];
    const source = drag;
    if (!canDrop(feature, scope)) {
      notify('error', '该功能不能用于此作用域');
      return;
    }
    if (source?.from === 'saved') {
      if (source.index === null || source.origin !== scope) {
        notify('error', '已保存的选项卡只能放回原作用域');
        return;
      }
      if (rules.some((rule) => rule.feature === feature && rule.scope === scope)) {
        notify('error', '该作用域已经有此功能，不能重复添加');
        return;
      }
      const [moved] = savedRules.splice(source.index, 1);
      if (moved) rules.push({ ...moved, scope });
      save({ ...policy, rules, savedRules });
      setDrag(null);
      return;
    }
    const movingBetweenScopes = source?.from !== null && source?.from !== undefined && source.from !== scope;
    if (movingBetweenScopes && FEATURE_BY_ID.get(feature)?.allowCrossScopeMove === false) {
      notify('error', '该功能的 IP/账户配置结构不同，不能直接在两框间迁移；请从可选功能重新拖入');
      return;
    }
    const existing = rules.findIndex((rule) => rule.feature === feature && rule.scope === scope);
    if (existing >= 0) {
      setDrag(null);
      if (source?.from !== scope) notify('error', '该作用域已经有此功能，不能重复添加');
      return;
    }
    if (source?.from !== null && source?.from !== undefined && source.index !== null && source !== null) {
      const [moved] = rules.splice(source.index, 1);
      if (moved) rules.push({ ...moved, scope });
    } else {
      rules.push({ feature, scope, config: { ...(FEATURE_BY_ID.get(feature)?.defaults ?? {}) } });
    }
    save({ ...policy, rules, savedRules });
    setDrag(null);
  };

  const saveRule = (event: React.DragEvent): void => {
    event.preventDefault();
    setOver(null);
    const source = drag;
    if (source?.from === 'saved') {
      dropHandled.current = true;
      setDrag(null);
      return;
    }
    if (source === null || (source.from !== 'ip' && source.from !== 'account' && source.from !== 'global') || source.index === null) return;
    dropHandled.current = true;
    const rules = [...policy.rules];
    const savedRules = [...policy.savedRules];
    const [moved] = rules.splice(source.index, 1);
    if (moved) savedRules.push(moved);
    save({ ...policy, rules, savedRules });
    setDrag(null);
  };

  const beginDrag = (feature: PolicyFeatureId, from: PolicyScope | 'saved' | null, index: number | null, origin?: PolicyScope): void => {
    dropHandled.current = false;
    setDrag({ feature, from, index, origin: origin ?? (from === 'ip' || from === 'account' || from === 'global' ? from : undefined) });
  };

  const endDrag = (): void => {
    const source = drag;
    if (source?.from === 'saved') {
      if (!dropHandled.current && source.index !== null) setRemoveSavedCandidate(source.index);
      setDrag(null);
      setOver(null);
      return;
    }
    if (!dropHandled.current && source?.from !== null && source?.index !== null && source !== null) {
      const rule = policy.rules[source.index];
      if (rule && Object.keys(rule.config).length > 0) setRemoveCandidate(source.index);
      else removeRule(source.index);
    }
    setDrag(null);
    setOver(null);
  };

  const removeSavedRule = (index: number): void => {
    const savedRules = policy.savedRules.filter((_, ruleIndex) => ruleIndex !== index);
    save({ ...policy, savedRules });
  };

  const removeRule = (index: number): void => {
    const rules = policy.rules.filter((_, ruleIndex) => ruleIndex !== index);
    save({ ...policy, rules });
  };

  const updateRule = (index: number, config: Record<string, number | string>, saved = false): void => {
    if (saved) {
      const savedRules = policy.savedRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, config } : rule);
      save({ ...policy, savedRules });
      return;
    }
    const rules = policy.rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, config } : rule);
    save({ ...policy, rules });
  };

  const panel = (scope: PolicyScope, title: string, description: string): React.ReactNode => {
    const rules = rulesFor(scope);
    const invalid = drag !== null && (drag.from === 'saved' ? drag.origin !== scope : !canDrop(drag.feature, scope) || (drag.from !== null && drag.from !== scope && FEATURE_BY_ID.get(drag.feature)?.allowCrossScopeMove === false));
    return (
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(scope);
        }}
        onDragLeave={() => setOver((current) => current === scope ? null : current)}
        onDrop={(event) => onDrop(scope, event)}
        className={`relative min-h-48 rounded-xl border p-3 transition ${
          over === scope ? 'border-indigo-400 bg-indigo-950/20' : 'border-slate-700 bg-slate-950/40'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-200">{t(title)}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{t(description)}</p>
          </div>
          <span className="inline-flex h-5 min-w-10 items-center justify-center rounded-sm bg-slate-800 px-1.5 text-[10px] text-slate-400">{rules.length} 项</span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {rules.length === 0 ? <p className="col-span-full rounded-lg border border-dashed border-slate-800 px-3 py-6 text-center text-[11px] text-slate-600">把下方功能拖到这里启用</p> : null}
          {rules.map((rule) => {
            const definition = FEATURE_BY_ID.get(rule.feature);
            const index = policy.rules.indexOf(rule);
            return (
              <div
                key={`${rule.feature}-${rule.scope}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/cap-feature', rule.feature);
                  beginDrag(rule.feature, scope, index);
                }}
                onDragEnd={endDrag}
                className="flex items-start justify-between gap-2 rounded-lg border border-indigo-900/60 bg-indigo-950/30 px-3 py-2"
              >
                <div>
                  <p className="text-xs font-medium text-slate-200">{t(definition?.name ?? '')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing({ rule, index, saved: false })}
                  aria-label={`设置${definition?.name}`}
                  className="rounded border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800"
                >
                  <SettingsIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
        {invalid ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-950/70 text-center text-xs text-slate-300 backdrop-blur-sm">
            该功能只能用于其他作用域
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div ref={rootRef} className="space-y-4">
      <div className="rounded-xl border border-indigo-900/50 bg-indigo-950/20 px-3 py-2 text-[11px] leading-5 text-slate-300">
        <p><span className="font-medium text-indigo-200">功能限制（选项卡）</span>：只限制对应功能或占位计数，例如登录失败、注册量、改名或 Cap；其他操作仍可继续。</p>
        <p className="mt-1"><span className="font-medium text-amber-200">IP / 账户全局封禁</span>：同一目标的功能限制记录值合计达到阈值后，会清除功能限制并封禁该目标的全部操作。</p>
        <p className="mt-1 text-slate-400">{t('时间参数：填 0 = 永久；留空 = 不限制时间（仅计数）；可变封禁时间从 1 开始。')}</p>
        <p className="mt-1"><span className="font-medium text-sky-200">全局策略</span>：不区分来源与账户，按服务端整体请求计数；全局计数达到阈值会关闭 Web 服务，并可按设置的恢复间隔自动恢复。</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {panel('ip', '依据 IP', '同一来源 IP 的请求与连接。')}
        {panel('account', '依据账户', '单个登录账户的行为与设备。')}
        {panel('global', '全局策略', '不区分来源与账户，按服务端整体请求统计。')}
      </div>


      <div className="grid gap-3 sm:grid-cols-2">
        <BanSettings title="IP 封禁" count={recordCount('ip')} value={policy.ipBan} onChange={(value) => save({ ...policy, ipBan: value })} />
        <BanSettings title="账户封禁" count={recordCount('account')} value={policy.accountBan} onChange={(value) => save({ ...policy, accountBan: value })} />
      </div>

      <GlobalBanSettings value={policy.globalBan!} onChange={(value) => save({ ...policy, globalBan: value })} />


      <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
        <p className="text-xs font-medium text-slate-300">可选功能</p>
        <p className="mt-1 text-[11px] text-slate-500">按住卡片拖入上方区域；拖动时卡片会跟随鼠标。</p>
        <div
          onDragOver={(event) => { event.preventDefault(); setOver('saved'); }}
          onDragLeave={() => setOver((current) => current === 'saved' ? null : current)}
          onDrop={saveRule}
          className={`mb-3 min-h-20 rounded-xl border p-3 transition ${over === 'saved' ? 'border-amber-400 bg-amber-950/20' : 'border-dashed border-slate-700 bg-slate-950/40'}`}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-slate-300">已保存但关闭</p>
              <p className="mt-1 text-[10px] text-slate-500">从 IP/账户框拖到这里可保留配置但停用；再拖回原作用域即恢复。</p>
            </div>
            <span className="inline-flex h-5 min-w-10 items-center justify-center rounded-sm bg-slate-800 px-1.5 text-[10px] text-slate-400">{policy.savedRules.length} 项</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {policy.savedRules.length === 0 ? <p className="col-span-full rounded-lg border border-dashed border-slate-800 px-3 py-4 text-center text-[11px] text-slate-600">暂无保存的功能</p> : policy.savedRules.map((rule, index) => {
              const definition = FEATURE_BY_ID.get(rule.feature);
              return (
                <div key={rule.feature + ':' + rule.scope + ':' + index} draggable onDragStart={(event) => { event.dataTransfer.setData('text/cap-feature', rule.feature); beginDrag(rule.feature, 'saved', index, rule.scope); }} onDragEnd={endDrag} className="flex items-start justify-between gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 opacity-90">
                  <div>
                    <p className="text-xs font-medium text-slate-200">{definition?.name}</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">来源：{rule.scope === 'ip' ? '依据 IP' : rule.scope === 'account' ? '依据账户' : '全局策略'}</p>
                  </div>
                  <button type="button" onClick={() => setEditing({ rule, index, saved: true })} aria-label={'设置' + definition?.name} className="rounded border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800"><SettingsIcon className="h-3.5 w-3.5" /></button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-3 space-y-3">
          {GROUPS.map((group) => (
            <div key={group}>
              <p className="mb-2 text-[10px] uppercase tracking-wide text-slate-600">{t(group)}</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {FEATURES.filter((feature) => feature.group === group).map((feature) => (
                  <div
                    key={feature.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/cap-feature', feature.id);
                      beginDrag(feature.id, null, null);
                    }}
                    onDragEnd={endDrag}
                    className="cursor-grab rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 active:cursor-grabbing active:scale-[0.98]"
                  >
                    <p className="text-xs font-medium text-slate-200">{t(feature.name)}</p>
                    <p className="mt-1 text-[10px] leading-4 text-slate-500">{t(feature.description)}</p>
                    <p className="mt-1 text-[10px] text-indigo-400">{feature.scopes.includes('ip') && feature.scopes.includes('global') ? '适用于 IP 与全局' : feature.scopes.includes('account') && feature.scopes.includes('global') ? '适用于账户与全局' : feature.scopes.includes('ip') ? '适用于 IP' : '适用于账户'}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => void onRefresh().then(() => setBansOpen(true))} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">查看当前封禁</button>
        <button type="button" onClick={() => setListsOpen(true)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">IP / 账户黑白名单</button>
      </div>

      {listsOpen ? (
        <AccessListsDialog
          value={policy.accessLists}
          onChange={(lists) => save({ ...policy, accessLists: lists })}
          onClose={() => setListsOpen(false)}
        />
      ) : null}

      {editing !== null ? (
        <RuleSettingsDialog
          feature={FEATURE_BY_ID.get(editing.rule.feature)!}
          scope={editing.rule.scope}
          config={ruleConfig(editing.rule)}
          capSettings={capSettings}
          onCapSettingsChange={onCapSettingsChange}
          onClose={() => setEditing(null)}
          onSave={(config) => {
            updateRule(editing.index, config, editing.saved);
            setEditing(null);
            notify('success', '策略已保存');
          }}
        />
      ) : null}

      {removeSavedCandidate !== null ? (
        <ConfirmDialog
          title="删除已保存的配置？"
          description="该选项卡保存在“已保存但关闭”，拖出后会删除其配置。确定删除吗？"
          confirmLabel="确认删除"
          danger
          onClose={() => setRemoveSavedCandidate(null)}
          onConfirm={async () => {
            removeSavedRule(removeSavedCandidate);
            setRemoveSavedCandidate(null);
            notify('success', '已删除保存的配置');
          }}
        />
      ) : null}

      {removeCandidate !== null ? (
        <ConfirmDialog
          title="关闭这项安全功能？"
          description="该功能已有配置，拖出后会删除配置。确定关闭吗？"
          confirmLabel="确认关闭"
          danger
          onClose={() => setRemoveCandidate(null)}
          onConfirm={async () => {
            removeRule(removeCandidate);
            setRemoveCandidate(null);
            notify('success', '已关闭并删除配置');
          }}
        />
      ) : null}

      {bansOpen ? (
        <BansDialog
          accounts={accounts}
          rateLimits={rateLimits}
          bans={bans}
          onClearBan={onClearBan}
          onRefresh={onRefresh}
          onClearAll={onClearAll}
          onClose={() => setBansOpen(false)}
          onClearAccount={onClearAccount}
          onClearIp={onClearIp}
          notify={notify}
        />
      ) : null}
    </div>
  );
}

function BanSettings({
  title,
  count,
  value,
  onChange,
}: {
  title: string;
  count: number;
  value: { threshold: number; minutes: number };
  onChange: (value: { threshold: number; minutes: number }) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <p className="col-span-2 text-xs font-medium text-slate-300">{title}</p>
      <p className="col-span-2 text-[10px] leading-4 text-slate-500">记录值阈值 = 同一目标命中的功能限制记录值合计。达到后清除这些功能限制，并升级为全局封禁。</p>
      <label className="text-[10px] text-slate-500">记录值累计阈值
        <input type="number" min={1} max={1000} value={value.threshold} onChange={(event) => onChange({ ...value, threshold: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200" />
      </label>
      <label className="text-[10px] text-slate-500">全局封禁分钟
        <input type="number" min={0} max={10080} value={value.minutes === -1 ? '' : value.minutes} onChange={(event) => onChange({ ...value, minutes: event.target.value === '' ? -1 : Number(event.target.value) })} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200" />
      </label>
    </div>
  );
}

function GlobalBanSettings({ value, onChange }: { value: { threshold: number; recoveryMinutes: number }; onChange: (value: { threshold: number; recoveryMinutes: number }) => void }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <p className="text-xs font-medium text-slate-300">全局策略阈值</p>
      <p className="mt-1 text-[10px] leading-4 text-slate-500">全局计数累计达到阈值后自动关闭 Web 服务；恢复时间从服务被关闭后开始计算，手动开启则停止本轮恢复计时。</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-[10px] text-slate-500">全局计数阈值
          <input type="number" min={1} max={100000} value={value.threshold} onChange={(event) => onChange({ ...value, threshold: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200" />
        </label>
        <label className="text-[10px] text-slate-500">自动恢复间隔（分钟）
          <input type="number" min={0} max={100000} value={value.recoveryMinutes} onChange={(event) => onChange({ ...value, recoveryMinutes: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200" />
        </label>
      </div>
    </div>
  );
}

function RuleSettingsDialog({
  feature,
  scope,
  config,
  capSettings,
  onCapSettingsChange,
  onClose,
  onSave,
}: {
  feature: FeatureDefinition;
  scope: PolicyScope;
  config: Record<string, number | string>;
  capSettings: { enabled: boolean; loginFailures: number; registrationLimit: number; shareLimit: number };
  onCapSettingsChange: (value: { enabled: boolean; loginFailures: number; registrationLimit: number; shareLimit: number }) => void;
  onClose: () => void;
  onSave: (config: Record<string, number | string>) => void;
}) {
  const [value, setValue] = useState(config);
  const [capValue, setCapValue] = useState(capSettings);
  const set = (key: string, next: number | string): void => setValue((current) => ({ ...current, [key]: next }));
  const number = (key: string, label: string, min = 1, max = 100000, time = false): React.ReactNode => (
    <label className="text-[11px] text-slate-500">{label}
      <input type="number" min={min} max={max} value={time && value[key] === -1 ? '' : Number(value[key] ?? 0)} onChange={(event) => { if (time && event.target.value === '') set(key, -1); else set(key, Number(event.target.value)); }} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200" />
    </label>
  );
  return (
    <Modal
      title={`${t('设置')} · ${t(feature.name)}`}
      description={t(feature.description)}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">取消</button>
          <button type="button" onClick={() => { onCapSettingsChange({ ...capValue, enabled: true }); onSave(value); }} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">保存</button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {feature.id === 'loginFailure' ? (
          <>
            <label className="text-[11px] text-slate-500">统计方式
              <select value={String(value.mode ?? 'window')} onChange={(event) => set('mode', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200">
                <option value="window">按时间窗口统计</option>
                <option value="sinceUnban">距上次解封以来累计</option>
              </select>
            </label>
            {String(value.mode ?? 'window') === 'window' ? number('windowMinutes', '统计窗口（分钟）') : null}
            {number('threshold', '失败次数阈值')}
            <label className="text-[11px] text-slate-500">封禁时长方式
              <select value={String(value.banMode ?? 'variable')} onChange={(event) => set('banMode', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200">
                <option value="fixed">固定时长</option>
                <option value="variable">递增时长</option>
              </select>
            </label>
            {String(value.banMode ?? 'variable') === 'fixed' ? number('fixedMinutes', '固定封禁（分钟）', 0, 10080, true) : <>{number('baseMinutes', '首次封禁（分钟）', 1, 10080)}{number('maxMinutes', '最长封禁（分钟）', 1, 10080)}</>}
          </>
        ) : null}
        {feature.id === 'registrationLimit' ? <>{number('windowMinutes', '统计窗口（分钟）', 1, 1440)}{number('threshold', '注册数量阈值')}{number('banMinutes', '封禁（分钟）', 0, 10080, true)}</> : null}
        {feature.id === 'cap' ? <>

          <label className="text-[11px] text-slate-500">统计方式
            <select value={String(value.mode ?? 'window')} onChange={(event) => set('mode', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200">
              <option value="window">按时间窗口统计</option>
              <option value="sinceUnban">距上次解封以来累计</option>
            </select>
          </label>
          {String(value.mode ?? 'window') === 'window' ? number('windowMinutes', '统计窗口（分钟）') : null}
          <label className="text-[11px] text-slate-500">登录失败触发次数
            <input type="number" value={capValue.loginFailures} onChange={(event) => setCapValue((current) => ({ ...current, loginFailures: Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200" />
          </label>
          {scope === 'ip' ? <label className="text-[11px] text-slate-500">10 分钟注册上限
            <input type="number" value={capValue.registrationLimit} onChange={(event) => setCapValue((current) => ({ ...current, registrationLimit: Number(event.target.value) }))} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200" />
          </label> : null}
          <label className="text-[11px] text-slate-500">1 分钟分享上限
            <input type="number" value={capValue.shareLimit} onChange={(event) => setCapValue((current) => ({ ...current, shareLimit: Number(event.target.value) }))} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200" />
          </label>
        </> : null}
        {feature.id === 'ips' ? <p className="col-span-2 text-[10px] text-slate-500">命中后仅拦截当前请求并累计计数，不写入 IP 封禁。</p> : null}
        {feature.id === 'apiFlood' ? <>{number('windowMinutes', '统计窗口（分钟）', 1, 60)}{number('threshold', '窗口内请求阈值', 1, 1000000)}</> : null}
        {feature.id === 'renameLimit' ? <>{number('windowHours', '统计窗口（小时）', 1, 8760)}{number('threshold', '改名次数阈值')}{number('banHours', '封禁（小时）', 0, 8760, true)}</> : null}
        {feature.id === 'concurrentSessions' ? <>{number('max', '最大同时连接数')}{number('banMinutes', '封禁（分钟）', 0, 10080, true)}</> : null}
        {feature.id === 'historyIpLimit' ? <>{number('max', '最大不同 IP 数')}{number('windowDays', '统计周期（天）')}{number('banMinutes', '封禁（分钟）', 0, 10080, true)}</> : null}
        {feature.id === 'concurrentIpLimit' ? <>{number('max', '最大同时在线 IP 数')}{number('banMinutes', '封禁（分钟）')}</> : null}
        {number('recordValue', '触发一次记录值', 1, 1000)}
      </div>
    </Modal>
  );
}

function BansDialog({
  accounts,
  rateLimits,
  bans,
  onClearBan,
  onRefresh,
  onClearAll,
  onClose,
  onClearAccount,
  onClearIp,
  notify,
}: {
  accounts: Array<{ id: number; username: string; status: string; lockedUntil: number | null; renameLimitedUntil: number | null }>;
  rateLimits: Array<{ ip: string; until: number; endpoint: string }>;
  bans: SecurityBanEntry[];
  onClearBan: (id: number) => Promise<void>;
  onRefresh: () => Promise<void>;
  onClearAll: () => Promise<void>;
  onClose: () => void;
  onClearAccount: (userId: number) => void;
  onClearIp: (ip: string) => void;
  notify: (kind: 'success' | 'error', message: string) => void;
}) {
  const now = Date.now();
  const remainingLabel = (until: number): string => until - now > 365 * 24 * 60 * 60_000 ? '永久' : `${Math.max(1, Math.ceil((until - now) / 60_000))} 分钟`;
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [countsOpen, setCountsOpen] = useState(false);
  const legacyRenameBans = accounts
    .filter((user) => user.renameLimitedUntil !== null && user.renameLimitedUntil > now)
    .filter((user) => !bans.some((ban) => ban.scope === 'account' && (ban.target === String(user.id) || ban.target === user.username) && ban.feature === 'renameLimit'))
    .map((user) => ({ id: -user.id, scope: 'account' as const, target: String(user.id), feature: 'renameLimit', until: user.renameLimitedUntil as number, createdAt: now, legacyUserId: user.id, legacyName: user.username }));
  const featureBans = [...bans.filter((ban) => ban.feature !== 'global'), ...legacyRenameBans];
  const globalBans = bans.filter((ban) => ban.feature === 'global');
  const featureNames = [...new Map(featureBans.map((ban) => [ban.feature, FEATURE_BY_ID.get(ban.feature as PolicyFeatureId) ?? { id: ban.feature, name: ban.feature, description: '', group: '通用' as const, scopes: [] as PolicyScope[], defaults: {} }])).values()];
  const featureRows = (scope: 'ip' | 'account') => [...new Map(featureBans.filter((ban) => ban.scope === scope).map((ban) => [scope + ':' + ban.target, { scope, target: ban.target, until: ban.until, label: scope === 'account' ? accounts.find((user) => String(user.id) === ban.target)?.username ?? (ban as { legacyName?: string }).legacyName ?? ban.target : ban.target }])).values()].map((row) => ({ ...row, until: Math.max(...featureBans.filter((ban) => ban.scope === row.scope && ban.target === row.target).map((ban) => ban.until)) }));
  const globalRows = (scope: 'ip' | 'account') => globalBans.filter((ban) => ban.scope === scope);
  const accountRows = accounts.filter((user) => user.status === 'disabled' || (user.lockedUntil !== null && user.lockedUntil > now) || (user.renameLimitedUntil !== null && user.renameLimitedUntil > now));
  const featureTable = (scope: 'ip' | 'account'): React.ReactNode => {
    const rows = featureBans.filter((ban) => ban.scope === scope);
    return (
      <div>
        <p className="mb-2 text-xs font-medium text-slate-300">{scope === 'ip' ? '策略封禁 · IP' : '策略封禁 · 账户'}</p>
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full table-fixed text-left text-xs">
            <colgroup><col className="w-1/4" /><col className="w-1/4" /><col className="w-1/4" /><col className="w-1/4" /></colgroup>
            <thead className="bg-slate-950/60 text-[10px] text-slate-500"><tr><th className="px-3 py-2">目标</th><th className="px-3 py-2">功能名称</th><th className="px-3 py-2 text-center">剩余</th><th className="px-3 py-2 text-center">操作</th></tr></thead>
            <tbody className="divide-y divide-slate-800">
              {rows.length === 0 ? <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-600">暂无</td></tr> : rows.map((ban) => {
                const definition = FEATURE_BY_ID.get(ban.feature as PolicyFeatureId);
                return (
                  <tr key={(ban.id < 0 ? 'legacy-' : '') + ban.id}>
                    <td className="truncate px-3 py-2 text-slate-300">
                      <div>{scope === 'account' ? accounts.find((user) => String(user.id) === ban.target)?.username ?? (ban as { legacyName?: string }).legacyName ?? ban.target : ban.target}</div>
                      {scope === 'account' ? <div className="text-[10px] text-slate-500">ID {ban.target}</div> : null}
                    </td>
                    <td className="truncate px-3 py-2 text-slate-400">{definition?.name ?? ban.feature}</td>
                    <td className="px-3 py-2 text-center text-slate-400">{remainingLabel(ban.until)}</td>
                    <td className="px-3 py-2 text-center"><button type="button" onClick={() => { const legacyUserId = (ban as { legacyUserId?: number }).legacyUserId; void (legacyUserId ? onClearAccount(legacyUserId) : onClearBan(ban.id)); }} className="rounded border border-rose-900/60 bg-rose-950/20 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-950/40">解除</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  return (
    <>
    <Modal
      title="当前封禁"
      description="策略封禁按 IP/账户展示功能限制；目标级封禁只展示当前封禁的目标，不显示具体功能。"
      onClose={onClose}
      width="lg"
      footer={
        <div className="flex w-full justify-end gap-2">
          <button type="button" onClick={() => setConfirmClearAll(true)} className="rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-950/50">一键解封并清除所有计数</button>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">关闭</button>
        </div>
      }
    >
      <div className="mb-3 flex gap-2"><button type="button" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs text-white">封禁记录</button><button type="button" onClick={() => setCountsOpen(true)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">当前计数</button></div>
      <div className="space-y-4">
        <div className="space-y-3">
          {featureTable('ip')}
          {featureTable('account')}
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-slate-300">IP 封禁</p>
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full table-fixed text-left text-xs">
              <colgroup><col className="w-2/5" /><col className="w-1/5" /><col className="w-2/5" /></colgroup>
              <thead className="bg-slate-950/60 text-[10px] text-slate-500"><tr><th className="px-3 py-2">IP</th><th className="px-3 py-2 text-center">剩余</th><th className="px-3 py-2 text-right">操作</th></tr></thead>
              <tbody className="divide-y divide-slate-800">
                {globalRows('ip').length === 0 ? <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-600">暂无</td></tr> : globalRows('ip').map((ban) => (
                  <tr key={ban.id}><td className="px-3 py-2 font-mono text-slate-300">{ban.target}</td><td className="px-3 py-2 text-center text-slate-400">{remainingLabel(ban.until)}</td><td className="px-3 py-2 text-right"><button type="button" onClick={() => void onClearBan(ban.id)} className="rounded border border-rose-900/60 bg-rose-950/20 px-2 py-1 text-[10px] text-rose-300 hover:bg-rose-950/40">解除</button></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-slate-300">账户封禁</p>
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full table-fixed text-left text-xs">
              <colgroup><col className="w-2/5" /><col className="w-1/5" /><col className="w-2/5" /></colgroup>
              <thead className="bg-slate-950/60 text-[10px] text-slate-500"><tr><th className="px-3 py-2">账户</th><th className="px-3 py-2 text-center">剩余</th><th className="px-3 py-2 text-right">操作</th></tr></thead>
              <tbody className="divide-y divide-slate-800">
                {globalRows('account').length === 0 ? <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-600">暂无</td></tr> : globalRows('account').map((ban) => (
                  <tr key={ban.id}><td className="px-3 py-2 text-slate-300"><div>{accounts.find((user) => String(user.id) === ban.target || user.username === ban.target)?.username ?? ban.target}</div><div className="text-[10px] text-slate-500">ID {ban.target}</div></td><td className="px-3 py-2 text-center text-slate-400">{remainingLabel(ban.until)}</td><td className="px-3 py-2 text-right"><button type="button" onClick={() => void onClearBan(ban.id)} className="rounded border border-rose-900/60 bg-rose-950/20 px-2 py-1 text-[10px] text-rose-300 hover:bg-rose-950/40">解除</button></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>

      {countsOpen ? <SecurityCountsDialog onClose={() => setCountsOpen(false)} notify={notify} /> : null}
      {confirmClearAll ? (
        <ConfirmDialog
          title="确认一键解封并清零？"
          description="将清除所有 IP/账户的策略封禁，并把所有相关失败、连接、注册、Cap、改名等计数归零。此操作不可撤销。"
          confirmLabel="确认解封并清零"
          danger
          onClose={() => setConfirmClearAll(false)}
          onConfirm={async () => {
            await onClearAll();
            setConfirmClearAll(false);
          }}
        />
      ) : null}
    </>
  );
}

function AccessListsDialog({
  value,
  onChange,
  onClose,
}: {
  value: SecurityPolicyData['accessLists'];
  onChange: (value: SecurityPolicyData['accessLists']) => void;
  onClose: () => void;
}) {
  const [lists, setLists] = useState(value);
  const [scope, setScope] = useState<'ip' | 'account'>('ip');
  const [kind, setKind] = useState<'deny' | 'allow'>('deny');
  const [target, setTarget] = useState('');
  const key = (scope === 'ip' ? (kind === 'deny' ? 'ipDeny' : 'ipAllow') : (kind === 'deny' ? 'accountDeny' : 'accountAllow')) as keyof SecurityPolicyData['accessLists'];
  const rows = lists[key].map((entry, index) => ({ entry, index }));

  const update = (next: SecurityPolicyData['accessLists']): void => {
    setLists(next);
    onChange(next);
  };
  const add = (): void => {
    const normalized = target.trim();
    if (!normalized || lists[key].includes(normalized)) return;
    update({ ...lists, [key]: [...lists[key], normalized] });
    setTarget('');
  };
  const remove = (index: number): void => {
    update({ ...lists, [key]: lists[key].filter((_, rowIndex) => rowIndex !== index) });
  };

  return (
    <Modal
      title="IP / 账户黑白名单"
      description="黑名单立即拒绝访问；白名单中的目标不受全局封禁和自动策略限制。"
      onClose={onClose}
      width="lg"
      footer={<button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">关闭</button>}
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          <button type="button" onClick={() => setScope('ip')} className={`rounded-lg px-3 py-1.5 text-xs ${scope === 'ip' ? 'bg-indigo-600 text-white' : 'border border-slate-700 text-slate-300'}`}>IP 名单</button>
          <button type="button" onClick={() => setScope('account')} className={`rounded-lg px-3 py-1.5 text-xs ${scope === 'account' ? 'bg-indigo-600 text-white' : 'border border-slate-700 text-slate-300'}`}>账户名单</button>
        </div>

        <div className="grid gap-2 sm:grid-cols-[120px_1fr_auto]">
          <select value={kind} onChange={(event) => setKind(event.target.value as 'deny' | 'allow')} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200">
            <option value="deny">黑名单</option>
            <option value="allow">白名单</option>
          </select>
          <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={scope === 'ip' ? 'IP 地址，例如 192.168.1.10' : '账户名或账户 ID'} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200" />
          <button type="button" onClick={add} aria-label="添加名单规则" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">+</button>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-[10px] text-slate-500"><tr><th className="px-3 py-2">目标</th><th className="px-3 py-2">类型</th><th className="px-3 py-2 text-right">操作</th></tr></thead>
            <tbody className="divide-y divide-slate-800">
              {rows.length === 0 ? <tr><td colSpan={3} className="px-3 py-5 text-center text-slate-600">暂无规则</td></tr> : rows.map((row) => (
                <tr key={row.entry + ':' + row.index}>
                  <td className="px-3 py-2 font-mono text-slate-300">{row.entry}</td>
                  <td className="px-3 py-2 text-slate-400">{kind === 'deny' ? '黑名单' : '白名单'}</td>
                  <td className="px-3 py-2 text-right"><button type="button" onClick={() => remove(row.index)} className="rounded border border-rose-900/60 bg-rose-950/20 px-2 py-1 text-[10px] text-rose-300 hover:bg-rose-950/40">删除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
