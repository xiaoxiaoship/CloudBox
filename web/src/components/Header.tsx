import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore.ts';
import { BellIcon, CloudIcon, FolderIcon, GearIcon, LogoutIcon, Spinner } from './Icons.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';
import { AiSettingsDialog } from './AiAssistant.tsx';
import { HostingDialog } from './HostingDialog.tsx';
import { LanguageSwitcher } from './LanguageSwitcher.tsx';
import { UserSettingsDialog } from './UserSettingsDialog.tsx';
import { AnnouncementPanel } from './AnnouncementPanel.tsx';
import type { AnnouncementView } from '../api/client.ts';

export function Header() {
  const { t } = useTranslation();
  const user = useAppStore((state) => state.user);
  const securityMode = user?.securityMode === true;
  const logout = useAppStore((state) => state.logout);

  const [pending, setPending] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [hostingEnabled, setHostingEnabled] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [hostingOpen, setHostingOpen] = useState(false);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const [announcementsOpen, setAnnouncementsOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<AnnouncementView[]>([]);
  const [unreadAnnouncements, setUnreadAnnouncements] = useState(0);

  useEffect(() => {
    let active = true;
    const loadAnnouncements = async (): Promise<void> => {
      try {
        const result = await api.announcements();
        if (!active) return;
        setAnnouncements(result.items);
        setUnreadAnnouncements(result.unread);
      } catch { /* ignore */ }
    };
    void loadAnnouncements();
    const timer = window.setInterval(() => { void loadAnnouncements(); }, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const openAnnouncements = (): void => {
    setAnnouncementsOpen(true);
    setUnreadAnnouncements(0);
    void api.markAnnouncementsRead().catch(() => {});
  };

  useEffect(() => {
    void api
      .publicSettings()
      .then((settings) => {
        setAiEnabled(settings.ai_enabled);
        setHostingEnabled(settings.hosting_enabled);
      })
      .catch(() => {});
  }, []);

  const displayName = user ? user.displayName || user.username : '';
  const initial = displayName.slice(0, 1).toUpperCase();

  const handleLogout = async (): Promise<void> => {
    setPending(true);
    try {
      await logout();
    } finally {
      setPending(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
            <CloudIcon className="h-5 w-5" />
          </div>
          <span className="truncate text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            CloudBox
          </span>
          <span className="ml-1 hidden rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400 sm:inline">
            {t('header.myDrive')}
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <LanguageSwitcher />
          {!securityMode && aiEnabled ? (
            <button
              type="button"
              onClick={() => setAiSettingsOpen(true)}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              aria-label={t('header.aiSettings')}
              title={t('header.aiSettings')}
            >
              <GearIcon className="h-4 w-4" />
            </button>
          ) : null}
          {!securityMode && hostingEnabled ? (
            <button
              type="button"
              onClick={() => setHostingOpen(true)}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              aria-label={t('header.hostingSettings')}
              title={t('header.hostingSettings')}
            >
              <FolderIcon className="h-4 w-4" />
            </button>
          ) : null}

          <div className={`flex min-w-0 items-center gap-2 ${securityMode ? 'hidden' : ''}`}>
            <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full ring-2 ring-transparent">
              {user?.avatarDataUrl ? (
                <img src={user.avatarDataUrl} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-500 to-sky-500 text-xs font-semibold text-white">
                  {initial || 'U'}
                </span>
              )}
            </div>
            <div className="hidden min-w-0 sm:block">
              <p className="max-w-[10rem] truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                {displayName}
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {user?.role === 'admin' ? t('header.adminRole') : t('header.userRole')}
              </p>
            </div>
          </div>

          <button type="button" onClick={openAnnouncements} className="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800" title="公告" aria-label="公告">
            <BellIcon className="h-4 w-4" />
            {unreadAnnouncements > 0 ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white dark:ring-slate-950" /> : null}
          </button>

          <button
            type="button"
            onClick={() => setUserSettingsOpen(true)}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            title="用户设置"
          >
            <GearIcon className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            title={t('header.logout')}
          >
            {pending ? <Spinner className="h-4 w-4" /> : <LogoutIcon className="h-4 w-4" />}
            <span className="hidden sm:inline">{t('header.logoutShort')}</span>
          </button>
        </div>
      </div>
      {aiSettingsOpen ? <AiSettingsDialog onClose={() => setAiSettingsOpen(false)} /> : null}
      {hostingOpen ? <HostingDialog onClose={() => setHostingOpen(false)} /> : null}
      {userSettingsOpen ? <UserSettingsDialog onClose={() => setUserSettingsOpen(false)} /> : null}
      {announcementsOpen ? <AnnouncementPanel items={announcements} onClose={() => setAnnouncementsOpen(false)} /> : null}
    </header>
  );
}
