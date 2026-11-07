import { useTranslation } from 'react-i18next';

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const value = i18n.resolvedLanguage ?? i18n.language;
  return (
    <select
      aria-label={t('common.language')}
      value={value}
      onChange={(event) => {
        void i18n.changeLanguage(event.target.value).then(() => window.location.reload());
      }}
      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300 outline-none"
    >
      <option value="zh-CN">中文</option>
      <option value="en-US">English</option>
    </select>
  );
}
