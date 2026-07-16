# Using Playarr on a Hisense VIDAA TV

Playarr runs on VIDAA televisions in the built-in Browser. There is no Playarr
APK, USB package, or generally available household sideload route for VIDAA.
Adding a dedicated launcher tile requires VIDAA App Store distribution or
developer access supplied by VIDAA for the target television.

## Before you start

1. Update the TV under **Settings > Support > System Upgrade > Check Firmware
   Upgrade**.
2. Put the TV and Streamarr server on the same trusted home network.
3. Find the Playarr Web address exposed by the Streamarr server. For example,
   a development server configured on port 18080 might be available as
   `http://streamarr.local:18080`. Do not assume port 8080: deployments can use
   a different port, and development services on 8080 may listen only on the
   server itself.
4. Open that address from another phone or computer on the same LAN. Do not use
   `localhost`: on the TV that means the television itself.
5. Confirm the normal Playarr page loads and you can sign in.

Use HTTPS if the server already has a certificate trusted by the television.
Plain HTTP may work in the Browser on a trusted, isolated home LAN, but it must
not be exposed directly to the internet.

## Open Playarr on the TV

1. Open the **Browser** application on the TV.
2. Enter the verified Playarr address with `?platform=tv-vidaa` appended, for
   example `http://streamarr.local:18080/?platform=tv-vidaa`.
3. When Playarr loads, save it as a Browser favourite if the television offers
   that option.
4. Sign in with the same Streamarr account you use on other devices.

The `platform=tv-vidaa` marker is saved after the first visit. It identifies the
TV correctly to Streamarr and selects a conservative VIDAA playback profile;
normal in-app navigation does not need to keep the query string visible.

## About launcher installation

Older VIDAA firmware sometimes exposed an undocumented `hisense://debug`
scheme. It is invalid, removed, or developer-password-protected on many current
models and must not be treated as a supported installation method. Do not try
random service-menu codes, DNS interception, firmware downgrades, or third-party
firmware to enable it.

For a dedicated Playarr tile, the supported route is a VIDAA App Store or
partner/developer deployment. Until that distribution exists, use the Browser
favourite. If the Browser cannot run Playarr reliably, use casting supported by
the TV or connect a supported Android TV/Google TV device and install Playarr
there.

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

The current Playarr VIDAA URL is a private, per-household Streamarr address. It
is suitable for the TV Browser, but it is not a single production origin that
VIDAA can review and publish globally. Before an App Store submission, agree one
of these delivery models with VIDAA:

- a public HTTPS Playarr bootstrap app that lets the user configure or navigate
  to their private Streamarr server; or
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
