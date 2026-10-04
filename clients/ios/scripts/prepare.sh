#!/bin/bash
set -euo pipefail

temp_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
version=2.45.4
xcodegen_version() { xcodegen --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | tail -1; }
installed_version="$(xcodegen_version || true)"
if [[ "$installed_version" != "$version" ]]; then
  archive="$temp_root/xcodegen-$version.zip"
  archive_sha256=090ec29491aad50aec10631bf6e62253fed733c50f3aab0f5ffc86bc170bdbef
  curl --fail --location --silent --show-error "https://github.com/yonaskolb/XcodeGen/releases/download/$version/xcodegen.zip" --output "$archive"
  actual_sha256="$(shasum -a 256 "$archive" | awk '{print $1}')"
  [[ "$actual_sha256" == "$archive_sha256" ]] || { echo "XcodeGen $version archive SHA-256 mismatch" >&2; exit 2; }
  mkdir -p "$temp_root/xcodegen-$version"
  ditto -x -k "$archive" "$temp_root/xcodegen-$version"
  export PATH="$temp_root/xcodegen-$version/xcodegen/bin:$PATH"
fi
xcodegen generate --spec "$project_dir/project.yml" --project "$project_dir"
apple_tv_dir="$project_dir/../apple-tv"
xcodegen generate --spec "$apple_tv_dir/project.yml" --project "$apple_tv_dir"
generated_version="$(xcodegen_version)"
[[ "$generated_version" == "$version" ]] || { echo "Expected XcodeGen $version, found $generated_version" >&2; exit 2; }
for project in "$project_dir/Playarr.xcodeproj" "$apple_tv_dir/PlayarrTV.xcodeproj"; do
  [[ -d "$project" ]] || { echo "XcodeGen did not produce $project" >&2; exit 2; }
done
export GEM_HOME="$temp_root/playarr-gems"
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
ruby_candidates=()
if command -v brew >/dev/null 2>&1; then
  brew_ruby_prefix="$(brew --prefix ruby 2>/dev/null || true)"
  [[ -n "$brew_ruby_prefix" ]] && ruby_candidates+=("$brew_ruby_prefix/bin/ruby")
fi
ruby_candidates+=(/opt/homebrew/opt/ruby/bin/ruby /usr/local/opt/ruby/bin/ruby)
system_ruby="$(command -v ruby || true)"
[[ -n "$system_ruby" ]] && ruby_candidates+=("$system_ruby")
ruby_bin=""
for candidate in "${ruby_candidates[@]}"; do
  [[ -x "$candidate" ]] || continue
  ruby_major="$("$candidate" -e 'print RUBY_VERSION.split(".").first.to_i')"
  if (( ruby_major >= 3 )); then
    ruby_bin="$candidate"
    break
  fi
done
[[ -n "$ruby_bin" ]] || { echo "CocoaPods requires Ruby 3 or newer; install it with Homebrew on the Apple runner (system Ruby is too old)" >&2; exit 2; }
ruby_bin_dir="$(cd "$(dirname "$ruby_bin")" && pwd)"
export PATH="$GEM_HOME/bin:$ruby_bin_dir:$PATH"
export GEM_PATH="$GEM_HOME:$($ruby_bin -e 'puts Gem.path.join(":")')"
if ! "$ruby_bin" -S gem list --local cocoapods -v 1.16.2 --installed; then
  "$ruby_bin" -S gem install cocoapods -v 1.16.2 --no-document --install-dir "$GEM_HOME"
fi
pod install --project-directory="$project_dir"
