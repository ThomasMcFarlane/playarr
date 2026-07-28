#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
roku_dir="$(cd "${script_dir}/.." && pwd)"
output_path="${1:-${roku_dir}/build/playarr-roku.zip}"

mkdir -p "$(dirname "${output_path}")"
rm -f "${output_path}"

cd "${roku_dir}"
<<<<<<< Updated upstream
=======

# Roku's dev-install caches compiled bytecode keyed by manifest version --
# reinstalling identical version numbers over an existing sideloaded "dev"
# channel can silently keep serving the previously-compiled build even
# after a successful plugin_install, which reads as an inexplicable "my
# fix isn't taking effect" bug. Auto-bump build_version on every package
# so each deploy is unambiguously a new version and always recompiles.
current_build="$(sed -n 's/^build_version=//p' manifest)"
next_build=$((10#${current_build} + 1))
printf -v padded_build '%05d' "${next_build}"
sed -i.bak "s/^build_version=.*/build_version=${padded_build}/" manifest
rm -f manifest.bak
>>>>>>> Stashed changes
zip -q -r "${output_path}" manifest source components images \
  -x '*.DS_Store' '__MACOSX/*' '*.pyc' '*__pycache__*'

printf 'Created %s\n' "${output_path}"
