import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from '../../src/shared/locales/zh-CN.json';
import enUS from '../../src/shared/locales/en-US.json';
import { autoEnglish } from '../../src/shared/i18nAuto.ts';

const stored = localStorage.getItem('cloudbox.language');
const detected = (navigator.language || '').toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN';

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS },
  },
  lng: stored ?? detected,
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (language) => {
  localStorage.setItem('cloudbox.language', language);
  document.documentElement.lang = language;
});

document.documentElement.lang = i18n.language;

export default i18n;

export function autoT(key: string, options?: Record<string, unknown>): string {
  if (/[\u4e00-\u9fff]/.test(key)) {
    if (!i18n.language.toLowerCase().startsWith('en')) return key;
    let text = autoEnglish[key] ?? key;
    if (options) {
      for (const [name, value] of Object.entries(options)) {
        text = text.split(`{{${name}}}`).join(String(value));
      }
    }
    return text;
  }
  return String(i18n.t(key, options as never));
}
