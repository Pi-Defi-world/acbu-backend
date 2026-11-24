import { logger } from '@/lib/logger';

/**
 * Reusable utility to copy text to the clipboard.
 * Supports both modern Clipboard API and fallback for non-secure origins.
 */
export async function copyToClipboard(text: string): Promise<void> {
  // 1. Try modern Clipboard API if available (requires secure context)
  if (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    navigator.clipboard.writeText
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      // If Clipboard API fails (e.g. user denied permission), fall through to fallback
      logger.warn('Clipboard API failed, falling back to legacy method', err);
    }
  }

  // 2. Fallback: document.execCommand('copy') using a hidden textarea
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    
    // Prevent scrolling to the bottom and keep it hidden
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    textarea.setAttribute('readonly', ''); // Prevent keyboard on mobile
    
    document.body.appendChild(textarea);
    
    try {
      textarea.select();
      textarea.setSelectionRange(0, 99999); // For mobile
      
      const successful = document.execCommand('copy');
      if (!successful) {
        throw new Error('execCommand returned false');
      }
    } catch (err) {
      logger.error('Fallback copy failed', err);
      throw new Error('Unable to copy to clipboard', { cause: err });
    } finally {
      document.body.removeChild(textarea);
    }
    return;
  }

  throw new Error('Clipboard environment not available');
}
