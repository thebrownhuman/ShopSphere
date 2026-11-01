#!/usr/bin/env bash
# M7.6 logical backup: pg_dump (custom format) of one database, uploaded to S3 (SeaweedFS)
# at s3://backups/postgres/<db>/<UTC timestamp>.dump, plus postgres/<db>/LATEST (the key).
#   infra/backup/backup.sh [db=shopsphere]        prints the uploaded key
# KEEP (default 288 = 24 h at 5-min cadence) older dumps per database are pruned.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
DB=${1:-shopsphere}
KEEP=${KEEP:-288}
ts=$(date -u +%Y%m%dT%H%M%SZ)
key="postgres/${DB}/${ts}.dump"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

ensure_bucket
start=$(date +%s)
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$DB" -Fc -Z 6 > "$tmp"
size=$(wc -c < "$tmp")
s3 -T "$(native "$tmp")" "$key" > /dev/null
printf '%s' "$key" > "$tmp"
s3 -T "$(native "$tmp")" "postgres/${DB}/LATEST" > /dev/null
log "backup ${DB}: ${size} bytes -> s3://${S3_BUCKET}/${key} in $(( $(date +%s) - start ))s"

# Prune: list keys for this db (ListObjectsV2), drop all but the newest $KEEP dumps.
keys=$(curl -sSf --aws-sigv4 "aws:amz:${S3_REGION}:s3" --user "${S3_ACCESS_KEY}:${S3_SECRET_KEY}" \
  "${S3_URL}/${S3_BUCKET}?list-type=2&prefix=postgres/${DB}/" |
  grep -o '<Key>[^<]*\.dump</Key>' | sed 's/<[^>]*>//g' | sort)
count=$(printf '%s\n' "$keys" | grep -c . || true)
if (( count > KEEP )); then
  printf '%s\n' "$keys" | head -n $(( count - KEEP )) | while read -r old; do
    s3 -X DELETE "$old" > /dev/null && log "pruned $old"
  done
fi
echo "$key"
