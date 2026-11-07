import { useEffect, useState, type ReactNode } from 'react';
import { AlertIcon, CheckIcon, Spinner, XIcon } from './Icons.tsx';

export function useEscapeKey(handler: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') handler();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handler, active]);
}

interface ModalProps {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  width?: 'md' | 'lg';
}

export function Modal({ title, description, onClose, children, footer, width = 'md' }: ModalProps) {
  useEscapeKey(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${
          width === 'lg' ? 'max-w-2xl' : 'max-w-md'
        } animate-fade-in overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/50`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">{title}</h2>
            {description ? (
              <div className="mt-1 text-sm text-slate-400">{description}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300"
            aria-label="关闭"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-slate-800 bg-slate-950/40 px-5 py-3">
          {footer}
        </div>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = '确认',
  danger = false,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={pending ? () => {} : onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={pending}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-60 ${
              danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-indigo-600 hover:bg-indigo-500'
            }`}
          >
            {pending ? <Spinner className="h-4 w-4" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm leading-6 text-slate-300">{description}</div>
      {error ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </Modal>
  );
}

export type ToastKind = 'success' | 'error';

export interface ToastState {
  kind: ToastKind;
  message: string;
}

export function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  return (
    <div className="animate-fade-in fixed bottom-5 right-5 z-[60] flex max-w-sm items-start gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm shadow-2xl">
      {toast.kind === 'success' ? (
        <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
      ) : (
        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
      )}
      <span className="flex-1 text-slate-200">{toast.message}</span>
      <button
        type="button"
        onClick={onClose}
        className="rounded p-0.5 text-slate-500 transition hover:text-slate-300"
        aria-label="关闭提示"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
