#!/usr/bin/env bash

set -euo pipefail

ORCA_VM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORCA_VM_REPO_ROOT="$(cd "$ORCA_VM_DIR/../.." && pwd)"
ORCA_VM_STATE_FILE="${ORCA_VM_STATE_FILE:-$ORCA_VM_DIR/docker-state.json}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

json_value() {
  local key="$1"
  node -e '
    const fs = require("node:fs");
    const [file, key] = process.argv.slice(1);
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"))[key];
      if (value !== undefined && value !== null) process.stdout.write(String(value));
    } catch {}
  ' "$ORCA_VM_STATE_FILE" "$key"
}

state_value() {
  local env_name="$1"
  local state_key="$2"
  local fallback="${3:-}"
  local from_env="${!env_name:-}"
  local from_state=""

  if [ -n "$from_env" ]; then
    printf '%s' "$from_env"
    return
  fi
  from_state="$(json_value "$state_key")"
  if [ -n "$from_state" ]; then
    printf '%s' "$from_state"
    return
  fi
  printf '%s' "$fallback"
}

absolute_identity_file() {
  local configured="$1"
  if [[ "$configured" = /* ]]; then
    printf '%s' "$configured"
  else
    printf '%s/%s' "$ORCA_VM_REPO_ROOT" "$configured"
  fi
}

ensure_ssh_key() {
  local private_key="$1"
  require_command ssh-keygen
  if [ ! -f "$private_key" ]; then
    mkdir -p "$(dirname "$private_key")"
    chmod 700 "$(dirname "$private_key")"
    echo "Generating the repo-local Docker SSH key at $private_key" >&2
    ssh-keygen -q -t ed25519 -N '' -C 'orca-local-docker' -f "$private_key"
  fi
  [ -f "$private_key.pub" ] || ssh-keygen -y -f "$private_key" >"$private_key.pub"
  chmod 600 "$private_key"
  chmod 644 "$private_key.pub"
}

docker_ssh_port() {
  local container="$1"
  local mapping
  mapping="$(docker port "$container" 22/tcp | head -n 1)"
  [ -n "$mapping" ] || {
    echo "Docker did not publish an SSH port for $container" >&2
    return 1
  }
  printf '%s' "${mapping##*:}"
}

wait_for_ssh() {
  local port="$1"
  local username="$2"
  local identity_file="$3"

  for _ in $(seq 1 60); do
    if ssh \
      -i "$identity_file" \
      -p "$port" \
      -o BatchMode=yes \
      -o ConnectTimeout=1 \
      -o IdentitiesOnly=yes \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      "$username@127.0.0.1" true >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done

  echo "SSH did not become ready on 127.0.0.1:$port" >&2
  return 1
}

require_orca_container() {
  local container="$1"
  local recipe_label
  recipe_label="$(docker inspect \
    --format '{{ index .Config.Labels "dev.orca.environment-recipe" }}' \
    "$container" 2>/dev/null || true)"
  [ "$recipe_label" = 'docker-ssh' ] || {
    echo "Refusing to manage non-Orca Docker container: $container" >&2
    return 1
  }
}

update_state() {
  local updates_json="$1"
  node -e '
    const fs = require("node:fs");
    const [file, updatesJson] = process.argv.slice(1);
    const current = JSON.parse(fs.readFileSync(file, "utf8"));
    const updated = { ...current, ...JSON.parse(updatesJson) };
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
    process.stdout.write(JSON.stringify(updated));
  ' "$ORCA_VM_STATE_FILE" "$updates_json"
}
