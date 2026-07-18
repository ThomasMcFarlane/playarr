import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { LanguageDropdown } from "../components/LanguageDropdown";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useTvNavigation } from "../lib/useTvNavigation";
import "./Clients.css";

type ClientStatus = "available" | "experimental" | "soon";

interface PlayarrClient {
  id: string;
  nameKey: TranslationKey;
  platformKey: TranslationKey;
  descriptionKey: TranslationKey;
  status: ClientStatus;
  action?: "open" | "vidaa";
  glyph: string;
}

const PLAYARR_CLIENTS: readonly PlayarrClient[] = [
  {
    id: "web",
    nameKey: "pages.clients.web.name",
    platformKey: "pages.clients.web.platform",
    descriptionKey: "pages.clients.web.description",
    status: "available",
    action: "open",
    glyph: "W",
  },
  {
    id: "vidaa",
    nameKey: "pages.clients.vidaa.name",
    platformKey: "pages.clients.vidaa.platform",
    descriptionKey: "pages.clients.vidaa.description",
    status: "experimental",
    action: "vidaa",
    glyph: "V",
  },
  {
    id: "android-mobile",
    nameKey: "pages.clients.androidMobile.name",
    platformKey: "pages.clients.androidMobile.platform",
    descriptionKey: "pages.clients.androidMobile.description",
    status: "soon",
    glyph: "A",
  },
  {
    id: "android-tv",
    nameKey: "pages.clients.androidTv.name",
    platformKey: "pages.clients.androidTv.platform",
    descriptionKey: "pages.clients.androidTv.description",
    status: "soon",
    glyph: "TV",
  },
  {
    id: "ios",
    nameKey: "pages.clients.ios.name",
    platformKey: "pages.clients.ios.platform",
    descriptionKey: "pages.clients.ios.description",
    status: "soon",
    glyph: "i",
  },
  {
    id: "webos",
    nameKey: "pages.clients.webos.name",
    platformKey: "pages.clients.webos.platform",
    descriptionKey: "pages.clients.webos.description",
    status: "soon",
    glyph: "LG",
  },
  {
    id: "tizen",
    nameKey: "pages.clients.tizen.name",
    platformKey: "pages.clients.tizen.platform",
    descriptionKey: "pages.clients.tizen.description",
    status: "soon",
    glyph: "S",
  },
];

const STATUS_KEYS: Record<ClientStatus, TranslationKey> = {
  available: "pages.clients.status.available",
  experimental: "pages.clients.status.experimental",
  soon: "pages.clients.status.soon",
};

interface VidaaActivation {
  resolverIpv4: string;
  expiresAt: string;
  portalUrl: string;
  deactivationToken: string;
}

const VIDAA_INSTALLER_API_URL =
  import.meta.env.VITE_VIDAA_INSTALLER_API_URL?.replace(/\/$/, "") ??
  "https://dns.playarr.app";

export class VidaaActivationError extends Error {}

export async function activateVidaaInstaller(
  request: typeof fetch = fetch,
  baseUrl = VIDAA_INSTALLER_API_URL,
  timeoutMs = 10_000
): Promise<VidaaActivation> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await request(`${baseUrl.replace(/\/$/, "")}/v1/activations/self`, {
      method: "POST",
      signal: controller.signal,
    });
  } catch {
    throw new VidaaActivationError("unavailable");
  } finally {
    globalThis.clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new VidaaActivationError("unavailable");
  }

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const resolverIpv4 = data?.dns_server;
  const expiresAt = data?.expires_at;
  const portalUrl = data?.portal_url;
  const deactivationToken = data?.deactivation_token;
  if (
    typeof resolverIpv4 !== "string" ||
    !isIpv4Address(resolverIpv4) ||
    typeof expiresAt !== "string" ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    typeof portalUrl !== "string" ||
    !isHttpsUrl(portalUrl) ||
    typeof deactivationToken !== "string" ||
    deactivationToken.length < 1
  ) {
    throw new VidaaActivationError("invalid-response");
  }

  return { resolverIpv4, expiresAt, portalUrl, deactivationToken };
}

export function isIpv4Address(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function PublicClientsLayout({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const location = useLocation();
  useTvNavigation(location.pathname);

  return (
    <div className="clients-shell">
      <header className="clients-header">
        <Link className="clients-brand" to="/clients" aria-label={t("pages.clients.brandAriaLabel")}>
          <img src="/playarr-icon.svg" alt="" />
          <span>Playarr</span>
        </Link>
        <nav className="clients-header-actions" aria-label={t("pages.clients.headerNavAriaLabel")}>
          <Link className="clients-header-link is-active" to="/clients">
            {t("pages.clients.navClients")}
          </Link>
          <LanguageDropdown className="clients-language" />
          <Link className="clients-open-link" to="/" data-navigation-focus-key="clients:open">
            {t("pages.clients.openWeb")}
            <span aria-hidden="true">↗</span>
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}

export function ClientsPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("pages.clients.documentTitle"));

  return (
    <PublicClientsLayout>
      <main
        className="clients-scroll"
        data-tv-scroll-container
        data-tv-scroll-axis="vertical"
        data-navigation-scroll-key="clients:index"
      >
        <section className="clients-hero" aria-labelledby="clients-title">
          <p className="clients-kicker">{t("pages.clients.kicker")}</p>
          <h1 id="clients-title">{t("pages.clients.title")}</h1>
          <p>{t("pages.clients.description")}</p>
        </section>

        <section className="clients-grid" aria-label={t("pages.clients.gridAriaLabel")}>
          {PLAYARR_CLIENTS.map((client, index) => (
            <article className={`client-card is-${client.status}`} key={client.id}>
              <div className="client-card-topline">
                <span className="client-glyph" aria-hidden="true">
                  {client.glyph}
                </span>
                <span className={`client-status is-${client.status}`}>
                  <span aria-hidden="true" />
                  {t(STATUS_KEYS[client.status])}
                </span>
              </div>
              <div className="client-card-copy">
                <p>{t(client.platformKey)}</p>
                <h2>{t(client.nameKey)}</h2>
                <span>{t(client.descriptionKey)}</span>
              </div>
              {client.action === "open" ? (
                <Link
                  className="client-card-action"
                  to="/"
                  data-tv-focus-default={index === 0 ? true : undefined}
                  data-navigation-focus-key="clients:web"
                >
                  {t("pages.clients.openWeb")}
                  <span aria-hidden="true">↗</span>
                </Link>
              ) : client.action === "vidaa" ? (
                <Link
                  className="client-card-action"
                  to="/clients/vidaa"
                  data-navigation-focus-key="clients:vidaa"
                >
                  {t("pages.clients.vidaaSetup")}
                  <span aria-hidden="true">→</span>
                </Link>
              ) : (
                <span className="client-card-coming">{t("pages.clients.notYetPublished")}</span>
              )}
            </article>
          ))}
        </section>

        <footer className="clients-footer">
          <img src="/playarr-icon.svg" alt="" />
          <p>{t("pages.clients.footer")}</p>
        </footer>
      </main>
    </PublicClientsLayout>
  );
}

export function VidaaClientsPage() {
  const { t, language } = useLanguage();
  const [activation, setActivation] = useState<VidaaActivation | null>(null);
  const [activating, setActivating] = useState(false);
  const [activationError, setActivationError] = useState(false);
  useDocumentTitle(t("pages.clients.vidaaPage.documentTitle"));

  async function activate() {
    setActivating(true);
    setActivationError(false);
    try {
      setActivation(await activateVidaaInstaller());
    } catch {
      setActivationError(true);
    } finally {
      setActivating(false);
    }
  }

  return (
    <PublicClientsLayout>
      <main
        className="clients-scroll vidaa-scroll"
        data-tv-scroll-container
        data-tv-scroll-axis="vertical"
        data-navigation-scroll-key="clients:vidaa"
      >
        <Link
          className="clients-back-link"
          to="/clients"
          data-tv-focus-default
          data-navigation-focus-key="clients:vidaa:back"
        >
          <span aria-hidden="true">←</span>
          {t("pages.clients.vidaaPage.back")}
        </Link>

        <section className="vidaa-hero" aria-labelledby="vidaa-title">
          <div>
            <p className="clients-kicker">{t("pages.clients.vidaaPage.kicker")}</p>
            <h1 id="vidaa-title">{t("pages.clients.vidaaPage.title")}</h1>
            <p className="vidaa-lead">{t("pages.clients.vidaaPage.description")}</p>
          </div>
          <aside className="vidaa-experimental">
            <span>{t("pages.clients.status.experimental")}</span>
            <p>{t("pages.clients.vidaaPage.experimentalNote")}</p>
          </aside>
        </section>

        <section className="vidaa-activation" aria-labelledby="vidaa-activation-title">
          <div className="vidaa-section-heading">
            <span>01</span>
            <div>
              <p>{t("pages.clients.vidaaPage.activationKicker")}</p>
              <h2 id="vidaa-activation-title">{t("pages.clients.vidaaPage.activationTitle")}</h2>
            </div>
          </div>
          <p className="vidaa-section-copy">{t("pages.clients.vidaaPage.activationDescription")}</p>

          {!activation ? (
            <div className="vidaa-activate-row">
              <button
                type="button"
                className="vidaa-activate-button"
                disabled={activating}
                onClick={() => void activate()}
                data-navigation-focus-key="clients:vidaa:activate"
              >
                {activating
                  ? t("pages.clients.vidaaPage.activating")
                  : t("pages.clients.vidaaPage.activate")}
              </button>
              <p>{t("pages.clients.vidaaPage.sameNetwork")}</p>
            </div>
          ) : (
            <div className="vidaa-activation-result" role="status">
              <div>
                <span>{t("pages.clients.vidaaPage.dnsLabel")}</span>
                <strong>{activation.resolverIpv4}</strong>
              </div>
              <div>
                <span>{t("pages.clients.vidaaPage.expiresLabel")}</span>
                <strong>
                  {new Intl.DateTimeFormat(language === "th" ? "th-TH" : language === "ja" ? "ja-JP" : "en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(activation.expiresAt))}
                </strong>
              </div>
              <div>
                <span>{t("pages.clients.vidaaPage.portalLabel")}</span>
                <strong>{activation.portalUrl}</strong>
              </div>
            </div>
          )}

          {activationError ? (
            <div className="vidaa-activation-error" role="alert">
              <strong>{t("pages.clients.vidaaPage.unavailableTitle")}</strong>
              <p>{t("pages.clients.vidaaPage.unavailableDescription")}</p>
            </div>
          ) : null}
        </section>

        <section className="vidaa-steps" aria-labelledby="vidaa-steps-title">
          <div className="vidaa-section-heading">
            <span>02</span>
            <div>
              <p>{t("pages.clients.vidaaPage.installKicker")}</p>
              <h2 id="vidaa-steps-title">{t("pages.clients.vidaaPage.installTitle")}</h2>
            </div>
          </div>
          <ol>
            {([1, 2, 3, 4] as const).map((step) => (
              <li key={step}>
                <span>0{step}</span>
                <div>
                  <h3>{t(`pages.clients.vidaaPage.step${step}Title`)}</h3>
                  <p>{t(`pages.clients.vidaaPage.step${step}Description`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="vidaa-safety" aria-labelledby="vidaa-safety-title">
          <p className="clients-kicker">{t("pages.clients.vidaaPage.aftercareKicker")}</p>
          <h2 id="vidaa-safety-title">{t("pages.clients.vidaaPage.aftercareTitle")}</h2>
          <p>{t("pages.clients.vidaaPage.aftercareDescription")}</p>
        </section>
      </main>
    </PublicClientsLayout>
  );
}
