import { ChevronRightIcon } from './Icons.tsx';
import { useTranslation } from 'react-i18next';

interface BreadcrumbsProps {
  path: string;
  disabled?: boolean;
  onNavigate: (path: string) => void;
}

export function Breadcrumbs({ path, disabled = false, onNavigate }: BreadcrumbsProps) {
  const { t } = useTranslation();
  const segments = path === '' ? [] : path.split('/');

  return (
    <nav aria-label="路径导航" className="flex flex-wrap items-center gap-0.5 text-sm">
      <button
        type="button"
        onClick={() => onNavigate('')}
        disabled={disabled}
        className={`rounded-md px-1.5 py-0.5 transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800 ${
          segments.length === 0
            ? 'font-medium text-slate-900 dark:text-slate-100'
            : 'text-slate-500 dark:text-slate-400'
        }`}
      >
        {t('files.root')}
      </button>

      {segments.map((segment, index) => {
        const target = segments.slice(0, index + 1).join('/');
        const isLast = index === segments.length - 1;

        return (
          <span key={target} className="flex items-center gap-0.5">
            <ChevronRightIcon className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" />
            <button
              type="button"
              onClick={() => onNavigate(target)}
              disabled={disabled}
              className={`max-w-[10rem] truncate rounded-md px-1.5 py-0.5 transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800 ${
                isLast
                  ? 'font-medium text-slate-900 dark:text-slate-100'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
              title={segment}
            >
              {segment}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
