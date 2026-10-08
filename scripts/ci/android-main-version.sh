#!/usr/bin/env bash
# Version of the signed Android APK that CI builds from every push to main.
#
# Usage: android-main-version.sh <version.properties> <commit-count> [<latest-release-code>]
# Prints name= and code= lines (for $GITHUB_OUTPUT).
#
#   name = <version.properties version>-main.<commit count>   e.g. 0.3.0-main.1278
#   code = (major*1e4 + minor*1e2 + patch) * 1e5 + commit count
#
# The code is the formula the Google Play workflow already uses, so one commit has one versionCode on
# both channels. It rises with every commit on main and is far above every sideload release code
# (major*1e6 + minor*1e3 + patch, for example 3000), so the APK installs over any release without
# uninstalling. The reverse does not hold: a later release APK is lower than a main build and needs an
# uninstall. The optional third argument is the latest release's versionCode; the build fails rather than
# print a code that is not above it.
set -euo pipefail

props=${1:?usage: android-main-version.sh <version.properties> <commit-count> [<latest-release-code>]}
count=${2:?commit count}
release_code=${3:-0}

version=$(sed -n 's/^PLAYARR_VERSION_NAME=//p' "$props" | tr -d '[:space:]')
if [[ ! "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "version.properties must carry X.Y.Z, found '$version'" >&2
  exit 1
fi
major=${BASH_REMATCH[1]} minor=${BASH_REMATCH[2]} patch=${BASH_REMATCH[3]}
if ((major > 2 || minor > 99 || patch > 99)); then
  echo "Automatic Android versions support major <= 2 and minor/patch <= 99" >&2
  exit 1
fi
if [[ ! "$count" =~ ^[0-9]+$ ]] || ((count >= 100000)); then
  echo "Commit count must be a number below 100000, found '$count'" >&2
  exit 1
fi
code=$(((major * 10000 + minor * 100 + patch) * 100000 + count))
if ((code <= release_code || code > 2100000000)); then
  echo "Resolved versionCode $code must be above the latest release ($release_code) and within 2100000000" >&2
  exit 1
fi
echo "name=$version-main.$count"
echo "code=$code"
