import { en } from "./locales/en";
import enMessages from "@/i18n/messages/en.json";

type TranslationValue = string | Record<string, unknown>;
type Translations = Record<string, TranslationValue>;

// Locales that read right-to-left
const RTL_LOCALES = new Set(["ar", "he", "fa", "ur", "ps", "sd", "ug", "yi"]);

export function isRTL(locale: string): boolean {
  return RTL_LOCALES.has(locale);
}

export function getDir(locale: string): "rtl" | "ltr" {
  return isRTL(locale) ? "rtl" : "ltr";
}

const locales: Record<string, Translations> = {
  en: {
    ...(enMessages as unknown as Translations),
    ...(en as unknown as Translations),
    mint: {
      ...(enMessages.mint as unknown as Record<string, unknown>),
      ...(en.mint as unknown as Record<string, unknown>),
    },
  },
};

export { RTL_LOCALES };

export function registerLocale(
  locale: string,
  translations: Translations,
): void {
  locales[locale] = translations;
}

export function setLocale(locale: string): void {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("acbu_locale", locale);
    } catch {
      // Storage unavailable
    }
    // Also persist as a cookie so the locale middleware can read it on the
    // server side (localStorage is not accessible in middleware).
    // 1-year TTL, SameSite=Lax, not httpOnly so JS can update it here.
    try {
      const maxAge = 60 * 60 * 24 * 365;
      document.cookie = `NEXT_LOCALE=${encodeURIComponent(locale)}; path=/; max-age=${maxAge}; SameSite=Lax`;
    } catch {
      // Cookie write unavailable
    }
  }
}

export function getStoredLocale(): string {
  if (typeof window !== "undefined") {
    try {
      return localStorage.getItem("acbu_locale") || "en";
    } catch {
      // Storage unavailable
    }
  }
  return "en";
}

export function t(
  path: string,
  params?: Record<string, string | number>,
): string {
  const locale = getStoredLocale();
  const keys = path.split(".");
  let result: unknown = locales[locale];
  for (const key of keys) {
    if (result && typeof result === "object") {
      result = (result as Record<string, unknown>)[key];
    } else {
      result = undefined;
      break;
    }
  }
  if (typeof result !== "string") {
    result = path;
  }
  if (params) {
    result = (result as string).replace(/\{(\w+)\}/g, (_, key) =>
      params[key] !== undefined ? String(params[key]) : `{${key}}`,
    );
  }
  return result as string;
}
