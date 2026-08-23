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
require_orca_container "$resource_id"
echo "Stopping Docker workspace $resource_id" >&2
docker stop "$resource_id" >&2
