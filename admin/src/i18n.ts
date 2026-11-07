import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from '../../src/shared/locales/zh-CN.json';
import enUS from '../../src/shared/locales/en-US.json';

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
