import { describe, expect, it, vi } from 'vitest';
import { del } from './client';
import { deleteMe } from './user';

vi.mock('./client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

describe('deleteMe', () => {
  it('sends DELETE to the authenticated user endpoint', async () => {
    await deleteMe();

    expect(del).toHaveBeenCalledWith('/users/me', undefined);
  });
});