import { describe, it, expect } from 'vitest';
import { parseUtcDate, formatAmount, formatAcbu } from '../utils';

describe('parseUtcDate', () => {
  it('should parse ISO strings with Z suffix correctly', () => {
    const dateStr = '2026-05-28T01:17:35Z';
    const date = parseUtcDate(dateStr);
    expect(date.toISOString()).toBe('2026-05-28T01:17:35.000Z');
  });

  it('should parse ISO strings with offset suffix correctly', () => {
    const dateStr = '2026-05-28T02:17:35+01:00';
    const date = parseUtcDate(dateStr);
    expect(date.toISOString()).toBe('2026-05-28T01:17:35.000Z');
  });

  it('should parse UTC strings without suffix correctly by forcing Z', () => {
    const dateStr = '2026-05-28 01:17:35';
    const date = parseUtcDate(dateStr);
    expect(date.toISOString()).toBe('2026-05-28T01:17:35.000Z');
  });

  it('should return a valid Date when passed null or undefined', () => {
    const date1 = parseUtcDate(null);
    expect(date1).toBeInstanceOf(Date);
    const date2 = parseUtcDate(undefined);
    expect(date2).toBeInstanceOf(Date);
  });
});

describe('formatAmount and formatAcbu locale resolution', () => {

  it('formats amount according to explicit locale', () => {
    // In 'de-DE' or 'pl', thousands separator is '.' or space, decimal is ','
    const formatted = formatAmount(1234567.89, 2, 'de-DE');
    expect(formatted).toMatch(/1\.234\.567,89/);
  });

  it('formats amount according to document lang when no locale passed', () => {
    const originalLang = document.documentElement.getAttribute('lang');
    try {
      document.documentElement.setAttribute('lang', 'fr-FR');
      // In French, thousands separator is a non-breaking space (or narrow NBSP), decimal is comma
      const formatted = formatAmount(1234567.89, 2);
      expect(formatted).toMatch(/1[\s\u00A0\u202F]234[\s\u00A0\u202F]567,89/);
    } finally {
      if (originalLang) {
        document.documentElement.setAttribute('lang', originalLang);
      } else {
        document.documentElement.removeAttribute('lang');
      }
    }
  });

  it('formats ACBU amounts properly with 7 max decimals', () => {
    const formatted = formatAcbu(1234.56, 'en-US');
    expect(formatted).toBe('1,234.56');
  });
});
