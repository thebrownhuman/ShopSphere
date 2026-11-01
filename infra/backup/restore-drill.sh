#!/usr/bin/env bash
# M7.6 restore drill: back up a database, restore it into a FRESH Postgres 16 container, and verify
# exact row counts table by table. Prints RPO (age of the restored backup) and RTO (fresh container
# to verified restore), then removes the drill container. Exit 0 only when every count matches.
#   infra/backup/restore-drill.sh [db=shopsphere]
# Row counts are taken from the source right before the dump; run it while that database is quiet
# (the dev db), or counts written in between show up as mismatches.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
DB=${1:-shopsphere}
DRILL=shopsphere-restore-drill
work=$(mktemp -d)
trap 'docker rm -f "$DRILL" > /dev/null 2>&1 || true; rm -rf "$work"' EXIT

log "1/4 source row counts ($DB)"
row_counts "$PG_CONTAINER" "$DB" > "$work/source.txt"
log "2/4 backup"
backup_at=$(date +%s)
key=$("$(dirname "$0")/backup.sh" "$DB")

log "3/4 fresh container + restore (RTO clock starts)"
rto_start=$(date +%s)
docker rm -f "$DRILL" > /dev/null 2>&1 || true
docker run -d --name "$DRILL" -e POSTGRES_USER="$PG_USER" -e POSTGRES_PASSWORD=drill \
  postgres:16-alpine > /dev/null
until docker exec "$DRILL" pg_isready -U "$PG_USER" -q 2>/dev/null &&
  docker exec "$DRILL" psql -U "$PG_USER" -d postgres -Atc 'select 1' > /dev/null 2>&1; do
  sleep 1
done
"$(dirname "$0")/restore.sh" "$key" "$DRILL" "$DB"

log "4/4 verify row counts"
row_counts "$DRILL" "$DB" > "$work/restored.txt"
rto=$(( $(date +%s) - rto_start ))
rpo=$(( rto_start - backup_at ))
tables=$(wc -l < "$work/source.txt")
rows=$(awk '{s+=$2} END {print s+0}' "$work/source.txt")
if diff -u "$work/source.txt" "$work/restored.txt" > "$work/diff.txt"; then
  echo "DRILL PASS db=$DB tables=$tables rows=$rows key=$key backup_age_at_restore_s=$rpo rto_s=$rto"
else
  cat "$work/diff.txt"
  echo "DRILL FAIL db=$DB: row counts differ (see diff above)"
  exit 1
fi
