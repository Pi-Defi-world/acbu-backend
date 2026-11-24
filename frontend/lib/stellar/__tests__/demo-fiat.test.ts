import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEMO_FIAT_ISSUER,
  acbuAsset,
  isAcbuAssetIssuerConfigured,
  resolveAcbuAssetIssuer,
} from '../demo-fiat';

/** A valid Stellar account id that is not the bundled demo issuer. */
const OTHER_ISSUER =
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveAcbuAssetIssuer', () => {
  it('uses the configured issuer when one is present', () => {
    expect(
      resolveAcbuAssetIssuer({
        NEXT_PUBLIC_ACBU_ASSET_ISSUER: OTHER_ISSUER,
        NODE_ENV: 'production',
      }),
    ).toBe(OTHER_ISSUER);
  });

  it('trims surrounding whitespace from the configured issuer', () => {
    expect(
      resolveAcbuAssetIssuer({
        NEXT_PUBLIC_ACBU_ASSET_ISSUER: `  ${OTHER_ISSUER}\n`,
        NODE_ENV: 'production',
      }),
    ).toBe(OTHER_ISSUER);
  });

  it('falls back to the bundled demo issuer outside production', () => {
    expect(resolveAcbuAssetIssuer({ NODE_ENV: 'development' })).toBe(
      DEMO_FIAT_ISSUER,
    );
    expect(resolveAcbuAssetIssuer({ NODE_ENV: 'test' })).toBe(DEMO_FIAT_ISSUER);
    expect(resolveAcbuAssetIssuer({})).toBe(DEMO_FIAT_ISSUER);
  });

  it('refuses the demo fallback in production', () => {
    expect(() => resolveAcbuAssetIssuer({ NODE_ENV: 'production' })).toThrow(
      /NEXT_PUBLIC_ACBU_ASSET_ISSUER/,
    );
  });

  it('treats blank values as unset', () => {
    expect(() =>
      resolveAcbuAssetIssuer({
        NEXT_PUBLIC_ACBU_ASSET_ISSUER: '   ',
        NODE_ENV: 'production',
      }),
    ).toThrow(/NEXT_PUBLIC_ACBU_ASSET_ISSUER/);
  });
});

describe('isAcbuAssetIssuerConfigured', () => {
  it('reports whether an issuer was pinned', () => {
    expect(isAcbuAssetIssuerConfigured({})).toBe(false);
    expect(
      isAcbuAssetIssuerConfigured({ NEXT_PUBLIC_ACBU_ASSET_ISSUER: '  ' }),
    ).toBe(false);
    expect(
      isAcbuAssetIssuerConfigured({
        NEXT_PUBLIC_ACBU_ASSET_ISSUER: OTHER_ISSUER,
      }),
    ).toBe(true);
  });
});

describe('acbuAsset', () => {
  it('builds the ACBU asset from the configured issuer', () => {
    vi.stubEnv('NEXT_PUBLIC_ACBU_ASSET_ISSUER', OTHER_ISSUER);

    const asset = acbuAsset();

    expect(asset.getCode()).toBe('ACBU');
    expect(asset.getIssuer()).toBe(OTHER_ISSUER);
  });

  it('falls back to the demo issuer outside production', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXT_PUBLIC_ACBU_ASSET_ISSUER', '');

    const asset = acbuAsset();

    expect(asset.getCode()).toBe('ACBU');
    expect(asset.getIssuer()).toBe(DEMO_FIAT_ISSUER);
  });

  it('throws rather than targeting the demo issuer in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_ACBU_ASSET_ISSUER', '');

    expect(() => acbuAsset()).toThrow(/NEXT_PUBLIC_ACBU_ASSET_ISSUER/);
  });
});
