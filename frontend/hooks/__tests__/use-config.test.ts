import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAssetsConfig, clearAssetsConfigCache } from '@/lib/api/config';
import { useConfig, clearConfigCache } from '../use-config';

vi.mock('@/lib/api/config', () => ({
  getAssetsConfig: vi.fn(),
  clearAssetsConfigCache: vi.fn(),
}));

const config = {
  acbu: { code: 'ACBU', issuer: null },
  demo_fiat: { issuer: null },
  stellar: {
    network_passphrase: 'Test SDF Network ; September 2015',
    horizon_url: null,
  },
};

describe('useConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not mark the cache fresh when the request resolves after unmount', async () => {
    let resolveRequest: (value: typeof config) => void = () => undefined;
    vi.mocked(getAssetsConfig).mockImplementation(
      () => new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const first = renderHook(() => useConfig());
    first.unmount();

    await act(async () => {
      resolveRequest(config);
    });

    vi.mocked(getAssetsConfig).mockResolvedValue(config);
    renderHook(() => useConfig());

    expect(getAssetsConfig).toHaveBeenCalledTimes(2);
  });

  it('clearConfigCache clears module-level cachedAt and underlying config cache', () => {
    clearConfigCache();
    expect(clearAssetsConfigCache).toHaveBeenCalledTimes(1);
  });
});