import { describe, it, expect } from 'vitest';
import { isSafeRedirect } from '../redirect';

describe('isSafeRedirect', () => {
    it('allows relative paths', () => {
        expect(isSafeRedirect('/me', 'http://localhost')).toBe('/me');
        expect(isSafeRedirect('/me?x=1#h', 'http://localhost')).toBe('/me?x=1#h');
    });

    it('rejects external absolute urls', () => {
        expect(isSafeRedirect('https://evil.com', 'http://localhost')).toBeNull();
        expect(isSafeRedirect('http://other.example.com/path', 'http://localhost')).toBeNull();
    });

    it('rejects protocol-relative urls', () => {
        expect(isSafeRedirect('//evil.com', 'http://localhost')).toBeNull();
    });

    it('allows same-origin absolute urls', () => {
        expect(isSafeRedirect('http://localhost/me', 'http://localhost')).toBe('/me');
    });

    it('rejects malformed urls', () => {
        expect(isSafeRedirect('\\\not a url', 'http://localhost')).toBeNull();
    });
});
