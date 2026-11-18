import i18n from './i18n.ts';
import { autoEnglish } from '../../src/shared/i18nAuto.ts';

/**
 * Compatibility fallback for legacy admin screens that still contain direct
 * Chinese JSX text. New code should use t(). This runs only in English mode and
 * translates exact static strings/attributes, never user data.
 */
function translateValue(value: string): string {
  const leading = value.match(/^\s*/)?.[0] ?? '';
  const trailing = value.match(/\s*$/)?.[0] ?? '';
  const text = value.trim();
  if (!text || !/[\u4e00-\u9fff]/.test(text)) return value;
  const dynamic = text.match(/^运行中 · PID (\d+)$/);
  const translated = dynamic ? `Running · PID ${dynamic[1]}` : autoEnglish[text];
  return translated === undefined ? value : `${leading}${translated}${trailing}`;
}

function apply(): void {
  if (!i18n.language.toLowerCase().startsWith('en')) return;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const current = node.nodeValue ?? '';
    const translated = translateValue(current);
    if (translated !== current) node.nodeValue = translated;
    node = walker.nextNode();
  }

  for (const element of document.querySelectorAll<HTMLElement>('[placeholder],[title],[aria-label]')) {
    for (const attribute of ['placeholder', 'title', 'aria-label'] as const) {
      const current = element.getAttribute(attribute);
      if (current === null) continue;
      const translated = translateValue(current);
      if (translated !== current) element.setAttribute(attribute, translated);
    }
  }
}

export function installAdminTextFallback(): () => void {
  apply();
  let timer: number | null = null;
  const observer = new MutationObserver(() => {
    if (timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      apply();
    }, 40);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  return () => observer.disconnect();
}
