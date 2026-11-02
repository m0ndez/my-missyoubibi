#!/bin/sh
# Runs after a certificate is issued or renewed. The broker drops root and reads these files as uid 1883, so copy them to the
# shared volume with that owner (the originals are root-only), then ask the broker to re-read them.
set -eu
install -o 1883 -g 1883 -m 644 "$RENEWED_LINEAGE/fullchain.pem" /certs/fullchain.pem
install -o 1883 -g 1883 -m 600 "$RENEWED_LINEAGE/privkey.pem" /certs/privkey.pem
# The broker joins this container's PID namespace (`pid: service:certbot`). It is absent on first start, and also if certbot was
# recreated without it: say so, because the renewed certificate is then not live until the broker restarts.
pid=$(pidof mosquitto || true)
if [ -n "$pid" ]; then kill -HUP $pid; else echo "deploy-hook: broker not visible, certificate loads at its next start" >&2; fi
