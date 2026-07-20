import type { ReactNode } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { TvStageChrome } from "../components/tv/TvStage";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useTvNavigation } from "../lib/useTvNavigation";
import "./Clients.css";

type ClientStatus = "available" | "experimental" | "soon";
type ClientIcon = "vidaa" | "android" | "apple" | "lg" | "samsung" | "roku";

interface PlayarrClient {
  id: string;
  nameKey: TranslationKey;
  platformKey: TranslationKey;
  descriptionKey?: TranslationKey;
  status: ClientStatus;
  action?: "android" | "vidaa";
  downloadFile?: string;
  icon: ClientIcon;
}

const CLIENT_PREVIEW_RELEASE_BASE =
  "https://github.com/ThomasMcFarlane/streamarr/releases/download/clients-v0.1.0-preview.1";

const PLAYARR_CLIENTS: readonly PlayarrClient[] = [
  {
    id: "vidaa",
    nameKey: "pages.clients.vidaa.name",
    platformKey: "pages.clients.vidaa.platform",
    status: "experimental",
    action: "vidaa",
    icon: "vidaa",
  },
  {
    id: "android",
    nameKey: "pages.clients.android.name",
    platformKey: "pages.clients.android.platform",
    status: "available",
    action: "android",
    icon: "android",
  },
  {
    id: "apple",
    nameKey: "pages.clients.apple.name",
    platformKey: "pages.clients.apple.platform",
    descriptionKey: "pages.clients.ios.description",
    status: "soon",
    icon: "apple",
  },
  {
    id: "webos",
    nameKey: "pages.clients.webos.name",
    platformKey: "pages.clients.webos.platform",
    descriptionKey: "pages.clients.webos.description",
    status: "soon",
    icon: "lg",
  },
  {
    id: "tizen",
    nameKey: "pages.clients.tizen.name",
    platformKey: "pages.clients.tizen.platform",
    descriptionKey: "pages.clients.tizen.description",
    status: "soon",
    icon: "samsung",
  },
  {
    id: "roku",
    nameKey: "pages.clients.roku.name",
    platformKey: "pages.clients.roku.platform",
    descriptionKey: "pages.clients.downloadNote",
    status: "experimental",
    downloadFile: "playarr-roku.zip",
    icon: "roku",
  },
];

function ClientPlatformIcon({ icon }: { icon: ClientIcon }) {
  if (icon === "vidaa") {
    return (
      <svg viewBox="0 0 24 24" role="img" aria-label="VIDAA">
        <rect x="2.5" y="4.5" width="19" height="13" rx="2.5" />
        <path d="m8 9 4 5 4-5M9 21h6" />
      </svg>
    );
  }

  // Brand paths are from Simple Icons (CC0-1.0).
  const paths: Record<Exclude<ClientIcon, "vidaa">, string> = {
    android:
      "M18.4395 5.5586c-.675 1.1664-1.352 2.3318-2.0274 3.498-.0366-.0155-.0742-.0286-.1113-.043-1.8249-.6957-3.484-.8-4.42-.787-1.8551.0185-3.3544.4643-4.2597.8203-.084-.1494-1.7526-3.021-2.0215-3.4864a1.1451 1.1451 0 0 0-.1406-.1914c-.3312-.364-.9054-.4859-1.379-.203-.475.282-.7136.9361-.3886 1.5019 1.9466 3.3696-.0966-.2158 1.9473 3.3593.0172.031-.4946.2642-1.3926 1.0177C2.8987 12.176.452 14.772 0 18.9902h24c-.119-1.1108-.3686-2.099-.7461-3.0683-.7438-1.9118-1.8435-3.2928-2.7402-4.1836a12.1048 12.1048 0 0 0-2.1309-1.6875c.6594-1.122 1.312-2.2559 1.9649-3.3848.2077-.3615.1886-.7956-.0079-1.1191a1.1001 1.1001 0 0 0-.8515-.5332c-.5225-.0536-.9392.3128-1.0488.5449zm-.0391 8.461c.3944.5926.324 1.3306-.1563 1.6503-.4799.3197-1.188.0985-1.582-.4941-.3944-.5927-.324-1.3307.1563-1.6504.4727-.315 1.1812-.1086 1.582.4941zM7.207 13.5273c.4803.3197.5506 1.0577.1563 1.6504-.394.5926-1.1038.8138-1.584.4941-.48-.3197-.5503-1.0577-.1563-1.6504.4008-.6021 1.1087-.8106 1.584-.4941z",
    apple:
      "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701",
    lg: "M14.522 14.078h3.27v1.33h-4.847v-6.83h1.577v5.5zm6.74-1.274h1.284v1.195c-.236.09-.698.18-1.137.18-1.42 0-1.893-.721-1.893-2.186 0-1.398.45-2.221 1.869-2.221.791 0 1.24.248 1.612.722l.982-.903c-.6-.855-1.646-1.114-2.629-1.114-2.208 0-3.368 1.205-3.368 3.504 0 2.288 1.047 3.528 3.358 3.528 1.06 0 2.096-.27 2.66-.665V11.53h-2.739v1.274zM5.291 6.709a5.29 5.29 0 1 1 0 10.582 5.291 5.291 0 1 1 0-10.582m3.16 8.457a4.445 4.445 0 0 0 1.31-3.161v-.242l-.22.001H6.596v.494h2.662l-.001.015a3.985 3.985 0 0 1-3.965 3.708 3.95 3.95 0 0 1-2.811-1.165 3.952 3.952 0 0 1-1.164-2.811c0-1.061.414-2.059 1.164-2.81a3.951 3.951 0 0 1 2.81-1.164l.252.003v-.495l-.251-.003a4.475 4.475 0 0 0-4.47 4.469c0 1.194.465 2.316 1.309 3.161a4.444 4.444 0 0 0 3.16 1.31 4.444 4.444 0 0 0 3.162-1.31m-2.91-1.297V9.644H5.04v4.72h1.556v-.495H5.543zm-1.265-3.552a.676.676 0 1 0-.675.674.676.676 0 0 0 .675-.674",
    samsung:
      "M19.8166 10.2808l.0459 2.6934h-.023l-.7793-2.6934h-1.2837v3.3925h.8481l-.0458-2.785h.023l.8366 2.785h1.2264v-3.3925zm-16.149 0l-.6418 3.427h.9284l.4699-3.1175h.0229l.4585 3.1174h.9169l-.6304-3.4269zm5.1805 0l-.424 2.6132h-.023l-.424-2.6132H6.5788l-.0688 3.427h.8596l.023-3.0832h.0114l.573 3.0831h.8711l.5731-3.083h.023l.0228 3.083h.8596l-.0802-3.4269zm-7.2664 2.4527c.0343.0802.0229.1949.0114.2522-.0229.1146-.1031.2292-.3324.2292-.2177 0-.3438-.126-.3438-.3095v-.3323H0v.2636c0 .7679.6074.9971 1.2493.9971.6189 0 1.1346-.2178 1.2149-.7794.0458-.298.0114-.4928 0-.5616-.1605-.722-1.467-.9283-1.5588-1.3295-.0114-.0688-.0114-.1375 0-.1834.023-.1146.1032-.2292.3095-.2292.2063 0 .321.126.321.3095v.2063h.8595v-.2407c0-.745-.6762-.8596-1.1576-.8596-.6074 0-1.1117.2063-1.2034.7564-.023.149-.0344.2866.0114.4585.1376.7106 1.364.9169 1.5358 1.3524m11.152 0c.0343.0803.0228.1834.0114.2522-.023.1146-.1032.2292-.3324.2292-.2178 0-.3438-.126-.3438-.3095v-.3323h-.917v.2636c0 .7564.596.9857 1.2379.9857.6189 0 1.1232-.2063 1.2034-.7794.0459-.298.0115-.4814 0-.5616-.1375-.7106-1.4327-.9284-1.5243-1.318-.0115-.0688-.0115-.1376 0-.1835.0229-.1146.1031-.2292.3094-.2292.1948 0 .321.126.321.3095v.2063h.848v-.2407c0-.745-.6647-.8596-1.146-.8596-.6075 0-1.1004.1948-1.192.7564-.023.149-.023.2866.0114.4585.1376.7106 1.341.9054 1.513 1.3524m2.8882.4585c.2407 0 .3094-.1605.3323-.2522.0115-.0343.0115-.0917.0115-.126v-2.533h.871v2.4642c0 .0688 0 .1948-.0114.2292-.0573.6419-.5616.8482-1.192.8482-.6303 0-1.1346-.2063-1.192-.8482 0-.0344-.0114-.1604-.0114-.2292v-2.4642h.871v2.533c0 .0458 0 .0916.0115.126 0 .0917.0688.2522.3095.2522m7.1518-.0344c.2522 0 .3324-.1605.3553-.2522.0115-.0343.0115-.0917.0115-.126v-.4929h-.3553v-.5043H24v.917c0 .0687 0 .1145-.0115.2292-.0573.6303-.596.8481-1.2034.8481-.6075 0-1.1461-.2178-1.2034-.8481-.0115-.1147-.0115-.1605-.0115-.2293v-1.444c0-.0574.0115-.172.0115-.2293.0802-.6419.596-.8482 1.2034-.8482s1.1347.2063 1.2034.8482c.0115.1031.0115.2292.0115.2292v.1146h-.8596v-.1948s0-.0803-.0115-.1261c-.0114-.0802-.0802-.2521-.3438-.2521-.2521 0-.321.1604-.3438.2521-.0115.0458-.0115.1032-.0115.1605v1.5702c0 .0458 0 .0916.0115.126 0 .0917.0917.2522.3323.2522",
    roku: "M16.34 9.853l-2.254 2.254v-2.26H12.13v5.744h1.957v-2.33l2.353 2.33h2.46l-2.988-2.99 2.477-2.476v3.411c0 1.133.679 2.177 2.393 2.177.815 0 1.56-.462 1.922-.88l.88.759H24v-5.74h-1.951v3.718c-.22.384-.528.627-1.002.627-.482 0-.703-.286-.703-1.198V9.853zm-4.591 2.869A3.004 3.004 0 1 1 8.738 9.73a2.997 2.997 0 0 1 3.011 2.99m-3.011-1.57c-.518 0-.956.704-.956 1.572 0 .867.438 1.57.956 1.57.528 0 .968-.702.968-1.57 0-.869-.438-1.572-.968-1.572zm-2.206 4.447H4.313L2.55 13.153h-.594v2.44H0V8.26h2.8c1.616 0 2.935 1.1 2.935 2.45 0 .826-.505 1.562-1.273 2.013l2.07 2.875m-2.75-4.888A1.226 1.226 0 0 0 2.56 9.478h-.604v2.453h.605a1.225 1.225 0 0 0 1.22-1.221Z",
  };
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label={icon}>
      <path d={paths[icon]} />
    </svg>
  );
}

function PublicClientsLayout({
  backTo,
  children,
  scrollKey,
}: {
  backTo: string;
  children: ReactNode;
  scrollKey: string;
}) {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  useTvNavigation(location.pathname, false, backTo);

  return (
    <div className="profiles-page profile-auth-page clients-shell">
      <TvStageChrome
        backLabel={
          backTo === "/clients"
            ? t("pages.clients.vidaaPage.back")
            : t("pages.profiles.backAriaLabel")
        }
        onBack={() => navigate(backTo)}
      />
      <main
        className="profile-auth-scroll clients-scroll"
        data-tv-scroll-container
        data-tv-scroll-axis="vertical"
        data-navigation-scroll-key={scrollKey}
      >
        <div className="clients-stage-panel">{children}</div>
      </main>
    </div>
  );
}

function ClientsSelector({ activeClientId }: { activeClientId?: string }) {
  const { t } = useLanguage();

  return (
    <section
      className="clients-row-window"
      aria-label={t("pages.clients.gridAriaLabel")}
      data-tv-scroll-container
      data-tv-scroll-axis="horizontal"
      data-navigation-scroll-key="clients:platforms"
    >
      <div className="clients-row">
        {PLAYARR_CLIENTS.map((client, index) => {
          const isActive = client.id === activeClientId;

          return (
            <article
              className={`client-choice is-${client.status} is-${client.icon}${isActive ? " is-active" : ""}`}
              key={client.id}
            >
              <div
                id={`client-${client.id}`}
                className="client-platform"
                role="group"
                aria-label={`${t(client.nameKey)} — ${t(client.platformKey)}`}
                tabIndex={0}
                data-tv-focus-default={
                  isActive || (!activeClientId && index === 0) ? true : undefined
                }
                data-navigation-focus-key={`clients:${client.id}`}
                data-tv-edge-stop-left={index === 0 ? true : undefined}
                data-tv-edge-stop-right={
                  index === PLAYARR_CLIENTS.length - 1 ? true : undefined
                }
                data-tv-edge-target-left={
                  index > 0 ? `#client-${PLAYARR_CLIENTS[index - 1]?.id}` : undefined
                }
                data-tv-edge-target-right={
                  index < PLAYARR_CLIENTS.length - 1
                    ? `#client-${PLAYARR_CLIENTS[index + 1]?.id}`
                    : undefined
                }
                data-tv-edge-target-down={`#client-${client.id}-action`}
              >
                <span
                  className="client-platform-icon"
                  data-client-icon={client.icon}
                  aria-hidden="true"
                >
                  <ClientPlatformIcon icon={client.icon} />
                </span>
                <strong>{t(client.nameKey)}</strong>
                <small>{t(client.platformKey)}</small>
              </div>
              <Link
                id={`client-${client.id}-action`}
                className="profile-action-button client-choice-action"
                to={`/clients/${client.id}`}
                aria-current={isActive ? "page" : undefined}
                data-navigation-focus-key={`clients:${client.id}:details`}
                data-tv-edge-stop-left={index === 0 ? true : undefined}
                data-tv-edge-stop-right={
                  index === PLAYARR_CLIENTS.length - 1 ? true : undefined
                }
                data-tv-edge-target-up={`#client-${client.id}`}
                data-tv-edge-target-left={
                  index > 0
                    ? `#client-${PLAYARR_CLIENTS[index - 1]?.id}-action`
                    : undefined
                }
                data-tv-edge-target-right={
                  index < PLAYARR_CLIENTS.length - 1
                    ? `#client-${PLAYARR_CLIENTS[index + 1]?.id}-action`
                    : undefined
                }
              >
                <strong>
                  {client.action === "vidaa"
                    ? t("pages.clients.vidaaSetup")
                    : client.action === "android"
                      ? t("pages.clients.downloadApk")
                      : client.downloadFile
                        ? t("pages.clients.downloadApp")
                        : t("pages.clients.status.soon")}
                </strong>
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function ClientsPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("pages.clients.documentTitle"));

  return (
    <PublicClientsLayout backTo="/profiles" scrollKey="clients:index">
      <section className="clients-hero" aria-labelledby="clients-title">
        <p className="page-kicker">{t("pages.clients.kicker")}</p>
        <h1 className="auth-title" id="clients-title">
          {t("pages.clients.title")}
        </h1>
      </section>

      <ClientsSelector />

      <p className="clients-preview-note">{t("pages.clients.downloadNote")}</p>
      <p className="clients-footer">{t("pages.clients.footer")}</p>
    </PublicClientsLayout>
  );
}

export function AndroidDownloadDetails() {
  const { t } = useLanguage();

  return (
    <section
      className="android-inline-details"
      id="android-install-details"
      aria-labelledby="android-download-title"
    >
      <p className="page-kicker">{t("pages.clients.androidPage.kicker")}</p>
      <h1 id="android-download-title">{t("pages.clients.androidPage.title")}</h1>
      <p>{t("pages.clients.androidPage.description")}</p>
      <div className="android-download-actions">
        <a
          id="android-download"
          className="profile-action-button"
          href="/downloads/android/releases/0.2.7/playarr-android.apk"
          target="_blank"
          rel="noopener noreferrer"
          data-navigation-focus-key="clients:android:download"
          data-tv-focus-default
        >
          <strong>{t("pages.clients.androidPage.download")}</strong>
        </a>
      </div>
    </section>
  );
}

function VidaaInstallDetails() {
  const { t } = useLanguage();

  return (
    <>
      <section className="vidaa-hero" aria-labelledby="vidaa-title">
        <div>
          <p className="page-kicker">{t("pages.clients.vidaaPage.kicker")}</p>
          <h1 className="auth-title" id="vidaa-title">
            {t("pages.clients.vidaaPage.title")}
          </h1>
          <p className="muted auth-description vidaa-lead">
            {t("pages.clients.vidaaPage.description")}
          </p>
        </div>
        <aside className="vidaa-experimental">
          <span>{t("pages.clients.status.experimental")}</span>
          <p>{t("pages.clients.vidaaPage.experimentalNote")}</p>
        </aside>
      </section>

      <section className="vidaa-activation" aria-labelledby="vidaa-store-title">
        <div className="vidaa-section-heading">
          <span>01</span>
          <div>
            <p>{t("pages.clients.vidaaPage.storeKicker")}</p>
            <h2 id="vidaa-store-title">
              {t("pages.clients.vidaaPage.storeTitle")}
            </h2>
          </div>
        </div>
        <p className="vidaa-section-copy">
          {t("pages.clients.vidaaPage.storeDescription")}
        </p>
        <div className="vidaa-store-row">
          <a
            id="vidaa-store-open"
            className="profile-action-button"
            href="/vidaa-store/"
            data-navigation-focus-key="clients:vidaa:store"
            data-tv-focus-default
          >
            <strong>{t("pages.clients.vidaaPage.openStore")}</strong>
          </a>
          <p>{t("pages.clients.vidaaPage.dnsChoice")}</p>
        </div>
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
        <p className="page-kicker">{t("pages.clients.vidaaPage.aftercareKicker")}</p>
        <h2 id="vidaa-safety-title">{t("pages.clients.vidaaPage.aftercareTitle")}</h2>
        <p>{t("pages.clients.vidaaPage.aftercareDescription")}</p>
      </section>
    </>
  );
}

function ClientOverviewDetails({ client }: { client: PlayarrClient }) {
  const { t } = useLanguage();

  return (
    <section
      className={`android-inline-details client-details-summary is-${client.icon}`}
      aria-labelledby="client-details-title"
    >
      <span
        className="client-platform-icon client-details-icon"
        data-client-icon={client.icon}
        aria-hidden="true"
      >
        <ClientPlatformIcon icon={client.icon} />
      </span>
      <p className="page-kicker">{t(client.platformKey)}</p>
      <h1 id="client-details-title">{t(client.nameKey)}</h1>
      <p>
        {client.descriptionKey
          ? t(client.descriptionKey)
          : t("pages.clients.notYetPublished")}
      </p>
      <span className="client-details-status">
        {t(`pages.clients.status.${client.status}`)}
      </span>
      {client.downloadFile ? (
        <div className="android-download-actions">
          <a
            className="profile-action-button"
            href={`${CLIENT_PREVIEW_RELEASE_BASE}/${client.downloadFile}`}
            download
            data-navigation-focus-key={`clients:${client.id}:download`}
            data-tv-focus-default
          >
            <strong>{t("pages.clients.downloadApp")}</strong>
          </a>
        </div>
      ) : null}
    </section>
  );
}

export function ClientDetailsPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { t } = useLanguage();
  const client = PLAYARR_CLIENTS.find(({ id }) => id === clientId);
  useDocumentTitle(
    client?.id === "vidaa"
      ? t("pages.clients.vidaaPage.documentTitle")
      : client
        ? t(client.nameKey)
        : t("pages.clients.documentTitle")
  );

  if (!client) return <Navigate to="/clients" replace />;

  return (
    <PublicClientsLayout backTo="/clients" scrollKey={`clients:${client.id}`}>
      <ClientsSelector activeClientId={client.id} />
      <div className="client-details-content">
        {client.id === "vidaa" ? (
          <VidaaInstallDetails />
        ) : client.id === "android" ? (
          <AndroidDownloadDetails />
        ) : (
          <ClientOverviewDetails client={client} />
        )}
      </div>
    </PublicClientsLayout>
  );
}
