#!/bin/sh
# Issues the broker certificate (Let's Encrypt, DNS-01 through Cloudflare), then renews it twice a day. Needs BROKER_HOST,
# ACME_EMAIL and CLOUDFLARE_API_TOKEN. ACME_STAGING=1 uses Let's Encrypt staging (an untrusted certificate: for testing renewal only).
set -eu
umask 077
trap 'exit 0' TERM # PID 1 ignores TERM otherwise, and `docker stop` waits 10 s for a kill
printf 'dns_cloudflare_api_token = %s\n' "$CLOUDFLARE_API_TOKEN" > /tmp/cloudflare.ini
staging=""
[ -n "${ACME_STAGING:-}" ] && staging="--staging"
hook=/deploy-hook.sh

# --keep-until-expiring would keep a staging certificate after ACME_STAGING is removed, so replace it when the mode changes
mode=prod; [ -n "$staging" ] && mode=staging
force=""
[ "$(cat /etc/letsencrypt/.mode 2>/dev/null || true)" = "$mode" ] || force="--force-renewal"

# $staging and $force are empty or one flag, so they are left unquoted on purpose
certbot certonly --non-interactive --agree-tos --keep-until-expiring $staging $force \
  -m "$ACME_EMAIL" -d "$BROKER_HOST" \
  --dns-cloudflare --dns-cloudflare-credentials /tmp/cloudflare.ini
echo "$mode" > /etc/letsencrypt/.mode
# certonly runs the hook only when it issues: place the files for a certificate that already exists too
RENEWED_LINEAGE="/etc/letsencrypt/live/$BROKER_HOST" "$hook"

while :; do
  sleep 12h & wait $!
  certbot renew --non-interactive $staging --deploy-hook "$hook" || echo "certbot renew failed, retrying in 12h" >&2
done
