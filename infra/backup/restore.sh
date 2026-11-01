#!/usr/bin/env bash
# M7.6 restore: download a dump from S3 and pg_restore it into a database in a Postgres container.
#   infra/backup/restore.sh <key|latest> <container> <target-db> [source-db for "latest"=shopsphere]
# The target database is dropped and recreated. Never point this at the live container by accident:
# set CONFIRM=yes when <container> is the main one ($PG_CONTAINER).
set -euo pipefail
. "$(dirname "$0")/lib.sh"
KEY=$1 TARGET=$2 TARGET_DB=$3 SRC_DB=${4:-shopsphere}
if [[ "$TARGET" == "$PG_CONTAINER" && "${CONFIRM:-}" != "yes" ]]; then
  echo "refusing to restore into $PG_CONTAINER without CONFIRM=yes" >&2
  exit 2
fi
[[ "$KEY" == latest ]] && KEY=$(s3 "postgres/${SRC_DB}/LATEST")
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
s3 -o "$(native "$tmp")" "$KEY"
log "restore s3://${S3_BUCKET}/${KEY} ($(wc -c < "$tmp") bytes) -> ${TARGET}/${TARGET_DB}"
docker exec "$TARGET" psql -U "$PG_USER" -d postgres -q \
  -c "DROP DATABASE IF EXISTS \"${TARGET_DB}\" WITH (FORCE)" -c "CREATE DATABASE \"${TARGET_DB}\""
docker exec -i "$TARGET" pg_restore -U "$PG_USER" -d "$TARGET_DB" --no-owner --exit-on-error -j 1 < "$tmp"
log "restore done"
