import { useEffect, useRef, useState } from 'react';
import { PromptDialog } from './Dialog.tsx';
import { api } from '../api/client.ts';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore.ts';
import { CloudIcon, FolderIcon, GearIcon, LogoutIcon, PencilIcon, Spinner } from './Icons.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';
import { AiSettingsDialog } from './AiAssistant.tsx';
import { HostingDialog } from './HostingDialog.tsx';
import { LanguageSwitcher } from './LanguageSwitcher.tsx';

export function Header() {
  const { t } = useTranslation();
  const user = useAppStore((state) => state.user);
  const logout = useAppStore((state) => state.logout);
  const uploadAvatar = useAppStore((state) => state.uploadAvatar);
  const renameAccount = useAppStore((state) => state.renameAccount);
  const avatarInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [hostingEnabled, setHostingEnabled] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [hostingOpen, setHostingOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

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
          {aiEnabled ? (
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
          {hostingEnabled ? (
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

          <button
            type="button"
            onClick={() => setRenameOpen(true)}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label={t('header.changeUsername')}
            title={t('header.changeUsername')}
          >
            <PencilIcon className="h-4 w-4" />
          </button>

          <div className="flex min-w-0 items-center gap-2">
            <input
              ref={avatarInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                void uploadAvatar(file).catch((error: unknown) => {
                  window.alert(error instanceof Error ? error.message : t('header.avatarUploadFailed'));
                });
              }}
            />
            <button
              type="button"
              onClick={() => avatarInput.current?.click()}
              className="h-8 w-8 shrink-0 overflow-hidden rounded-full ring-2 ring-transparent transition hover:ring-indigo-400"
              title={t('header.changeAvatar')}
              aria-label={t('header.changeAvatar')}
            >
              {user?.avatarDataUrl ? (
                <img src={user.avatarDataUrl} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-500 to-sky-500 text-xs font-semibold text-white">
                  {initial || 'U'}
                </span>
              )}
            </button>
            <div className="hidden min-w-0 sm:block">
              <p className="max-w-[10rem] truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                {displayName}
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {user?.role === 'admin' ? t('header.adminRole') : t('header.userRole')}
              </p>
            </div>
          </div>

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
      {renameOpen ? (
        <PromptDialog
          title={t('header.changeUsername')}
          description={t('header.usernameChangedHint')}
          label={t('header.newUsername')}
          initialValue={user?.username ?? ''}
          confirmLabel={t('header.save')}
          onClose={() => setRenameOpen(false)}
          onSubmit={async (username) => {
            await renameAccount(username);
            setRenameOpen(false);
          }}
        />
      ) : null}
    </header>
  );
}
