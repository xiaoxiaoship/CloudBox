import { useTranslation } from 'react-i18next';

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const value = i18n.resolvedLanguage ?? i18n.language;
  return (
    <select
      aria-label={t('common.language')}
      value={value}
      onChange={(event) => void i18n.changeLanguage(event.target.value)}
      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
    >
      <option value="zh-CN">中文</option>
      <option value="en-US">English</option>
    </select>
  );
}
