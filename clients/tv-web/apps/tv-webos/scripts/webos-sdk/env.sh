#!/usr/bin/env bash
# Source this file before using the other scripts in this directory, or just
# call those scripts directly -- each of them sources this itself.
#
# These paths live under $HOME, not the repo: they're multi-hundred-MB to
# multi-GB external tool/VM installs, not project source.

export LG_WEBOS_TV_SDK_HOME="${LG_WEBOS_TV_SDK_HOME:-$HOME/webOS_TV_SDK}"
export WEBOS_OSE_EMULATOR_HOME="${WEBOS_OSE_EMULATOR_HOME:-$HOME/webos-ose-emulator}"
