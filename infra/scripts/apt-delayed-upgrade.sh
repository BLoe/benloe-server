#!/bin/bash
# apt-delayed-upgrade: install pending apt upgrades, but only package versions
# that have been published for at least MIN_AGE_DAYS (default 7).
#
# How it works:
#   1. apt-get update, then list everything a dist-upgrade would download
#      (--print-uris) without installing anything.
#   2. For each .deb, HEAD-request its pool URL and read Last-Modified —
#      that is the archive publish time. Works for archive.ubuntu.com,
#      security.ubuntu.com, Caddy (cloudsmith), and Chrome (dl.google.com).
#   3. Versions younger than the cutoff (or whose age can't be determined)
#      get pinned to priority -1 in a throwaway preferences dir, then a
#      normal dist-upgrade runs. apt keeps the installed version of anything
#      pinned away and resolves dependencies consistently; deferred packages
#      simply age in and install on a later run.
#
# Runs daily via apt-delayed-upgrade.timer (see infra/systemd/).
# Note: this replaces unattended-upgrades' install step, so security updates
# are ALSO delayed 7 days — deliberate supply-chain caution over patch speed.

set -uo pipefail

MIN_AGE_DAYS=${MIN_AGE_DAYS:-7}
CUTOFF=$(( $(date +%s) - MIN_AGE_DAYS * 86400 ))

PINDIR=$(mktemp -d)
trap 'rm -rf "$PINDIR"' EXIT
# Preserve any real pins so overriding PreferencesParts doesn't drop them.
cp /etc/apt/preferences.d/* "$PINDIR"/ 2>/dev/null || true

echo "=== apt-delayed-upgrade run: $(date -u '+%F %T') UTC (min age: ${MIN_AGE_DAYS}d) ==="

apt-get update -qq
# --print-uris omits .debs already in the download cache, which would let
# pre-fetched packages bypass the age check — start from an empty cache.
apt-get clean

allowed=0 deferred=0
while read -r uri file _; do
    uri=${uri//\'/}
    [[ "$file" == *.deb ]] || continue
    name=${file%%_*}
    ver=${file#*_}; ver=${ver%_*}; ver=${ver//%3a/:}

    lm=$(curl -fsI --max-time 30 "$uri" | tr -d '\r' \
         | awk -F': ' 'tolower($1)=="last-modified"{print $2}')
    ts=$(date -d "$lm" +%s 2>/dev/null || echo "")

    if [[ -n "$ts" && "$ts" -le "$CUTOFF" ]]; then
        echo "  ok     $name $ver (published $lm)"
        allowed=$((allowed + 1))
    else
        echo "  defer  $name $ver (published ${lm:-unknown})"
        printf 'Package: %s\nPin: version %s\nPin-Priority: -1\n\n' \
            "$name" "$ver" >> "$PINDIR/delayed"
        deferred=$((deferred + 1))
    fi
done < <(apt-get dist-upgrade --print-uris -qq)

echo "--- $allowed eligible, $deferred deferred ---"

if (( allowed > 0 )); then
    DEBIAN_FRONTEND=noninteractive apt-get \
        -o Dir::Etc::PreferencesParts="$PINDIR" \
        -o Dpkg::Options::=--force-confdef \
        -o Dpkg::Options::=--force-confold \
        -y dist-upgrade
    apt-get -qq -y --purge autoremove
fi

if [[ -f /var/run/reboot-required ]]; then
    echo "NOTE: reboot required ($(cat /var/run/reboot-required.pkgs 2>/dev/null | sort -u | tr '\n' ' '))"
fi
echo "=== done ==="
