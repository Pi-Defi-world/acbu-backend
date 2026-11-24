import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatAmount, formatAcbu, setAppLocale, getAppLocale } from '../utils';

describe('formatAmount and formatAcbu locale resolution', () => {
  const originalNavigator = typeof navigator !== 'undefined' ? navigator : undefined;
  const originalDocument = typeof document !== 'undefined' ? document : undefined;

  beforeEach(() => {
    setAppLocale(undefined);
  });

  afterEach(() => {
    setAppLocale(undefined);
    vi.unstubAllGlobals();
  });

  it('formats amount with default grouping when no locale is set', () => {
    expect(formatAmount(1234567.89, 2, 'en-US')).toBe('1,234,567.89');
    expect(formatAcbu(1234567.89, 'en-US')).toBe('1,234,567.89');
  });

  it('honors the explicit locale argument passed to formatAmount and formatAcbu', () => {
    // In de-DE, period is grouping separator and comma is decimal separator
    const amountDe = formatAmount(1234567.89, 2, 'de-DE');
    expect(amountDe).toBe('1.234.567,89');

    const acbuDe = formatAcbu(1234567.89, 'de-DE');
    expect(acbuDe).toBe('1.234.567,89');
  });

  it('threads active app locale set via setAppLocale', () => {
    setAppLocale('de-DE');
    expect(getAppLocale()).toBe('de-DE');

    expect(formatAmount(1234567.89, 2)).toBe('1.234.567,89');
    expect(formatAcbu(1234567.89)).toBe('1.234.567,89');

    // Explicit locale should still override app locale
    expect(formatAmount(1234567.89, 2, 'en-US')).toBe('1,234,567.89');
  });

  it('defaults to route locale on document.documentElement.lang when no app locale or argument passed', () => {
    vi.stubGlobal('document', {
      documentElement: {
        lang: 'de-DE',
      },
    });

    expect(formatAmount(1234567.89, 2)).toBe('1.234.567,89');
    expect(formatAcbu(1234567.89)).toBe('1.234.567,89');
  });

  it('prefers appLocale over document.documentElement.lang', () => {
    vi.stubGlobal('document', {
      documentElement: {
        lang: 'de-DE',
      },
    });
    setAppLocale('en-US');

    expect(formatAmount(1234567.89, 2)).toBe('1,234,567.89');
    expect(formatAcbu(1234567.89)).toBe('1,234,567.89');
  });

  it('handles null, undefined, empty and invalid numbers gracefully', () => {
    expect(formatAmount(null)).toBe('—');
    expect(formatAmount(undefined)).toBe('—');
    expect(formatAmount('')).toBe('—');
    expect(formatAmount('not-a-number')).toBe('—');

    expect(formatAcbu(null)).toBe('—');
    expect(formatAcbu(undefined)).toBe('—');
    expect(formatAcbu('')).toBe('—');
    expect(formatAcbu('abc')).toBe('—');
  });
});
