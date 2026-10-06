#!/usr/bin/env bash
set -Eeuo pipefail
[[ $# == 1 ]] || exit 2
image="$1"
fixture="$(mktemp -d)"
container=""
cleanup() {
    if [[ -n "$container" ]]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
    rm -f -- "$fixture/records.json"
    rmdir -- "$fixture"
}
trap cleanup EXIT
printf '%s' '{"synthetic":true}' > "$fixture/records.json"
chmod 0600 "$fixture/records.json"
for uid in 1000 0; do
    container="$(docker run -d --read-only --network none --user "$uid:$uid" \
        --tmpfs "/tmp:uid=$uid,gid=$uid,mode=0750" --cap-drop ALL \
        --security-opt no-new-privileges --entrypoint sleep "$image" 60)"
    tar --create --file - --directory "$fixture" . | docker exec -i "$container" sh -ec '
        umask 077
        mkdir -m 0700 /tmp/casa-handoff-test
        tar --extract --no-same-owner --no-same-permissions --file - --directory /tmp/casa-handoff-test
        test "$(cat /tmp/casa-handoff-test/records.json)" = "{\"synthetic\":true}"
        test "$(stat -c %a /tmp/casa-handoff-test)" = 700
        test "$(stat -c %a /tmp/casa-handoff-test/records.json)" = 600
    '
    docker rm -f "$container" >/dev/null
    container=""
done
echo 'PASS: private manifest streaming into a read-only rootfs works for both service identities.'
