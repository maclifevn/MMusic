import i18next, { init, t as i18t, changeLanguage } from 'i18next';
import { languageImporters } from 'virtual:i18n';

export const APPLICATION_NAME = 'MMusic';

const loadedLanguages = new Set<string>();

const loadLanguageResource = async (language: string) => {
  if (loadedLanguages.has(language)) return;

  const importer = languageImporters[language];
  if (!importer) return;

  const translation = await importer();
  i18next.addResourceBundle(language, 'translation', translation, true, true);
  loadedLanguages.add(language);
};

export const loadI18n = async () => {
  await init({
    resources: {},
    partialBundledLanguages: true,
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });
  await loadLanguageResource('en');
};

export const setLanguage = async (language: string) => {
  await loadLanguageResource(language);
  await changeLanguage(language);
};

export const t = i18t.bind(i18next);
