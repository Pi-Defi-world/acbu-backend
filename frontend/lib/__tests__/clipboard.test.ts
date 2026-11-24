import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyToClipboard } from '../clipboard';

describe('copyToClipboard', () => {
  const originalExecCommand = typeof document !== 'undefined' ? document.execCommand : undefined;

  beforeEach(() => {
    // Mock navigator.clipboard
    if (typeof navigator !== 'undefined') {
      vi.stubGlobal('navigator', {
        ...navigator,
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined),
        },
      });
    }

    vi.stubGlobal('window', { ...window, isSecureContext: true });

    // Mock document.execCommand
    if (typeof document !== 'undefined') {
      document.execCommand = vi.fn().mockReturnValue(true);
      // Mock document.createElement for the textarea fallback
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        const el = originalCreateElement(tagName);
        if (tagName === 'textarea') {
          Object.defineProperty(el, 'select', { value: vi.fn(), writable: true });
        }
        return el;
      });
      // Mock body methods
      vi.spyOn(document.body, 'appendChild').mockImplementation((el: Node) => el);
      vi.spyOn(document.body, 'removeChild').mockImplementation((el: Node) => el);
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (typeof document !== 'undefined' && originalExecCommand) {
      document.execCommand = originalExecCommand;
    }
    vi.restoreAllMocks();
  });

  it('should use navigator.clipboard.writeText when available', async () => {
    const text = 'test text';
    await copyToClipboard(text);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(text);
  });

  it('should fallback to document.execCommand in insecure contexts', async () => {
    vi.stubGlobal('window', { ...window, isSecureContext: false });
    const text = 'insecure text';
    await copyToClipboard(text);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('should fallback to document.execCommand when navigator.clipboard is missing', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined });
    const text = 'fallback text';
    await copyToClipboard(text);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('should fallback to document.execCommand when writeText fails', async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Permission denied'));
    const text = 'fallback text';
    await copyToClipboard(text);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('should throw an error if both methods fail', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined });
    (document.execCommand as ReturnType<typeof vi.fn>).mockReturnValue(false);
    await expect(copyToClipboard('fail')).rejects.toThrow('Unable to copy to clipboard');
  });
});
