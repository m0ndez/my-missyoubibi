#!/bin/sh
# Rebuilds the app's data volume from a backup. Run on a CLEAN volume only: it refuses to touch one that has files in it.
# With no argument it takes the newest archive; otherwise the archive name (list them: `rclone lsf $BACKUP_REMOTE`).
set -eu
[ -z "$(ls -A /data)" ] || { echo "refusing: /data is not empty. Restore onto a new, empty volume." >&2; exit 1; }
name="${1:-$(rclone lsf "$BACKUP_REMOTE" --include 'app-data-*.tar.gz' | sort | tail -n 1)}"
[ -n "$name" ] || { echo "no backup found in $BACKUP_REMOTE" >&2; exit 1; }
rclone copyto "$BACKUP_REMOTE/$name" /tmp/restore.tar.gz
tar -C /data -xzpf /tmp/restore.tar.gz
chown -R 1000:1000 /data # the app runs as `node` (uid 1000)
echo "restored $name"
