#!/usr/bin/env python3
"""FORBIDDEN: WebView / SPA AE parity is not the Android TV product path.

Android TV is fully native Jetpack Compose + Media3.
Do not reintroduce Chromium freezes, WebView shells, or SPA residual closers
as the criterion for television parity.

See:
  docs/architecture/client-principles.md
  docs/architecture/clients/android-tv.md
  clients/android/AGENTS.md
"""
import sys
print(
    "FORBIDDEN: Android TV parity is native Compose only. "
    "WebView/SPA AE gates are banned. See clients/android/AGENTS.md",
    file=sys.stderr,
)
raise SystemExit(2)
