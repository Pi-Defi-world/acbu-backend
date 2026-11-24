import DOMPurify from "dompurify";

/**
 * Sanitizes HTML strings using DOMPurify to prevent XSS.
 * Must only be called on the client side (DOMPurify requires a DOM).
 */
export function sanitizeHtml(dirty: string): string {
  if (typeof window === "undefined") return "";
  return DOMPurify.sanitize(dirty, { USE_PROFILES: { html: true } });
}
