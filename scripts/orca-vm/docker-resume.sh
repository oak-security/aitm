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
ssh_username="$(node -e '
  const d = JSON.parse(process.argv[1]);
  process.stdout.write(d.recipeResult?.connection?.target?.username ?? "");
' "$payload")"
identity_file="$(node -e '
  const d = JSON.parse(process.argv[1]);
  process.stdout.write(d.recipeResult?.connection?.target?.identityFile ?? "");
' "$payload")"

[ -n "$resource_id" ] || { echo "No Docker resource id in lifecycle payload" >&2; exit 1; }
[ -n "$ssh_username" ] || { echo "No SSH username in lifecycle payload" >&2; exit 1; }
[ -n "$identity_file" ] || { echo "No SSH identity file in lifecycle payload" >&2; exit 1; }
require_orca_container "$resource_id"

echo "Starting Docker workspace $resource_id" >&2
docker start "$resource_id" >&2
ssh_port="$(docker_ssh_port "$resource_id")"
wait_for_ssh "$ssh_port" "$ssh_username" "$identity_file"

node -e '
  const d = JSON.parse(process.argv[1]);
  const port = Number(process.argv[2]);
  const result = d.recipeResult;
  result.schemaVersion = 1;
  result.connection.target.port = port;
  console.log(JSON.stringify(result));
' "$payload" "$ssh_port"
