import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { viewport } from '@/app/layout';

const root = path.dirname(fileURLToPath(import.meta.url));

describe('layout viewport pinch-zoom guard (AF-012, W10-F-005)', () => {
  it('does not disable zoom via userScalable', () => {
    expect(viewport.userScalable).not.toBe(false);
  });

  it('does not set maximumScale', () => {
    expect(viewport.maximumScale).toBeUndefined();
  });

  it('locale layout source does not re-introduce maximumScale (W10-F-005)', () => {
    const localeLayoutPath = path.join(root, '..', '[locale]', 'layout.tsx');
    const source = fs.readFileSync(localeLayoutPath, 'utf8');
    expect(source).not.toMatch(/maximumScale/);
  });
});
