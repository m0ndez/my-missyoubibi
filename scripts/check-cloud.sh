#!/bin/sh
# Self-check for cloud/backup.sh and cloud/restore.sh: `npm run check:cloud`. Runs them in the pinned rclone image (Docker or Podman),
# against a local directory standing in for the R2 bucket. Not part of `npm run check`: it needs a container runtime and the image.
set -eu
cd "$(dirname "$0")/.."
rt=$(command -v docker || command -v podman) || { echo "check-cloud: needs docker or podman" >&2; exit 1; }
img=$(sed -n 's/^ *image: \(rclone\/rclone:[^ ]*\)$/\1/p' docker-compose.cloud.yml | head -n 1)
tmp=$(mktemp -d); trap 'chmod -R u+rwx "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
fail() { echo "check failed: $*" >&2; exit 1; }
mkdir "$tmp/data" "$tmp/bucket" "$tmp/restored"
echo '[{"id":"a"}]' > "$tmp/data/devices.json"; echo '{"d":1}' > "$tmp/data/energy.json"
chmod -R a+rX "$tmp/data"; chmod 777 "$tmp/bucket" "$tmp/restored"
echo x | gzip > "$tmp/bucket/app-data-20200101T030000Z.tar.gz"; touch -t 202001010300 "$tmp/bucket/app-data-20200101T030000Z.tar.gz"
echo keep > "$tmp/bucket/other.txt"
run() { # run <script> <bucket mount mode> <data mount> [args]: the script as the container runs it
  s=$1; mode=$2; data=$3; shift 3
  "$rt" run --rm --user "${RUN_USER:-1000:1000}" -e BACKUP_ONCE=1 -e BACKUP_REMOTE=/bucket --tmpfs /tmp:mode=1777 \
    -v "$data" -v "$tmp/bucket:/bucket:$mode" -v "$PWD/cloud/$s.sh:/s.sh:ro" --entrypoint /bin/sh "$img" /s.sh "$@" >/dev/null 2>&1
}

# a failed upload must not prune the old archive, and must fail
run backup ro "$tmp/data:/data:ro" && fail "backup into a read-only bucket should fail"
[ -e "$tmp/bucket/app-data-20200101T030000Z.tar.gz" ] || fail "a failed backup pruned the old archive"

# a good backup prunes the old archive, keeps unrelated files, and leaves exactly one new archive
run backup rw "$tmp/data:/data:ro" || fail "backup failed"
n=0; for _ in "$tmp"/bucket/app-data-*.tar.gz; do n=$((n + 1)); done
[ "$n" = 1 ] && [ ! -e "$tmp/bucket/app-data-20200101T030000Z.tar.gz" ] || fail "old archive not pruned"
[ -e "$tmp/bucket/other.txt" ] || fail "an unrelated file was deleted"

# restore fills an empty volume with the same files, and refuses a second time
RUN_USER=0:0 run restore ro "$tmp/restored:/data" || fail "restore failed"
diff -r "$tmp/data" "$tmp/restored" || fail "restored data differs"
RUN_USER=0:0 run restore ro "$tmp/restored:/data" && fail "restore onto a non-empty volume should refuse"
echo "check-cloud checks done"
