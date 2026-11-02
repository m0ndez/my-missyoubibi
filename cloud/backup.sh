#!/bin/sh
# Copies the app's data (mounted read-only at /data) to the BACKUP_REMOTE bucket every night at 03:00 UTC, and once at start so a wrong
# credential shows up now, not tomorrow. Each backup is one archive; archives older than BACKUP_KEEP_DAYS are deleted, but only after a
# new one is safely uploaded, so a broken job never prunes its own history. BACKUP_ONCE=1 runs one backup and exits.
set -eu
umask 077
trap 'exit 0' TERM # PID 1 ignores TERM otherwise, and `docker stop` waits 10 s for a kill
keep="${BACKUP_KEEP_DAYS:-30}"

# `set -e` is ignored inside a function called after `||`, so the steps are chained with && : a failed step must stop the prune.
backup() {
  name="app-data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
  tar -C /data -czf "/tmp/$name" . && # the app writes each file by rename, so a file is whole or absent
    rclone copyto "/tmp/$name" "$BACKUP_REMOTE/$name" &&
    rm -f "/tmp/$name" &&
    rclone delete "$BACKUP_REMOTE" --include 'app-data-*.tar.gz' --min-age "${keep}d" &&
    echo "backup $name done"
}

[ -z "${BACKUP_ONCE:-}" ] || { backup; exit; }
while :; do
  backup || echo "backup failed, trying again tomorrow" >&2
  now=$(date -u +%s)
  sleep $(( (86400 + 3 * 3600 - now % 86400) % 86400 + 1 )) & wait $! # seconds to the next 03:00 UTC
done
