#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

payload="$(cat)"
resource_id="$(node -e '
  const d = JSON.parse(process.argv[1]);
  process.stdout.write(d.recipeResult?.userData?.resourceId ?? "");
' "$payload")"

[ -n "$resource_id" ] || { echo "No Docker resource id in lifecycle payload" >&2; exit 1; }
if ! docker container inspect "$resource_id" >/dev/null 2>&1; then
  echo "Docker workspace $resource_id is already absent" >&2
  exit 0
fi
require_orca_container "$resource_id"
echo "Removing Docker workspace $resource_id" >&2
docker rm --force "$resource_id" >&2
