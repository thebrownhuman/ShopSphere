#!/usr/bin/env bash
# Periodic backups for the 5-minute RPO target: runs backup.sh every INTERVAL seconds (default 300).
#   INTERVAL=300 infra/backup/backup-loop.sh [db=shopsphere]
set -uo pipefail
INTERVAL=${INTERVAL:-300}
while true; do
  "$(dirname "$0")/backup.sh" "${1:-shopsphere}" || echo "backup failed (will retry next tick)" >&2
  sleep "$INTERVAL"
done
