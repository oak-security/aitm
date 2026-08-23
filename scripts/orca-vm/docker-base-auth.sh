#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

require_command docker
require_command node

action="${1:-}"
base_image="$(state_value ORCA_DOCKER_BASE_IMAGE baseImage 'aitm-orca-base:latest')"
auth_image="$(state_value ORCA_DOCKER_AUTH_IMAGE authImage 'aitm-orca-codex:latest')"
auth_container="${ORCA_DOCKER_AUTH_CONTAINER:-orca-aitm-codex-auth}"

usage() {
  cat >&2 <<EOF
Usage:
  $0 prepare   Start the temporary auth container
  $0 finalize  Verify login, commit the auth image, and remove the container

Between those commands, run this in your own interactive terminal:
  docker exec -it --user orca --env HOME=/home/orca $auth_container codex login --device-auth
EOF
}

case "$action" in
  prepare)
    docker image inspect "$base_image" >/dev/null 2>&1 || {
      echo "Base image $base_image is missing. Run $SCRIPT_DIR/docker-base-snapshot.sh first." >&2
      exit 1
    }
    if docker container inspect "$auth_container" >/dev/null 2>&1; then
      echo "Auth container $auth_container already exists; leaving it unchanged." >&2
    else
      echo "Starting temporary Codex-auth container $auth_container" >&2
      docker run --detach \
        --name "$auth_container" \
        --label dev.orca.auth-container=docker-ssh \
        --entrypoint sleep \
        "$base_image" infinity >/dev/null
    fi
    echo "Run the device-auth command shown below, then report back when it succeeds:" >&2
    echo "docker exec -it --user orca --env HOME=/home/orca $auth_container codex login --device-auth" >&2
    ;;

  finalize)
    auth_label="$(docker inspect \
      --format '{{ index .Config.Labels "dev.orca.auth-container" }}' \
      "$auth_container" 2>/dev/null || true)"
    [ "$auth_label" = 'docker-ssh' ] || {
      echo "Auth container $auth_container is missing or was not created by this recipe." >&2
      exit 1
    }

    status_output="$(docker exec \
      --user orca \
      --env HOME=/home/orca \
      "$auth_container" bash -lc 'codex login status 2>&1')"
    printf '%s\n' "$status_output" >&2
    printf '%s\n' "$status_output" | grep -Eqi 'Logged in using ChatGPT|Logged in via device' || {
      echo "Codex is not authenticated; refusing to commit the auth image." >&2
      exit 1
    }

    echo "Committing authenticated image $auth_image" >&2
    docker commit \
      --change 'ENTRYPOINT ["/usr/local/bin/orca-docker-ssh-entrypoint"]' \
      --change 'CMD []' \
      "$auth_container" "$auth_image" >&2

    entrypoint="$(docker image inspect "$auth_image" --format '{{json .Config.Entrypoint}}')"
    [ "$entrypoint" = '["/usr/local/bin/orca-docker-ssh-entrypoint"]' ] || {
      echo "Authenticated image has an unexpected entrypoint: $entrypoint" >&2
      exit 1
    }

    docker rm -f "$auth_container" >/dev/null
    update_state "$(node -e '
      console.log(JSON.stringify({
        authImage: process.argv[1],
        authSourceImage: process.argv[2],
        authBuiltAt: new Date().toISOString()
      }))
    ' "$auth_image" "$base_image")"
    ;;

  *)
    usage
    exit 2
    ;;
esac
