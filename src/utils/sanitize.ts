/**
 * Input sanitization for API requests: trim, length limit, strip HTML-like content.
 */
const MAX_STRING_LENGTH = 10000;
const HTML_LIKE = /<[^>]*>/g;

export function sanitizeString(value: unknown, maxLength: number = MAX_STRING_LENGTH): string {
  if (value == null) return "";
  const s = String(value).replace(HTML_LIKE, "").trim();
  return s.length > maxLength ? s.slice(0, maxLength) : s;
}
