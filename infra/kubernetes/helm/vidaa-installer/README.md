# Playarr VIDAA installer chart

This chart supplies every app-owned VIDAA resource: an opt-in `vidaahub.com`
DNS fragment, Emissary TLS routing to Playarr's hosted fixed-purpose installer,
the upstream TLSContext and the optional public Playarr Mapping that consumes
it. It does not deploy a DNS server or a second copy of the portal.

Both features are disabled by default. DNS interception should be enabled only
for the installation window and then returned to `disabled`.

## Prerequisites

- The cluster-managed LAN resolver must watch ConfigMaps labelled
  `lan-dns.example.com/enabled: "true"`, import `*.server` data before its
  unfiltered catch-all, provide the `lan-dns-common` CoreDNS snippet, and set
  `LAN_DNS_TARGET_IPV4` in the CoreDNS container.
- Emissary-ingress must already have HTTP and HTTPS Listeners that discover the
  release namespace.
- A certificate and matching key for `vidaahub.com` that the target television
  accepts must already be available. Provision them as a `kubernetes.io/tls`
  Secret in the release namespace; never put either file or its contents in
  Git or Helm values.

For example, provision an already-approved certificate without printing it:

```sh
kubectl -n <namespace> create secret tls vidaa-portal-tls \
  --cert=<certificate-path> \
  --key=<private-key-path>
```

## Install safely

Install the inactive release first:

```sh
helm upgrade --install vidaa-installer ./infra/kubernetes/helm/vidaa-installer \
  --namespace <namespace>
```

Enable the Emissary route once its Secret exists:

```yaml
ingress:
  enabled: true
  tlsSecretName: vidaa-portal-tls

upstream:
  enabled: true
  tlsSecretName: vidaa-portal-tls
  publicRoute:
    enabled: true
    hostname: playarr.example.com
```

The generated wildcard `Host` supplies the certificate to SNI and legacy
no-SNI clients, but its label selector associates it only with this chart's
exact `vidaahub.com` `Mapping`. Requests are forwarded to
`https://playarr.app/vidaa-store/`; suffixes are preserved and the upstream
Host is rewritten to `playarr.app`. The optional public Mapping uses the same
upstream TLSContext and remains an ordinary Emissary route; neither resource
requires Headscale or Tailscale.

Prefer a one-device allowlist during installation:

```yaml
dns:
  mode: allowlist
  clients:
    # Documentation-only TEST-NET address; replace it in an untracked values file.
    - cidr: 192.0.2.10/32
      enabled: true
```

`allowlist` renders no DNS fragment until at least one client is enabled.
`all` intercepts the name for every client admitted by the resolver's own LAN
ACL. For matching clients, an A query returns the resolver's configured target
address and every other IN query type returns NOERROR with an empty answer.
Unmatched clients continue to the resolver's normal public-DNS path.

Return `dns.mode` to `disabled` immediately after the launcher is installed.
The permanent resolver can remain configured because disabling this fragment
does not affect its development aliases or public recursion.

## Validate

```sh
helm lint ./infra/kubernetes/helm/vidaa-installer
bash ./infra/kubernetes/helm/vidaa-installer/tests/render.sh
```

Before using a real television, also verify UDP and TCP DNS behavior from an
allowed and a non-allowed source, inspect Emissary's accepted configuration,
and test TLS with and without SNI. Firmware-specific installation still
requires validation on the target device.
