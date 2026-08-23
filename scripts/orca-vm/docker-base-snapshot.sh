#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

require_command docker
require_command node

toolchain_image="$(state_value ORCA_DOCKER_TOOLCHAIN_IMAGE toolchainImage 'aitm-orca-toolchain:latest')"
base_image="$(state_value ORCA_DOCKER_BASE_IMAGE baseImage 'aitm-orca-base:latest')"
repo_url="$(state_value ORCA_REPO_URL repoUrl)"
repo_ref="$(state_value ORCA_REPO_REF repoRef main)"
project_root="$(state_value ORCA_PROJECT_ROOT projectRoot /workspace/aitm)"
identity_config="$(state_value ORCA_SSH_IDENTITY_FILE identityFile 'scripts/orca-vm/.keys/orca_docker_ed25519')"
identity_file="$(absolute_identity_file "$identity_config")"
gh_token="${GH_TOKEN:-${GITHUB_TOKEN:-$(command -v gh >/dev/null 2>&1 && gh auth token 2>/dev/null || true)}}"

[ -n "$repo_url" ] || { echo "repoUrl is missing from $ORCA_VM_STATE_FILE" >&2; exit 1; }
[ -n "$gh_token" ] || {
  echo "GitHub authentication is unavailable. Export GH_TOKEN/GITHUB_TOKEN or run gh auth login." >&2
  exit 1
}

ensure_ssh_key "$identity_file"

build_container="orca-aitm-base-build-$$"
cleanup() {
  docker rm -f "$build_container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Building Docker toolchain image $toolchain_image" >&2
docker build \
  --build-arg "CODEX_VERSION=${ORCA_CODEX_VERSION:-latest}" \
  --file "$SCRIPT_DIR/Dockerfile" \
  --tag "$toolchain_image" \
  "$SCRIPT_DIR" >&2

echo "Provisioning AiTM and its dependencies in $build_container" >&2
docker run --detach \
  --name "$build_container" \
  --entrypoint sleep \
  "$toolchain_image" infinity >/dev/null

# GH_TOKEN is scoped to this exec process. It is not added to the container config or image.
docker exec \
  --user orca \
  --env "HOME=/home/orca" \
  --env "GH_TOKEN=$gh_token" \
  --env "ORCA_REPO_URL=$repo_url" \
  --env "ORCA_REPO_REF=$repo_ref" \
  --env "ORCA_PROJECT_ROOT=$project_root" \
  "$build_container" bash -lc '
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
    git clone "$ORCA_REPO_URL" "$ORCA_PROJECT_ROOT"
    cd "$ORCA_PROJECT_ROOT"
    git fetch origin "$ORCA_REPO_REF"
    git checkout -B "$ORCA_REPO_REF" FETCH_HEAD
    npm ci
    npm run check
    npm test
    sha256sum package-lock.json | cut -d " " -f 1 >.orca-deps-lock
  ' >&2

echo "Committing reusable base image $base_image" >&2
docker commit \
  --change 'ENTRYPOINT ["/usr/local/bin/orca-docker-ssh-entrypoint"]' \
  --change 'CMD []' \
  "$build_container" "$base_image" >&2

update_state "$(node -e '
  console.log(JSON.stringify({
    toolchainImage: process.argv[1],
    baseImage: process.argv[2],
    baseBuiltAt: new Date().toISOString()
  }))
' "$toolchain_image" "$base_image")"
