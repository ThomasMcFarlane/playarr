import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { ProfileAuthLayout } from "../components/ProfileAuthLayout";
import { useDocumentTitle } from "../lib/useDocumentTitle";

const LEGAL_ROUTES = [
  ["/legal/privacy", "Privacy"],
  ["/legal/terms", "Terms"],
  ["/legal/acceptable-use", "Acceptable use"],
  ["/legal/licences", "Licences"],
  ["/legal/account-deletion", "Account deletion"],
] as const;

function LegalPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  useDocumentTitle(title);

  return (
    <ProfileAuthLayout className="login-profile-page legal-profile-page">
      <nav className="legal-navigation" aria-label="Legal pages">
        {LEGAL_ROUTES.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `legal-navigation-link${isActive ? " is-active" : ""}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <header className="legal-heading">
        <p className="page-kicker">Legal</p>
        <h1 className="auth-title">{title}</h1>
        <p className="muted auth-description">{description}</p>
      </header>
      <article className="legal-copy">{children}</article>
    </ProfileAuthLayout>
  );
}

export function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      description="How the Playarr Android app, web app, self-hosted server and public linking service handle data."
    >
      <p className="legal-effective-date">Effective 28 August 2026</p>

      <section>
        <h2>Who this policy covers</h2>
        <p>
          This policy applies to the Playarr Android application with package name
          <code>app.playarr.mobile</code>, the Playarr web application at
          <a href="https://playarr.app"> playarr.app</a>, and the short-lived device-linking
          service on that domain. Playarr connects to a Playarr Server chosen and operated by
          you or your server administrator.
        </p>
      </section>

      <section>
        <h2>Data held on your device</h2>
        <p>
          The app stores the server addresses you add, a random per-install device identifier,
          authentication and refresh tokens, profile and display preferences, download records,
          downloaded media, and playback progress waiting to sync. This information stays on your
          device unless the app sends it to the Playarr Server you selected as part of a feature
          you use.
        </p>
        <p>
          Clear the app's storage or uninstall it to remove its local data. Downloaded media can
          also be removed from within the app.
        </p>
      </section>

      <section>
        <h2>Your self-hosted Playarr Server</h2>
        <p>
          Sign-in details go directly to your selected Playarr Server. The server may hold account
          and profile details, library metadata, artwork, watch history, playlists, download and
          playback state, server addresses, device identifiers, sessions, invitations and push
          notification registrations. The person or organisation operating that server controls
          this data, its backups, retention and deletion. Playarr's hosted service does not receive
          your password, library, watch history or media files.
        </p>
        <p>
          Ask your server administrator to correct or delete server-side account data. Server
          administrators can also revoke sessions and remove push registrations.
        </p>
      </section>

      <section>
        <h2>Device linking</h2>
        <p>
          When you use a Playarr device-link code, playarr.app temporarily stores a random device
          secret, the server addresses you approve, the client platform and a single-use code. The
          record expires after five minutes, with only a brief redemption grace period, and is then
          deleted. It does not contain a password, library data, bearer token or refresh token.
        </p>
      </section>

      <section>
        <h2>Notifications and Google services</h2>
        <p>
          In production Android builds configured for invite notifications, Google Firebase Cloud
          Messaging creates an app-installation identifier and push token after you sign in. The
          token is registered with your selected Playarr Server so it can deliver invitation
          notifications; notification permission controls whether Android displays them. Playarr
          does not use Firebase Analytics, advertising SDKs or cross-app tracking. Google's
          handling of Firebase data is governed by its own terms and privacy policy.
        </p>
      </section>

      <section>
        <h2>Website and operational data</h2>
        <p>
          playarr.app does not use advertising cookies, analytics pixels or behavioural profiling.
          The signed-in web app can store server addresses, device identifiers, names, access and
          refresh tokens, interface preferences, download records and media, and playback progress
          waiting to sync in your browser. Hosting and network providers may process ordinary
          request information such as an IP address, timestamp, requested path and user agent for
          delivery, reliability and abuse prevention. Playarr does not sell personal data.
        </p>
      </section>

      <section>
        <h2>Security, retention and deletion</h2>
        <p>
          The hosted playarr.app service and the Google Play Android app require HTTPS. Sideloaded
          builds can also connect to an HTTP address chosen by you or your administrator, so only
          use an unencrypted address on a network you trust. Local records remain until removed in
          the app, cleared by the operating system or removed by uninstalling. Server-side records
          and backups follow the server operator's retention policy. Device-link records expire
          automatically as described above.
        </p>
        <p>
          To request deletion of an account and associated server-side data, follow the
          <NavLink to="/legal/account-deletion"> account-deletion instructions</NavLink>. Signing
          out does not itself delete a server account or all local records.
        </p>
      </section>

      <section>
        <h2>Your choices and privacy contact</h2>
        <p>
          You can avoid the hosted linking service by entering a server address and signing in
          directly. You can disable notifications, remove downloads, sign out, clear app storage or
          uninstall the app at any time. Playarr is developed by Thomas McFarlane. For privacy
          questions, email <a href="mailto:support@playarr.app">support@playarr.app</a>. You can
          also use the contact method on the
          <a href="https://github.com/ThomasMcFarlane/playarr"> Playarr repository</a>. Do not put
          passwords, tokens or private information in a public issue.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          This page will be updated before Playarr materially changes the data it collects, uses,
          shares or retains. The effective date above identifies the current version.
        </p>
      </section>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      description="The conditions that apply when you use Playarr software and the public playarr.app service."
    >
      <p className="legal-effective-date">Effective 28 August 2026</p>
      <section>
        <h2>Using Playarr</h2>
        <p>
          By using Playarr or playarr.app, you agree to these terms and the
          <NavLink to="/legal/acceptable-use"> acceptable-use policy</NavLink>. If you do not
          agree, do not use the software or hosted service.
        </p>
      </section>
      <section>
        <h2>Your server and media</h2>
        <p>
          Playarr supplies no media. You are responsible for the server you connect to, the
          accounts you create, the media you store or play, the people you invite and compliance
          with the laws that apply to you.
        </p>
      </section>
      <section>
        <h2>Service availability</h2>
        <p>
          The public linking service is provided as a convenience and may change, be interrupted or
          be withdrawn. Keep direct access to your self-hosted server available; the hosted service
          is not a backup for your server or data.
        </p>
      </section>
      <section>
        <h2>Software licence and warranty</h2>
        <p>
          Playarr's source is made available under the MIT licence described on the
          <NavLink to="/legal/licences"> licences page</NavLink>. To the maximum extent permitted
          by law, the software and hosted service are provided ‘as is’, without warranties, and the
          developers are not liable for indirect, incidental, special or consequential loss.
        </p>
      </section>
      <section>
        <h2>Changes</h2>
        <p>
          Material changes will be published on this page with a new effective date. Continuing to
          use the hosted service after a change means accepting the revised terms.
        </p>
      </section>
    </LegalPage>
  );
}

export function AcceptableUsePage() {
  return (
    <LegalPage
      title="Acceptable use"
      description="Playarr catalogues and plays media already held on storage controlled by its operator."
    >
      <section>
        <h2>What Playarr is</h2>
        <p>
          Playarr is a media server and client family. It catalogues media already present on
          storage controlled by a server operator and streams it to authorised clients.
        </p>
      </section>
      <section>
        <h2>What Playarr is not</h2>
        <p>
          Playarr supplies no media, sources of media or means of obtaining media. It does not
          search public indexes or ship preconfigured links to external content.
        </p>
      </section>
      <section>
        <h2>Your responsibility</h2>
        <p>
          You are responsible for the legality of what you store, play and share, and for ensuring
          that every person you invite is allowed to access it. Do not use Playarr to infringe
          rights, evade access controls, distribute unlawful material, harm others or interfere
          with the service.
        </p>
      </section>
      <section>
        <h2>Enforcement</h2>
        <p>
          The project will not assist with obtaining media and may reject support requests or block
          hosted-service use that violates this policy, threatens the service or creates legal or
          security risk.
        </p>
      </section>
    </LegalPage>
  );
}

export function LicencesPage() {
  return (
    <LegalPage
      title="Licences and attribution"
      description="Open-source licensing, required notices and third-party attribution for Playarr."
    >
      <section>
        <h2>Playarr</h2>
        <p>
          Playarr's own source code is released under the MIT licence. Copyright © 2026 Thomas
          McFarlane and Playarr contributors. The complete licence text and source are available in
          the <a href="https://github.com/ThomasMcFarlane/playarr">Playarr repository</a>.
        </p>
      </section>
      <section>
        <h2>FFmpeg</h2>
        <p>
          This software uses libraries from the FFmpeg project under the GNU General Public Licence
          version 2 or later. FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg
          project. Playarr is not affiliated with, endorsed by, or the owner of FFmpeg. FFmpeg runs
          as a separate server process and is not embedded in the Playarr Android application.
        </p>
      </section>
      <section>
        <h2>TMDB</h2>
        <p>
          This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise
          approved by TMDB. Metadata and artwork may reach a self-hosted Playarr Server through
          library-management tools selected by its operator.
        </p>
      </section>
      <section>
        <h2>Third-party marks</h2>
        <p>
          Playarr is independent and is not affiliated with or endorsed by Plex, Jellyfin, Emby,
          Apple, Google, LG, Samsung, Hisense, Roku or TMDB. Their trademarks belong to their
          respective owners.
        </p>
      </section>
    </LegalPage>
  );
}

export function AccountDeletionPage() {
  return (
    <LegalPage
      title="Account deletion"
      description="How to request deletion of a Playarr account and its associated data."
    >
      <section>
        <h2>Request deletion from your server operator</h2>
        <p>
          Playarr accounts belong to the self-hosted Playarr Server on which they were created.
          Contact that server's administrator and ask them to delete your user account, profiles,
          sessions, push registrations, playback history, playlists and other associated data. Give
          them the server address and username, but never send a password, access token or profile
          PIN.
        </p>
      </section>
      <section>
        <h2>Remove data from your devices</h2>
        <p>
          After the administrator confirms deletion, sign out, remove downloaded media, then clear
          Playarr's app storage or uninstall it on every device. In a browser, clear site data for
          the Playarr web app. Signing out alone does not delete the server account or every local
          record.
        </p>
      </section>
      <section>
        <h2>Need help identifying the operator?</h2>
        <p>
          The server address shown in Playarr identifies the independently operated service that
          controls the account. If playarr.app itself retained a short-lived device-link record, it
          expires automatically within minutes as described in the
          <NavLink to="/legal/privacy"> privacy policy</NavLink>.
        </p>
      </section>
    </LegalPage>
  );
}
