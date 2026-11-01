# Shared settings for the M7.6 backup scripts (sourced, not run).
PG_CONTAINER=${PG_CONTAINER:-shopsphere-postgres-1}
PG_USER=${PG_USER:-shopsphere}
S3_URL=${S3_URL:-http://localhost:8333}
S3_BUCKET=${S3_BUCKET:-backups}
S3_ACCESS_KEY=${S3_ACCESS_KEY:-any}
S3_SECRET_KEY=${S3_SECRET_KEY:-any}
S3_REGION=${S3_REGION:-us-east-1}
export MSYS_NO_PATHCONV=1

# Native path for curl on Git Bash for Windows (MSYS_NO_PATHCONV stops automatic conversion).
native() { if command -v cygpath > /dev/null; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }

# s3 <curl args...> <key>: SigV4-signed request against SeaweedFS (any S3 works).
s3() {
  local key=${@: -1}
  set -- "${@:1:$#-1}"
  curl -sSf --aws-sigv4 "aws:amz:${S3_REGION}:s3" --user "${S3_ACCESS_KEY}:${S3_SECRET_KEY}" \
    "$@" "${S3_URL}/${S3_BUCKET}/${key}"
}

ensure_bucket() {
  curl -sS --aws-sigv4 "aws:amz:${S3_REGION}:s3" \
    --user "${S3_ACCESS_KEY}:${S3_SECRET_KEY}" -X PUT "${S3_URL}/${S3_BUCKET}" > /dev/null || true
}

# Exact row count per table in schema public, "table count" lines sorted by table.
row_counts() {
  local container=$1 db=$2
  docker exec "$container" psql -U "$PG_USER" -d "$db" -Atc "
    SELECT format('SELECT %L || '' '' || count(*) FROM public.%I;', tablename, tablename)
    FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename" |
    docker exec -i "$container" psql -U "$PG_USER" -d "$db" -At
}
