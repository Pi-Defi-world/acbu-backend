import { describe, expect, it } from 'vitest';
import { buildChartStyleSheet } from '../chart-style';

const THEMES = { light: '', dark: '.dark' };

describe('buildChartStyleSheet', () => {
  it('emits one block per theme with the colour variables', () => {
    const { css, dropped } = buildChartStyleSheet('chart-1', THEMES, [
      { key: 'desktop', theme: { light: '#111', dark: '#eee' } },
    ]);

    expect(css).toContain('[data-chart="chart-1"]');
    expect(css).toContain('--color-desktop: #111;');
    expect(css).toContain('.dark [data-chart="chart-1"]');
    expect(css).toContain('--color-desktop: #eee;');
    expect(dropped).toEqual([]);
  });

  it('falls back to the single colour for themes without a specific value', () => {
    const { css } = buildChartStyleSheet('chart-1', THEMES, [
      { key: 'desktop', color: '#abc' },
    ]);

    expect(css?.match(/--color-desktop: #abc;/g)).toHaveLength(2);
  });

  it('quotes and escapes the chart id', () => {
    const { css } = buildChartStyleSheet('«r1»"', THEMES, [
      { key: 'a', color: '#fff' },
    ]);

    expect(css).toContain('[data-chart="«r1»\\""]');
  });

  it('normalizes keys that are not valid custom property names', () => {
    const { css } = buildChartStyleSheet('c', THEMES, [
      { key: 'a b;c', color: '#fff' },
    ]);

    expect(css).toContain('--color-a-b-c: #fff;');
    expect(css).not.toContain(';c:');
  });

  it('drops values that could escape the declaration', () => {
    const { css, dropped } = buildChartStyleSheet('c', THEMES, [
      { key: 'evil', color: 'red; } body { display: none } /*' },
    ]);

    expect(css).toBeNull();
    expect(dropped).toEqual(['evil']);
  });

  it.each([
    ['url(javascript:alert(1))'],
    ['</style><script>alert(1)</script>'],
    ['red\\}'],
    ['var(--x) { color: red }'],
  ])('rejects %s', (color) => {
    const { css, dropped } = buildChartStyleSheet('c', THEMES, [
      { key: 'evil', color },
    ]);

    expect(css).toBeNull();
    expect(dropped).toEqual(['evil']);
  });

  it('keeps valid values while dropping only the unsafe ones', () => {
    const { css, dropped } = buildChartStyleSheet('c', THEMES, [
      { key: 'safe', color: '#0f0' },
      { key: 'themed', theme: { light: 'var(--chart-1)', dark: 'oklch(0.7 0.1 200)' } },
      { key: 'evil', color: 'red; } html { opacity: 0 }' },
    ]);

    expect(css).toContain('--color-safe: #0f0;');
    expect(css).toContain('--color-themed: oklch(0.7 0.1 200);');
    expect(css).not.toContain('opacity');
    expect(dropped).toEqual(['evil']);
  });

  it('returns null when no colours are configured', () => {
    expect(buildChartStyleSheet('c', THEMES, [])).toEqual({
      css: null,
      dropped: [],
    });
  });

  it('trims surrounding whitespace from values', () => {
    const { css } = buildChartStyleSheet('c', THEMES, [
      { key: 'a', color: '  #abc  ' },
    ]);

    expect(css).toContain('--color-a: #abc;');
  });
});
