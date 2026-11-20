-- Migration: 20261018000000_wipe_backend_decryptable_wallet_secrets
-- W10-SEC-006.
--
-- Secrets stored with key_encryption_hint = 'passcode' were encrypted with
-- scrypt(passcode, 'acbu-wallet-v1:<userId>'), and the passcode itself transits
-- the API on every sign-in. That made the blob recoverable by whoever runs the
-- backend, so a stolen database plus an observed sign-in exposed user funds.
--
-- The decryption path is gone from the application; the blobs must not outlive
-- it. Affected users re-enroll the key their wallet already holds through
-- POST /v1/users/me/wallet/enroll (see docs/WALLET_CUSTODY.md).
UPDATE "users"
SET "encrypted_stellar_secret" = NULL,
    "key_encryption_hint" = NULL
WHERE "key_encryption_hint" = 'passcode'
  AND "encrypted_stellar_secret" IS NOT NULL;
