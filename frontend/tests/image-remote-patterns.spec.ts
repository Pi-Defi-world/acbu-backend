import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const nextConfig = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8');

describe('Next image remote patterns', () => {
  it('does not configure a wildcard hostname', () => {
    expect(nextConfig).not.toMatch(/hostname:\s*['"]\*['"]/);
    expect(nextConfig).toContain('new URL(process.env.NEXT_PUBLIC_API_BASE_URL).hostname');
  });
});
