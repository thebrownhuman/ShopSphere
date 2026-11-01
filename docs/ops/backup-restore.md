# Backups and restore drill (M7.6)

Targets (PRD §10): **RPO 5 min, RTO 30 min.** Everything here runs locally on docker-compose;
"S3" is the SeaweedFS container (`infra/docker-compose.yml`, bucket `backups`, private under
`infra/seaweedfs/s3.json`). Scripts: `infra/backup/` (bash; Git Bash on Windows works).

| Script | Does |
|---|---|
| `backup.sh [db]` | `pg_dump -Fc -Z 6` inside the Postgres container → `s3://backups/postgres/<db>/<UTC ts>.dump`, updates `postgres/<db>/LATEST`, keeps the newest `KEEP` (288 = 24 h at 5 min) dumps |
| `backup-loop.sh [db]` | runs `backup.sh` every `INTERVAL` seconds (default 300) — the RPO mechanism |
| `restore.sh <key\|latest> <container> <db>` | downloads a dump and `pg_restore`s it (drops/recreates the target db; refuses the live container unless `CONFIRM=yes`) |
| `restore-drill.sh [db]` | exact row count per table on the source → backup → **fresh `postgres:16-alpine` container** → restore → recount → diff; prints RPO/RTO, removes the container; exits non-zero on any mismatch |

Env overrides: `PG_CONTAINER` (default `shopsphere-postgres-1`), `S3_URL`, `S3_BUCKET`,
`S3_ACCESS_KEY`/`S3_SECRET_KEY`, `KEEP`, `INTERVAL`. Uploads are SigV4-signed with plain `curl`
(`--aws-sigv4`, curl ≥ 7.75), so no AWS CLI image is needed.

## Drill result (2026-11-01, laptop, Docker Desktop)

```
$ infra/backup/restore-drill.sh shopsphere_perf
backup shopsphere_perf: 39492695 bytes -> s3://backups/postgres/shopsphere_perf/20261101T200939Z.dump in 3s
DRILL PASS db=shopsphere_perf tables=70 rows=495072 key=postgres/shopsphere_perf/20261101T200939Z.dump backup_age_at_restore_s=4 rto_s=11
```

`shopsphere_perf` is the load-test database after the M7.5 runs (≈ 5k products, 21k offers,
24k orders with items, shipments, payments, outbox and events) — the largest local dataset.
Every one of the 70 tables matched exactly.

| | Target | Achieved locally | Notes |
|---|---|---|---|
| RPO | 5 min | **≤ 5 min + dump time (~3 s)** with `backup-loop.sh` at `INTERVAL=300` | worst case = a failure just before the next dump |
| RTO | 30 min | **11 s** from "start fresh container" to verified restore (17 s wall clock including the backup) | 40 MB dump; restore time grows ~linearly with data size |

## What this does not cover (honest gaps)

- **WAL archiving / PITR is not set up.** RPO rests on 5-minute logical dumps. Point-in-time
  recovery needs `archive_mode=on` + `archive_command` (or `wal-g`/`pgBackRest` to S3), which
  means restarting the shared compose Postgres with new flags; deferred to the managed-database
  setup (RDS/Cloud SQL give PITR with ~5 min RPO out of the box).
- `pg_dump` of a large production database takes minutes and adds load; at that size use
  physical backups (base backup + WAL) rather than shortening the dump interval.
- The loop is a foreground script, not a service. In a deployed environment run it as a cron /
  Kubernetes CronJob and alert when `LATEST` is older than 10 minutes.
- Multi-AZ failover (part of M7.6 in the plan) needs a cloud database; nothing to drill on one
  laptop.
- Object storage (SeaweedFS: product images, invoices, review photos) is not backed up by these
  scripts; on S3 use versioning + cross-region replication.

## Restore runbook (real incident)

1. Stop writers (scale API + workers to 0) so nothing writes to the broken database.
2. Fresh Postgres (new container/instance), then:
   `infra/backup/restore.sh latest <new-container> shopsphere`
3. Check row counts of hot tables against what you expect (`orders`, `payments`,
   `ledger_entries`), then run `corepack pnpm --filter @shopsphere/api db:deploy` (applies any
   migration newer than the dump).
4. Point `DATABASE_URL` at the new instance, start the API and workers.
5. Payments captured after the dump: run reconciliation
   (`POST /payments/internal/reconcile`) — the gateway is the source of truth for money; it
   recreates missing captures/refunds from the provider's records.
