import { beforeEach, describe, expect, it, vi } from 'vitest';
import { post } from './client';
import { signin, verify2fa } from './auth';

vi.mock('./client', () => ({
  post: vi.fn(),
}));

const mockedPost = vi.mocked(post);

describe('auth wallet custody response contract', () => {
  beforeEach(() => {
    mockedPost.mockReset();
  });

  it('does not expose private-key material from the sign-in response', async () => {
    mockedPost.mockResolvedValue({
      user_id: 'user-1',
      stellar_address: 'GABC',
      wallet_created: true,
      passphrase: 'SSECRET',
      encryptedStellarSecret: 'ciphertext',
    });

    await expect(signin('alice', 'account-passcode')).resolves.toEqual({
      user_id: 'user-1',
      stellar_address: 'GABC',
      wallet_created: true,
    });
  });

  it('does not expose private-key material from two-factor verification', async () => {
    mockedPost.mockResolvedValue({
      user_id: 'user-1',
      passphrase: 'SSECRET',
      encryptedStellarSecret: 'ciphertext',
    });

    await expect(verify2fa('challenge', '123456')).resolves.toEqual({
      user_id: 'user-1',
    });
  });
});