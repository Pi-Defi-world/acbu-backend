import { describe, it, expect } from 'vitest';
import { validateEnv } from '../env-safety';

describe('validateEnv', () => {
  it('should pass with valid public env vars', () => {
    const env = {
      NEXT_PUBLIC_API_URL: 'https://api.example.com',
      NEXT_PUBLIC_BILLS_ENABLED: 'true',
    };
    expect(() => validateEnv(env)).not.toThrow();
  });

  it('should fail with blocked secret-like public env vars', () => {
    const env = {
      NEXT_PUBLIC_DATABASE_URL: 'postgres://user:password@localhost:5432/db',
    };
    expect(() => validateEnv(env)).toThrow(/Build failed/);
  });

  it('should fail with mixed-case edge cases', () => {
    const env = {
      NEXT_PUBLIC_jwt_secret: 'super-secret-key',
    };
    expect(() => validateEnv(env)).toThrow(/Build failed/);
  });
});
