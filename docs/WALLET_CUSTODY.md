# Wallet Key Custody Model

Documents how user Stellar keys are generated, stored and used (W10-SEC-006).

## Summary

User wallets are self-custodied. The backend generates no keypair, never
receives a private key, and keeps no material it can turn back into one. Spend
authority for a user's balance lives only in the user's wallet.

The platform key (`STELLAR_SECRET_KEY`) is a separate treasury/operator key. It
authorises platform operations (account activation, contract mint/drip calls)
and is not a signer for user accounts. See [STELLAR_SECURITY.md](./STELLAR_SECURITY.md)
for the treasury operation restrictions.

## Lifecycle

1. **Generation** — the client creates the keypair with the Stellar SDK
   (`Keypair.random()` in the wallet app) and stores the secret locally, in the
   device secure enclave / encrypted storage. The secret is shown to the user
   once, for their own backup.
2. **Enrollment** — the client sends only the public key:
   `POST /v1/users/me/wallet/enroll` with `{ "stellar_address": "G..." }` and the
   current wallet `If-Match` ETag. Sign-in tells the client this step is still
   needed through `wallet_enrollment_required: true`; it no longer returns any
   key material.
3. **Optional cloud backup** — the client may also send `wrapped_key`, a
   base64 blob it encrypted with a secret the API never sees, together with the
   `wrap_algorithm` and `wrap_kdf` identifiers it used. The server stores the
   blob verbatim as an opaque value; the metadata exists so the client knows how
   to open its own backup. There is no server-side decryption function, and
   `assertClientWrappedBackup()` rejects anything that still looks like a Stellar
   secret seed, raw or base64-encoded, so a client bug cannot park a plaintext
   key in the database.
4. **Rotation / detach** — `PUT /v1/users/me/wallet` binds a different public
   address (clearing any stored backup); `DELETE /v1/users/me/wallet` detaches
   the wallet.

## What the backend stores

| Column | Content |
| --- | --- |
| `users.stellarAddress` | Public key only. |
| `users.encrypted_stellar_secret` | Client-encrypted backup, or `NULL`. Never decryptable server-side. |
| `users.key_encryption_hint` | `client_wrapped` (backup present) or `external` (address only). |

## Operations the client must perform

Because the backend cannot sign as the user, these are client-submitted
transactions against Horizon:

- `change_trust` for ACBU and for each demo fiat asset before a mint or faucet
  drip. The API answers with `Missing trustline for <code>:<issuer>. Add the
  trustline from your own wallet, then retry.` rather than signing for the user.
- Payments and any other operation moving a user's own balance.
- Recovery of a lost key: only the user's own backup can do it. A client
  re-enrolls the address it holds a key for.

## Legacy data

Earlier builds generated the keypair during sign-in, returned it in plaintext,
and stored it encrypted under a key derived from the login passcode — a passcode
the API receives on every request, so the backend could always recover the
secret. `20261018000000_wipe_backend_decryptable_wallet_secrets` deletes those
blobs, and the code paths that created or read them (`ensureWalletForUser`,
`POST /v1/users/me/wallet/confirm`, `decryptUserStellarSecret`,
`trustlineService`) are removed. Users with a legacy blob must re-enroll the key
their wallet already holds.

## Regression guards

`tests/walletCustody.test.ts` enforces the invariants statically: no server-side
keypair generation, no passcode-derived key encryption, no endpoint that returns
a secret, and no import of the removed decryption module.
