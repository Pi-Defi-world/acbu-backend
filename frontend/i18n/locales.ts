export const locales = ['en', 'en-NG', 'en-KE', 'ar', 'ru', 'pl'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export const localeMetadata: Record<Locale, { label: string; dir: 'ltr' | 'rtl' }> = {
  en: { label: 'English', dir: 'ltr' },
  'en-NG': { label: 'English (Nigeria)', dir: 'ltr' },
  'en-KE': { label: 'English (Kenya)', dir: 'ltr' },
  ar: { label: 'العربية', dir: 'rtl' },
  ru: { label: 'Русский', dir: 'ltr' },
  pl: { label: 'Polski', dir: 'ltr' },
};
