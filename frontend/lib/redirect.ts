export function isSafeRedirect(target: string | null, baseOrigin?: string): string | null {
    if (!target) return null;
    if (target.startsWith("//")) return null;
    try {
        const base = baseOrigin ?? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
        const url = new URL(target, base);
        if (url.origin !== base) return null;
        if (!url.pathname.startsWith('/')) return null;
        return url.pathname + (url.search || '') + (url.hash || '');
    } catch (err) {
        return null;
    }
}


