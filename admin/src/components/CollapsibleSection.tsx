import { Children, useState, type ReactNode } from 'react';
import { autoT as t } from '../i18n.ts';

/**
 * Collapsible admin card. The existing card header is kept as the first child;
 * only the body is hidden, so status badges and switches stay visible.
 */
export function CollapsibleSection({
  children,
  defaultOpen = false,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const parts = Children.toArray(children);
  const [head, ...body] = parts;
  return (
    <section className="relative rounded-2xl border border-slate-800 bg-slate-900/60 p-5 pr-14">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="absolute right-4 top-4 rounded-lg px-2 py-1 text-[11px] text-slate-500 transition hover:bg-slate-800 hover:text-slate-300"
      >
        {open ? t('收起') : t('展开')}
      </button>
      <div className={open ? '' : '[&_[role=switch]]:hidden [&_p.text-slate-500]:hidden [&_p.text-slate-400]:hidden'}>{head}</div>
      {open ? body : null}
    </section>
  );
}
