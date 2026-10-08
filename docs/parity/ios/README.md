# iOS parity with the web mobile layout

Reference: the committed shared captures docs/parity/web/mobile/{light,dark} (390x844 CSS px at 3x). Candidate: the iOS app on an
iPhone simulator (1170x2532), driven by .github/workflows/parity-apple.yml (platform ios) on GitHub-hosted macos-latest against a
fresh fixture database, status bar and home indicator masked. Diff: scripts/parity/diff.mjs (pixelmatch 0.1, target 1% or less).
The captures here are the native frames at a third of the size (390x844, 64 colours); the workflow artifact has the full ones.

| Screen | Dark | Light |
| --- | --- | --- |
| home | 1.12% (over) | 2.19% (over) |
| movies | 6.50% (over) | 14.33% (over) |
| series | 3.49% (over) | 9.16% (over) |
| film-detail | 1.58% (over) | 4.48% (over) |
| series-detail | 5.74% (over) | 2.60% (over) |
| search | 0.88% | 0.96% |
| calendar | 2.74% (over) | 3.06% (over) |
| settings | 1.05% (over) | 1.06% (over) |
| settings-avatar | 0.48% | 0.37% |
| settings-language | 0.41% | 0.34% |
| settings-player | 1.90% (over) | 2.37% (over) |
| settings-server | 1.45% (over) | 1.43% (over) |
| settings-lock | 0.28% | 0.27% |
| settings-invite | 0.94% | 0.86% |
| settings-remote | 1.52% (over) | 1.24% (over) |
| settings-latency | 0.40% | 0.37% |
| settings-your-data | 2.86% (over) | 2.23% (over) |
| downloads | 0.29% | 0.20% |
| watchlist | 0.31% | 0.21% |
| requests | 0.30% | 0.20% |
| player-controls | 0.13% | 0.13% |
| player-quality-menu | 0.91% | 0.93% |
| profile-switcher | 1.40% (over) | 0.89% |
| household-blocked | 0.92% | 0.99% |

## Known differences

- movies and series: the committed mobile references for these two screens (both themes) were captured without the fixture artwork
  (grey title tiles), while the app and a fresh web capture on the runner show the artwork. The references need recapturing with the
  artwork; the native layout matches a fresh web capture.
- home: the references still show the Customise Home button; the owner moved Customise Home to Settings, so the app no longer draws it
  and the references will follow the web change.
- Scrolled states with edge fades (Home rails, library grid, agenda, settings) are not yet captured for iOS.
- Remaining text-heavy screens (film and series detail, calendar, settings panels) sit between 1% and 6%; the cause is 1 px line-box
  offsets and the artwork under the title, not layout.
