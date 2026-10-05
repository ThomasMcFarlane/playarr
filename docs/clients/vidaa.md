# Using Playarr on a Hisense VIDAA TV

Playarr runs on VIDAA televisions as the hosted Web client. The built-in Browser
route is the reliable default; compatible firmware may also install a dedicated
launcher tile through Playarr's experimental custom store. There is no
Playarr APK or USB package for VIDAA.

## Before you start

1. Update the TV under **Settings > Support > System Upgrade > Check Firmware
   Upgrade**.
2. Put the TV and Playarr Server on the same trusted home network.
3. Open <https://playarr.app> from another phone or computer and confirm that
   you can connect to your Playarr Server and sign in.

Use HTTPS if the server already has a certificate trusted by the television.
Plain HTTP may work in the Browser on a trusted, isolated home LAN, but it must
not be exposed directly to the internet.

## Open Playarr on the TV

1. Open the **Browser** application on the TV.
2. Enter `https://playarr.app/?platform=tv-vidaa`.
3. When Playarr loads, save it as a Browser favourite if the television offers
   that option.
4. Sign in with the same Playarr Server account you use on other devices.

The `platform=tv-vidaa` marker is saved after the first visit. It identifies the
TV correctly to Playarr Server and selects a conservative VIDAA playback profile;
normal in-app navigation does not need to keep the query string visible.

## About launcher installation

The [Playarr Clients page](https://playarr.app/clients/vidaa) links to the hosted,
fixed-purpose custom-store assets at `https://playarr.app/vidaa-store/`. The store
can install only the fixed `https://playarr.app/?platform=tv-vidaa` launcher.
Playarr does not operate a public DNS resolver.

1. Choose a DNS, proxy, or self-hosted interception method you understand and
   trust. It must be capable of presenting the custom store as `vidaahub.com`;
   a DNS record alone cannot solve HTTPS hostname and certificate validation.
2. Temporarily set that solution's IPv4 resolver on the TV or router, or enable
   its source-IP policy for this television if it is already the network's
   permanent resolver. Keep every other network setting unchanged.
3. Open the VIDAA store or Browser route required by that solution. Accept a
   certificate warning only when you understand and trust its certificate setup.
4. Choose **Install Playarr**, restart the television, and confirm the tile opens.
5. Restore automatic DNS or disable the `vidaahub.com` interception immediately,
   even if installation did not succeed. A permanent resolver may remain in use
   when that interception policy is disabled.

Firmware support varies: some televisions reject the portal certificate or do
not expose either supported installation API. The
installer must therefore remain labelled experimental and must not replace the
Browser route or the official VIDAA partner distribution path. Do not use random
service-menu codes, firmware downgrades, or third-party firmware.

### Repository-managed k3s installation

Operators running a cluster LAN resolver (CoreDNS importing labelled `*.server` ConfigMaps) can deploy the
`infra/kubernetes/helm/vidaa-installer` Helm chart; its `README.md` is the
operator guide.
It reuses the hosted `playarr.app/vidaa-store/` portal and keeps both its DNS
interception and Emissary route explicitly opt-in. Use its one-device
`allowlist` mode for installation and return the mode to `disabled` afterward;
do not commit the television address, certificate, or private key.

## Register and publish through the VIDAA App Store

VIDAA does not offer immediate, self-service App Store publishing. Its public
registration form collects account details, but its current privacy notice
describes the Partner Portal as invite-only. Registration is therefore a
request for partner access, not approval to publish.

1. Open the official [VIDAA Partner Support](https://www.vidaa.com/partner-support/)
   page and select **Partner portal sign up**.
2. Enter the requested first name, last name, company, email address, and
   password, then submit the form. Use a company-controlled email address where
   possible.
3. Complete any email verification and try the **Partner login** on the same
   page. A registered account may still lack partner content until VIDAA grants
   access.
4. If access remains restricted, submit an enquiry through
   [VIDAA Support](https://www.vidaa.com/support/) with the company name,
   Playarr product description, target countries, requested VIDAA versions,
   support contact, and intended self-hosted deployment model.
5. After VIDAA approves the relationship, use the private portal and assigned
   partner contact for the current SDK/DevKit, test-device activation, listing
   requirements, certification, territory selection, and production release.

The private submission screens and certification requirements are governed by
separate developer terms, so they cannot be completed or accurately documented
before partner access is granted.

### Playarr submission gap

The current Playarr VIDAA client is a public bootstrap at `playarr.app` that
connects to each viewer's Playarr Server. Before an App Store submission,
confirm this delivery model with VIDAA or agree an alternative:

- the existing public HTTPS Playarr bootstrap that lets the user configure or
  navigate to their private Playarr Server; or
- a VIDAA-packaged shell, if the partner programme permits it, with equivalent
  server configuration.

The chosen model must be tested for local-network navigation, HTTP/HTTPS mixed
content, authentication, remote-control navigation, media codecs, and upgrades
on the VIDAA versions and territories selected for release. The partner portal
will also require the final listing metadata, artwork, privacy policy, support
details, and reviewer access requested by VIDAA.

Check the installed VIDAA version under **Settings > Support > About** when
reporting compatibility problems.

## Official references

- [VIDAA Partner Support and registration](https://www.vidaa.com/partner-support/)
- [VIDAA Partner Portal terms](https://www.vidaa.com/terms-and-conditions/)
- [VIDAA privacy notice](https://www.vidaa.com/privacy-policy-2026/)
- [Optional self-hosted VIDAA gateway reference](https://github.com/ThomasMcFarlane/playarr/blob/main/infra/vidaa-gateway/README.md)
