# Backend and Reserve Disaster Recovery Runbook

This runbook covers loss of the API, primary database, cache/queue services, or a reserve partner. It does not authorize moving customer funds. Incident command must record the incident ID, UTC timestamps, operator, approvals, and every action in the incident log.

## Recovery objectives and authority

Before production launch, service owners must approve and publish per-system RPO/RTO targets, primary and backup operators, provider support contacts, and the current reserve/contract addresses. Do not infer a recovery point from a recent successful deployment. The treasury owner and security lead approve reserve actions; the database owner approves data restoration; incident command approves traffic cutover.

## Declare, contain, and assess

1. Open an incident, page the service and treasury owners, and preserve provider alerts, audit logs, transaction hashes, and deployment identifiers.
2. For suspected compromise or reserve discrepancy, pause new minting/redemptions using the documented contract/admin controls. Verify the pause on-chain from an independent RPC. Do not rotate or export signing keys on an affected workstation.
3. Check API health, PostgreSQL, MongoDB Atlas, Redis, RabbitMQ, Stellar RPC, custodian status, and the reserve tracker. Compare partner statements and on-chain balances with the latest `ReserveHistory` and contract events. Record discrepancies; do not “repair” ledger rows to make balances agree.

## Restore data services

Restore into an isolated environment first. Use the provider's point-in-time restore for managed PostgreSQL and MongoDB Atlas, selecting a timestamp before the incident and recording the backup ID and selected point. For PostgreSQL exports, use an encrypted, access-controlled destination and verify the archive before restore:

```sh
pg_dump --format=custom --no-owner "$DATABASE_URL" --file "$BACKUP_FILE"
pg_restore --list "$BACKUP_FILE"
```

Restore into a new database/cluster, never over the production source during validation. Run migrations in the documented order, verify schema drift, row counts, latest transaction and reserve-history records, and application-level invariants. MongoDB restores must preserve the required collections and indexes; verify document counts and representative records before cutover.

Redis is a cache/session store, not the financial source of truth. Prefer a clean cache after recovery; invalidate sessions and require re-authentication if integrity is uncertain. Export RabbitMQ definitions before changing topology. Recreate exchanges, durable queues, bindings, and dead-letter routes from the approved definitions; reconcile persistent/unacknowledged messages against database transaction IDs before replay. Replay is idempotency-key guarded and must not repeat a payment or reserve mutation.

## Reserve partner or custody incident

1. Confirm affected currencies, custodian, last statement time, pending transfers, and the contract's on-chain reserve balance from independent sources.
2. Freeze new exposure to the affected partner and follow the treasury risk register's approved fallback. The global Stellar USDC buffer is not a like-currency secondary reserve; disclose FX and liquidity risk and do not promise par recovery from it.
3. Require two-person approval for any transfer or contract administration. Verify destination, asset, amount, network, and multisig threshold out of band. Never place seed phrases, secret keys, or recovery shares in this runbook, tickets, shell history, or chat.
4. Reconcile provider statements, bank/custodian confirmations, on-chain events, contract state, and database records. Treasury signs the reconciliation before customer operations resume.

## Validate and cut over

Run health checks, read-only API checks, queue-consumer checks, contract read calls, and reserve reconciliation in the isolated environment. The service owner records actual recovery point/time and deviations from the approved objectives. Incident command approves a staged traffic cutover; monitor error rates, queue depth, database lag, and reserve ratio. Resume minting/redemptions only after treasury and security sign off and the on-chain pause state is independently verified.

## Required rehearsal record

Rehearse before mainnet and at least quarterly. Record date, participants, scenario, backup/restore identifiers, measured RPO/RTO, reconciliation result, failed steps, remediation owner, and sign-off in the incident archive. A runbook review alone is not a successful recovery drill.
