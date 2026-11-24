/**
 * Returns the correct plural form for a count in the given locale.
 * Falls back to locale from document if not specified.
 *
 * Usage:
 *   plural(count, { one: '# session', other: '# sessions' }, 'en')
 *   plural(count, { one: '# сессия', few: '# сессии', many: '# сессий', other: '# сессии' }, 'ru')
 */
export function plural(
  count: number,
  forms: Partial<Record<Intl.LDMLPluralRule, string>>,
  locale?: string,
): string {
  const rule = new Intl.PluralRules(locale).select(count);
  const template = forms[rule] ?? forms.other ?? String(count);
  return template.replace('#', String(count));
}
