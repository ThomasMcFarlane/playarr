#!/usr/bin/env python3
"""Runs the BrightScript logic tests (tests/brs/test_*.brs) on Linux.

Each test file names the logic files it needs with `' include: <path>` lines
(relative to the test file) and prints `PASS <name>` / `FAIL <name>` lines,
then `ALL PASS` when nothing failed. The files run in the BrightScript
simulation engine (brs-node), so no Roku device or SDK is needed. Set
BRS_CLI to a local brs-cli binary to avoid npx.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def command() -> list[str]:
    explicit = os.environ.get("BRS_CLI")
    if explicit:
        return [explicit]
    if shutil.which("npx") is None:
        sys.exit("npx (Node.js) or BRS_CLI is required to run the BrightScript tests")
    return ["npx", "--yes", "brs-node@2.6.0"]


def includes(test: Path) -> list[Path]:
    found = []
    for line in test.read_text(encoding="utf-8").splitlines():
        if line.startswith("' include:"):
            found.append((test.parent / line.split(":", 1)[1].strip()).resolve())
    return found


def main() -> int:
    tests = sorted(HERE.glob("test_*.brs"))
    if not tests:
        print("no BrightScript tests found")
        return 1
    failed = 0
    for test in tests:
        args = command() + [str(p) for p in includes(test)] + [str(test)]
        proc = subprocess.run(args, capture_output=True, text=True, timeout=300)
        output = proc.stdout + proc.stderr
        passes = sum(1 for line in output.splitlines() if line.startswith("PASS "))
        bad = [line for line in output.splitlines() if line.startswith("FAIL ") or "Error" in line]
        if "ALL PASS" not in output or bad:
            failed += 1
            print(f"FAILED {test.name}")
            print(output)
        else:
            print(f"ok {test.name} ({passes} checks)")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
