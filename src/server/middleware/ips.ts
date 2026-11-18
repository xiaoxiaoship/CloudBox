import { createRequire } from 'node:module';
import type { Request, RequestHandler, Response } from 'express';
import type { CoreServices } from '../../core/container.ts';

const require = createRequire(process.cwd() + '/package.json');

interface BuiltinRule {
  id: string;
  name: string;
  category: string;
  pattern: string;
  flags?: string;
  severity?: string;
  enabled?: boolean;
}

interface IpsRule {
  id: string;
  name: string;
  category: string;
  pattern: RegExp;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

const wafRules = require('@mertcanureten/node-waf/lib/rules/builtin.json') as BuiltinRule[];

const rules: IpsRule[] = wafRules
  .filter((rule) => rule.enabled !== false && ['xss', 'sqli'].includes(rule.category))
  .map((rule) => ({
    id: `waf:${rule.id}`,
    name: rule.name,
    category: rule.category,
    pattern: new RegExp(rule.pattern, rule.flags ?? 'gi'),
    severity: (rule.severity as IpsRule['severity']) ?? 'high',
  }));

// Supplemental OWASP-style signatures for categories not covered by the
// node-waf built-in pack: traversal, command injection and scanner crawlers.
rules.push(
  {
    id: 'owasp:path-traversal',
    name: 'Path traversal / local file inclusion',
    category: 'lfi',
    pattern: /(?:\.\.[/\\]|%2e%2e(?:%2f|%5c|\/|\\)|\/etc\/(?:passwd|shadow)|\/proc\/self\/environ|\bwin\.ini\b)/i,
    severity: 'critical',
  },
  {
    id: 'owasp:command-injection',
    name: 'OS command injection',
    category: 'cmdi',
    pattern: /(?:;\s*(?:cat|ls|curl|wget|bash|sh|powershell|cmd)\b|\|\s*(?:cat|ls|curl|wget|bash|sh)\b|\$\((?:cat|id|whoami|uname)\b|`(?:cat|id|whoami|uname)\b)/i,
    severity: 'critical',
  },
  {
    id: 'scanner:user-agent',
    name: 'Malicious scanner / crawler user-agent',
    category: 'scanner',
    pattern: /\b(?:sqlmap|nikto|nmap|masscan|acunetix|nessus|dirbuster|gobuster|zgrab|jaeles|wpscan|nuclei)\b/i,
    severity: 'high',
  },
);

function inspectString(value: string): { rule: IpsRule; payload: string } | null {
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(value)) {
      return { rule, payload: value.slice(0, 100) };
    }
  }
  return null;
}

function inspectValue(value: unknown, depth = 0): { rule: IpsRule; payload: string } | null {
  if (depth > 6 || value === null || value === undefined) return null;
  if (typeof value === 'string') return inspectString(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = inspectValue(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = inspectValue(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function shouldSkip(req: Request): boolean {
  const pathname = req.path;
  if (pathname === '/health' || pathname.startsWith('/health/')) return true;
  // Never inspect raw multipart/binary upload or download streams.
  if ((req.headers['content-type'] ?? '').toLowerCase().startsWith('multipart/form-data')) return true;
  return (
    pathname === '/api/files/upload' ||
    pathname === '/api/files/download' ||
    pathname === '/api/files/preview/content' ||
    pathname === '/api/public/s'
  );
}

export function createIpsMiddleware(services: CoreServices): RequestHandler {
  return (req: Request, res: Response, next) => {
    if (services.settings.get('security.mode') !== 'advanced' || !services.securityPolicy.rule('ips', 'ip') || shouldSkip(req)) {
      next();
      return;
    }

    const ip = req.ip ?? 'unknown';
    if (services.securityPolicy.isAllowed('ip', ip)) {
      next();
      return;
    }
    const candidates: unknown[] = [req.url, req.headers['user-agent']];
    for (const value of Object.values(req.query)) candidates.push(value);
    if (req.body !== undefined && typeof req.body !== 'string') {
      candidates.push(req.body);
    } else if (typeof req.body === 'string') {
      candidates.push(req.body);
    }

    let hit: { rule: IpsRule; payload: string } | null = null;
    for (const candidate of candidates) {
      hit = inspectValue(candidate);
      if (hit) break;
    }

    if (!hit) {
      next();
      return;
    }

    services.audit.record({
      actorType: 'anonymous',
      actorId: null,
      action: 'security.ips.block',
      result: 'denied',
      targetType: 'ip',
      targetId: ip,
      targetPath: req.path,
      ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      detail: {
        severity: 'critical',
        rule: hit.rule.id,
        ruleName: hit.rule.name,
        category: hit.rule.category,
        payload: hit.payload,
      },
    });

    const ipsRule = services.securityPolicy.rule('ips', 'ip');
    services.securityPolicy.addCount('ip', ip, 'ips', Math.max(1, Number(ipsRule?.config.recordValue ?? 1)));
    services.events.emit('security.limit', { category: 'IPS 攻击特征拦截', scope: 'ip', target: ip, feature: 'ips', featureName: 'IPS 攻击特征拦截', remainingMinutes: 0, message: '检测到攻击特征，已拦截本次请求并计数' });
    res.status(403).json({
      code: 'SECURITY_BLOCKED',
      action: 'security_blocked',
      feature: 'ips',
      message: '⚠️ 检测到恶意攻击请求，本次请求已被拦截',
    });
  };
}
