# Orca per-workspace environment

This recipe creates one disposable local Docker container per Orca workspace and connects to it over
SSH. The container is cloned from a reusable image containing AiTM, its dependencies, and a Codex
device-auth session. Orca keeps its default linked-worktree checkout behavior.

## One-time setup

1. Build the reusable base image:

   ```sh
   ./scripts/orca-vm/docker-base-snapshot.sh
   ```

   The script obtains private-repository access from `GH_TOKEN`, `GITHUB_TOKEN`, or `gh auth token`.
   The token is passed only to a `docker exec` process and is not stored in the container image or
   state file.

2. Prepare the temporary authentication container:

   ```sh
   ./scripts/orca-vm/docker-base-auth.sh prepare
   ```

3. Run Codex device authentication in your own interactive terminal:

   ```sh
   docker exec -it --user orca --env HOME=/home/orca orca-aitm-codex-auth codex login --device-auth
   ```

   Report back when login succeeds. The finalize step verifies the exact successful status and refuses
   to create an auth image when the container is unauthenticated. It never copies or mounts the host's
   `.codex` directory.

4. Finalize the authenticated image:

   ```sh
   ./scripts/orca-vm/docker-base-auth.sh finalize
   ```

5. Run free static validation:

   ```sh
   orca vm recipe doctor docker-ssh --repo-path "$PWD" --json
   ```

6. Run the live create/connect/destroy self-test:

   ```sh
   orca vm recipe doctor docker-ssh --repo-path "$PWD" --provision --json
   ```

The live self-test creates a local container, validates the emitted recipe JSON, and calls the destroy
hook. After it passes, smoke-test the emitted SSH target as described below. Inspect
`docker ps -a --filter name=orca-docker-ssh` if a host-level interruption prevents cleanup.

The workspace picker reads `orca.yaml` from the primary checkout. Commit and merge this recipe to the
primary branch before expecting “Docker (SSH)” to appear as a **Run on** option.

## Configuration

Non-secret defaults live in `docker-state.json`. Every script resolves its settings as environment
variable, then state file, then built-in fallback. Useful overrides include:

- `ORCA_DOCKER_TOOLCHAIN_IMAGE`
- `ORCA_DOCKER_BASE_IMAGE`
- `ORCA_DOCKER_AUTH_IMAGE`
- `ORCA_REPO_URL`
- `ORCA_REPO_REF`
- `ORCA_PROJECT_ROOT`
- `ORCA_SSH_USERNAME`
- `ORCA_SSH_IDENTITY_FILE`
- `ORCA_CODEX_VERSION`

The generated SSH private/public key pair lives under `.keys/` and is ignored by Git. Codex credentials
live only in the authenticated Docker image. Re-run the auth script if those credentials expire.
