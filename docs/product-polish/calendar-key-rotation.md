# Calendar credential key rotation

This is an operator procedure for the implemented configuration. Local tests use fictional keys; no live key has been rotated.

## Configuration

- `CALENDAR_TOKEN_ENCRYPTION_KEY`: active base64-encoded 32-byte key.
- `CALENDAR_TOKEN_ENCRYPTION_KEY_VERSION`: positive integer version; defaults to 1.
- `CALENDAR_TOKEN_ENCRYPTION_PREVIOUS_KEYS`: JSON object mapping previous version numbers to their retained base64 keys. Keep this in the secret manager, never Git or logs.

New ciphertext uses `v2.<key-version>.<iv>.<authentication-tag>.<body>`. The format and key version are authenticated. Original `v1` ciphertext is read as key version 1. A missing previous key or invalid ciphertext fails closed.

## Reviewed rollout

1. Inventory non-empty connection ciphertext and version metadata using staging administrative access. Include inactive connections; only active connections migrate through reconciliation.
2. Preserve the existing key as its previous version in the secret manager. Generate a new 32-byte key and select a new, never-reused version number.
3. Deploy the active key/version and retained previous-key map together. All workers must share that configuration. Do not replace a key while keeping its version number.
4. Verify old-format decryption, new connection creation, refresh and reconciliation in staging before the live rollout. Reconciliation re-encrypts old active credentials without forcing a provider refresh. It conditionally saves only if the active connection still has the original credential snapshot, and records `calendar.credentials_reencrypted` without token/key values.
5. Verify that non-empty ciphertext has migrated to the active version. A failed or inactive connection requires review/reconnection; do not assume the daily worker migrated it. Repeated reconciliation creates no extra rotation event for current ciphertext.
6. Keep previous keys until all stored ciphertext using them has been migrated or explicitly cleared, including encrypted cleanup snapshots in `calendar_subscription` background jobs. Disconnect clears the connection credential but can retain an encrypted cleanup snapshot; disconnection alone is not evidence that its encryption key can be retired. All outstanding OAuth state lifetimes must also have expired. State currently expires after ten minutes. Confirm deployment completion across workers before retiring a key.

## Verification and rollback

The `encryption_key_version` column is updated by new connections, refresh and re-encryption. Compare it with the ciphertext header; legacy ciphertext belongs to version 1 even if historical metadata is incorrect. Never print ciphertext or decrypted credentials for verification.

Rollback must preserve access to both old and new ciphertext. Restoring an old application/configuration that understands only `v1` cannot read newly written `v2` credentials. Use a version-aware release and retain all needed keys; verify in staging first. Losing a required key requires owner reconnection rather than recovery of the encrypted token.

Webhook signing uses its own secret and is outside this encryption procedure. Subscription renewal/cleanup and actual provider acceptance remain separate release requirements.
