/**
 * Build the `<style>` payload that the chart primitive injects into the document.
 *
 * shadcn/ui's chart helper interpolates theme prefixes, the chart id and the
 * configured colour strings straight into a stylesheet. That is fine while every
 * value comes from app-authored config, but it is one user-influenced value away
 * from letting `}` / `</style>` / `url(...)` escape the declaration and inject
 * arbitrary CSS. This module keeps the same output shape while escaping the
 * identifier parts and refusing values that could break out of a declaration.
 */

export type ChartStyleThemes = Record<string, string>;

export interface ChartStyleColorEntry {
  /** Key used for the generated `--color-<key>` custom property. */
  key: string;
  /** Per-theme values, e.g. `{ light: '#fff', dark: '#000' }`. */
  theme?: Record<string, string | undefined>;
  /** Fallback value used for every theme without a specific one. */
  color?: string | undefined;
}

export interface ChartStyleSheet {
  /** The stylesheet text, or `null` when nothing colour-related is configured. */
  css: string | null;
  /** Keys whose value was rejected, for diagnostics. */
  dropped: string[];
}

/**
 * Characters that cannot appear in a colour value without ending the
 * declaration, escaping the rule, or loading a resource.
 */
const UNSAFE_CSS_VALUE = /[;{}<>@\\]|\/\*|\*\/|url\s*\(|expression\s*\(/i;

function isSafeColorValue(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !UNSAFE_CSS_VALUE.test(trimmed);
}

/** Escape a value for use inside a double-quoted CSS string. */
function escapeCssString(value: string): string {
  let escaped = '';

  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;

    if (char === '\\' || char === '"') {
      escaped += `\\${char}`;
    } else if (code < 0x20 || code === 0x7f) {
      escaped += `\\${code.toString(16)} `;
    } else {
      escaped += char;
    }
  }

  return escaped;
}

/** Restrict a config key to characters that are valid in a custom property name. */
function normalizeCustomPropertyName(key: string): string {
  const normalized = key.replace(/[^a-zA-Z0-9_-]/g, '-');
  return /^[0-9]/.test(normalized) ? `-${normalized}` : normalized;
}

export function buildChartStyleSheet(
  id: string,
  themes: ChartStyleThemes,
  colors: ChartStyleColorEntry[],
): ChartStyleSheet {
  if (colors.length === 0) {
    return { css: null, dropped: [] };
  }

  const selector = `[data-chart="${escapeCssString(id)}"]`;
  const dropped = new Set<string>();
  const blocks: string[] = [];

  for (const [theme, prefix] of Object.entries(themes)) {
    const declarations: string[] = [];

    for (const entry of colors) {
      const value = entry.theme?.[theme] ?? entry.color;

      if (!value) continue;

      if (!isSafeColorValue(value)) {
        dropped.add(entry.key);
        continue;
      }

      declarations.push(
        `  --color-${normalizeCustomPropertyName(entry.key)}: ${value.trim()};`,
      );
    }

    if (declarations.length > 0) {
      blocks.push(`${prefix} ${selector} {\n${declarations.join('\n')}\n}`);
    }
  }

  return {
    css: blocks.length > 0 ? `${blocks.join('\n')}\n` : null,
    dropped: [...dropped],
  };
}
