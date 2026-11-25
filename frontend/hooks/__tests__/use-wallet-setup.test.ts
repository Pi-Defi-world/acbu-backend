import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWalletSetup } from '../use-wallet-setup';

// Mock dependencies
const mockRefreshStellarAddress = vi.fn();
const mockOpenModal = vi.fn();
const mockSetWallet = vi.fn();
const mockGetAddress = vi.fn();

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({
    userId: 'user-123',
    stellarAddress: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7',
    refreshStellarAddress: mockRefreshStellarAddress,
    logout: vi.fn(),
  }),
}));

vi.mock('@/lib/stellar-wallets-kit', () => ({
  useStellarWalletsKit: () => ({
    openModal: mockOpenModal,
    setWallet: mockSetWallet,
    getAddress: mockGetAddress,
  }),
}));

vi.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    fromSecret: vi.fn((secret: string) => {
      if (secret === 'invalid-seed') {
        throw new Error('Invalid secret seed');
      }
      return {
        publicKey: () => secret.startsWith('S_DIFF')
          ? 'GDIFFERENTADDRESS1234567890123456789012345678901234567890'
          : 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7',
        secret: () => secret,
      };
    }),
    random: vi.fn(() => ({
      secret: () => 'SSECRET12345678901234567890123456789012345678901234567890',
      publicKey: () => 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7',
    })),
  },
}));

vi.mock('@/lib/api/user', () => ({
  putWalletAddress: vi.fn().mockResolvedValue({ ok: true, stellar_address: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7' }),
  postWalletConfirm: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/lib/wallet-storage', () => ({
  storeWalletSecret: vi.fn().mockResolvedValue(undefined),
  getWalletSecretAnyLocal: vi.fn(),
}));

vi.mock('@/lib/passcode-manager', () => ({
  getPasscode: vi.fn().mockReturnValue('123456'),
}));

import * as userApi from '@/lib/api/user';
import * as walletStorage from '@/lib/wallet-storage';
import * as passcodeManager from '@/lib/passcode-manager';

describe('useWalletSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(passcodeManager.getPasscode).mockReturnValue('123456');
    vi.mocked(userApi.putWalletAddress).mockResolvedValue({ ok: true, stellar_address: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7' });
    vi.mocked(userApi.postWalletConfirm).mockResolvedValue({ ok: true });
  });

  it('generateWallet creates a new keypair and syncs to backend', async () => {
    const validSecret = 'S_MATCH_SECRET';
    const expectedPubKey = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';

    const { result } = renderHook(() => useWalletSetup());

    let res: { secret: string; publicKey: string } = { secret: '', publicKey: '' };
    await act(async () => {
      res = await result.current.generateWallet(validSecret);
    });

    expect(res.secret).toBe(validSecret);
    expect(res.publicKey).toBe(expectedPubKey);
    expect(userApi.putWalletAddress).toHaveBeenCalledWith(expectedPubKey, undefined);
    expect(walletStorage.storeWalletSecret).toHaveBeenCalledWith('user-123', validSecret, '123456');
    expect(userApi.postWalletConfirm).toHaveBeenCalledWith({ wallet_address: expectedPubKey }, undefined);
  });

  it('importWallet validates seed and syncs to backend', async () => {
    const secret = 'S_MATCH_SECRET';
    const pubKey = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';

    const { result } = renderHook(() => useWalletSetup());

    let res: { publicKey: string } = { publicKey: '' };
    await act(async () => {
      res = await result.current.importWallet(secret);
    });

    expect(res.publicKey).toBe(pubKey);
    expect(userApi.putWalletAddress).toHaveBeenCalledWith(pubKey, undefined);
    expect(walletStorage.storeWalletSecret).toHaveBeenCalledWith('user-123', secret, '123456');
  });

  it('importWallet throws on invalid seed format', async () => {
    const { result } = renderHook(() => useWalletSetup());

    await expect(result.current.importWallet('invalid-seed')).rejects.toThrow();
  });

  it('connectExternalWallet opens kit modal and updates wallet address', async () => {
    const externalPubKey = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';
    mockOpenModal.mockImplementationOnce(async ({ onWalletSelected }: { onWalletSelected: (opt: { id: string }) => Promise<void> }) => {
      await onWalletSelected({ id: 'freighter' });
    });
    mockGetAddress.mockResolvedValueOnce({ address: externalPubKey });

    const { result } = renderHook(() => useWalletSetup());

    let res: { publicKey: string } = { publicKey: '' };
    await act(async () => {
      res = await result.current.connectExternalWallet();
    });

    expect(res.publicKey).toBe(externalPubKey);
    expect(mockSetWallet).toHaveBeenCalledWith('freighter');
    expect(userApi.putWalletAddress).toHaveBeenCalledWith(externalPubKey, undefined);
  });

  it('connectExternalWallet rejects when modal is dismissed', async () => {
    mockOpenModal.mockImplementationOnce(async ({ onClosed }: { onClosed?: (err?: Error) => void }) => {
      if (onClosed) {
        onClosed(new Error('User closed modal'));
      }
    });

    const { result } = renderHook(() => useWalletSetup());

    await act(async () => {
      await expect(result.current.connectExternalWallet()).rejects.toThrow('User closed modal');
    });
  });

  it('getWalletSigner returns local secret when matching secret exists', async () => {
    const secret = 'S_MATCH_SECRET';
    vi.mocked(walletStorage.getWalletSecretAnyLocal).mockResolvedValueOnce(secret);

    const { result } = renderHook(() => useWalletSetup());

    let signer;
    await act(async () => {
      signer = await result.current.getWalletSigner();
    });

    expect(signer).toEqual({
      userSecret: 'S_MATCH_SECRET',
      address: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7',
    });
  });

  it('getWalletSigner rejects when modal is dismissed for external wallet', async () => {
    vi.mocked(walletStorage.getWalletSecretAnyLocal).mockResolvedValueOnce(null);
    mockOpenModal.mockImplementationOnce(async ({ onClosed }: { onClosed?: (err?: Error) => void }) => {
      if (onClosed) {
        onClosed(new Error('User closed modal'));
      }
    });

    const { result } = renderHook(() => useWalletSetup());

    await act(async () => {
      await expect(result.current.getWalletSigner()).rejects.toThrow('User closed modal');
    });
  });

  it('getWalletSigner throws error when local wallet does not match stellarAddress', async () => {
    const secret = 'S_DIFF_SECRET';
    vi.mocked(walletStorage.getWalletSecretAnyLocal).mockResolvedValueOnce(secret);

    const { result } = renderHook(() => useWalletSetup());

    await expect(result.current.getWalletSigner()).rejects.toThrow(/doesn't match/);
  });
});
