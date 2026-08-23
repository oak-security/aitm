#!/usr/bin/env bash

set -euo pipefail

[ -n "${ORCA_SSH_PUBLIC_KEY:-}" ] || {
  echo "ORCA_SSH_PUBLIC_KEY is required" >&2
  exit 1
}

install -d -m 0700 -o orca -g orca /home/orca/.ssh
printf '%s\n' "$ORCA_SSH_PUBLIC_KEY" >/home/orca/.ssh/authorized_keys
chown orca:orca /home/orca/.ssh/authorized_keys
chmod 0600 /home/orca/.ssh/authorized_keys

# Host keys are baked into the image. This only repairs an image built without them.
ssh-keygen -A
exec /usr/sbin/sshd -D -e
