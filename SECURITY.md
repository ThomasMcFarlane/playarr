# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through
GitHub's "Report a vulnerability" button on the repository's Security tab (private
vulnerability reporting), or email <thomas@mcfarlane.email> with a description, affected
component and version, and steps to reproduce.

You can expect an acknowledgement within a few days. Please allow reasonable time for a fix
before disclosing details publicly; reporters are credited in the changelog unless they prefer
otherwise.

## Scope

In scope: Playarr Server (`backend/`), the Playarr clients (`clients/`), the marketing site
(`site/`) and the deployment templates in `infra/`.

Out of scope: vulnerabilities in third-party software (Sonarr, Radarr, Tdarr and so on), and
deployments run by someone else. Report those to their operators.

## Supported versions

Only the latest release and the current `main` branch receive security fixes while the project
is pre-1.0.

## Secrets in contributions

Never commit credentials, tokens, keys, real hostnames or addresses. CI scans for these
(`gitleaks` and `scripts/ci/check-env-data.sh`). If you find one in the history, report it
privately as above.
