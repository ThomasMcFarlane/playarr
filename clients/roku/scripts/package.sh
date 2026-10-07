#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
roku_dir="$(cd "${script_dir}/.." && pwd)"
output_path="${1:-${roku_dir}/build/playarr-roku.zip}"

mkdir -p "$(dirname "${output_path}")"
rm -f "${output_path}"

cd "${roku_dir}"
zip -q -r "${output_path}" manifest source components images fonts \
  -x '*.DS_Store' '__MACOSX/*' '*.pyc' '*__pycache__*'

printf 'Created %s\n' "${output_path}"
