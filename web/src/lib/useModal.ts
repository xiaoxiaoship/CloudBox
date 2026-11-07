import { useEffect } from 'react';

/** 弹窗/预览打开时锁定 body 滚动，关闭后恢复 */
export function useLockBodyScroll(active = true): void {
  useEffect(() => {
    if (!active) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}

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
