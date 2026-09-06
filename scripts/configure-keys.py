#!/usr/bin/env python3
"""Collect local AiTM provider credentials without echoing or logging them."""

import getpass
import os
from pathlib import Path
import sys
import tempfile


def main():
    if not sys.stdin.isatty():
        raise SystemExit("Run this command in an interactive terminal for hidden input.")

    target = Path(__file__).resolve().parents[1] / ".env.local"
    if target.is_symlink():
        raise SystemExit("Refusing to replace a symlink at .env.local.")

    names = ("OPENAI_API_KEY", "ANTHROPIC_API_KEY")
    values = {}
    for name in names:
        value = getpass.getpass(f"{name} (hidden): ").strip()
        if not value or any(c.isspace() or c in "\"'`\\#$" for c in value):
            raise SystemExit(f"{name} must be a nonempty API key without whitespace or shell syntax.")
        values[name] = value

    # Keep unrelated local settings; replace only the two provider credentials.
    previous = target.read_text() if target.exists() else ""
    retained = [
        line for line in previous.splitlines()
        if line.strip().removeprefix("export ").split("=", 1)[0].strip() not in names
    ]
    content = "\n".join(retained + [f"{name}={values[name]}" for name in names]) + "\n"
    fd, temporary = tempfile.mkstemp(prefix=".env.local.", dir=target.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

    print("Both keys saved to .env.local with owner-only permissions (0600).")
    print("The values were not printed. Return to Codex and say: Keys ready.")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        raise SystemExit("\nCancelled; credentials were not changed.")
