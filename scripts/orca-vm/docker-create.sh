#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

require_command docker
require_command node
require_command ssh

auth_image="$(state_value ORCA_DOCKER_AUTH_IMAGE authImage 'aitm-orca-codex:latest')"
repo_url="$(state_value ORCA_REPO_URL repoUrl)"
repo_ref="$(state_value ORCA_REPO_REF repoRef main)"
project_root="$(state_value ORCA_PROJECT_ROOT projectRoot /workspace/aitm)"
ssh_username="$(state_value ORCA_SSH_USERNAME sshUsername orca)"
identity_config="$(state_value ORCA_SSH_IDENTITY_FILE identityFile 'scripts/orca-vm/.keys/orca_docker_ed25519')"
identity_file="$(absolute_identity_file "$identity_config")"
gh_token="${GH_TOKEN:-${GITHUB_TOKEN:-$(command -v gh >/dev/null 2>&1 && gh auth token 2>/dev/null || true)}}"

docker image inspect "$auth_image" >/dev/null 2>&1 || {
  echo "Authenticated image $auth_image is missing. Run the base snapshot and auth scripts first." >&2
  exit 1
}
[ -n "$repo_url" ] || { echo "repoUrl is missing from $ORCA_VM_STATE_FILE" >&2; exit 1; }
[ -n "$gh_token" ] || {
  echo "GitHub authentication is unavailable. Export GH_TOKEN/GITHUB_TOKEN or run gh auth login." >&2
  exit 1
}

ensure_ssh_key "$identity_file"
public_key="$(cat "$identity_file.pub")"

recipe_id="${ORCA_RECIPE_ID:-docker-ssh}"
instance_id="${ORCA_VM_INSTANCE_ID:-$(date +%s)-$$}"
safe_recipe_id="$(printf '%s' "$recipe_id" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9_.-' '-')"
safe_instance_id="$(printf '%s' "$instance_id" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9_.-' '-')"
name="orca-${safe_recipe_id:0:48}-${safe_instance_id:0:48}"

cleanup_on_error() {
  local exit_code=$?
  if [ "$exit_code" -ne 0 ]; then
    docker logs "$name" >&2 2>/dev/null || true
    docker rm -f "$name" >/dev/null 2>&1 || true
  fi
}
trap cleanup_on_error EXIT

echo "Starting Docker workspace $name from $auth_image" >&2
docker run --detach \
  --name "$name" \
  --label dev.orca.environment-recipe=docker-ssh \
  --label "dev.orca.workspace-instance=$instance_id" \
  --publish 127.0.0.1::22 \
  --env "ORCA_SSH_PUBLIC_KEY=$public_key" \
  "$auth_image" >/dev/null

ssh_port="$(docker_ssh_port "$name")"
wait_for_ssh "$ssh_port" "$ssh_username" "$identity_file"

# The token exists only in this exec process; it is neither stored in state nor added to the container config.
docker exec \
  --user orca \
  --env "HOME=/home/orca" \
  --env "GH_TOKEN=$gh_token" \
  --env "ORCA_REPO_URL=$repo_url" \
  --env "ORCA_REPO_REF=$repo_ref" \
  --env "ORCA_PROJECT_ROOT=$project_root" \
  "$name" bash -lc '
    set -euo pipefail
    askpass=/tmp/orca-git-askpass
    cleanup_askpass() { rm -f "$askpass"; }
    trap cleanup_askpass EXIT
    printf "%s\n" \
      "#!/usr/bin/env bash" \
      "case \"\$1\" in *Username*) echo x-access-token;; *Password*) echo \"\$GH_TOKEN\";; esac" \
      >"$askpass"
    chmod 0700 "$askpass"
    export GIT_ASKPASS="$askpass" GIT_TERMINAL_PROMPT=0
    cd "$ORCA_PROJECT_ROOT"
    git fetch origin "$ORCA_REPO_REF"
    git checkout -B "$ORCA_REPO_REF" FETCH_HEAD
    lock_hash="$(sha256sum package-lock.json | cut -d " " -f 1)"
    if [ ! -d node_modules ] || [ ! -f .orca-deps-lock ] || [ "$(cat .orca-deps-lock)" != "$lock_hash" ]; then
      npm ci
      printf "%s" "$lock_hash" >.orca-deps-lock
    fi
  ' >&2

node -e '
  const [name, port, username, identityFile, projectRoot, image] = process.argv.slice(1);
  console.log(JSON.stringify({
    schemaVersion: 1,
    connection: {
      type: "ssh",
      projectRoot,
      target: {
        label: name,
        host: "127.0.0.1",
        port: Number(port),
        username,
        identityFile,
        identitiesOnly: true
      }
    },
    userData: { provider: "local-docker", resourceId: name, image }
  }));
' "$name" "$ssh_port" "$ssh_username" "$identity_file" "$project_root" "$auth_image"

trap - EXIT
