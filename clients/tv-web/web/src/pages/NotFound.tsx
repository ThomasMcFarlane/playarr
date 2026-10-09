import { useLanguage } from "../lib/i18n/LanguageProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";

/** Authenticated catch-all for addresses that do not map to a Playarr view. */
export function NotFoundPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("pages.notFound.title"));

  return (
    <section className="not-found-page" aria-labelledby="not-found-heading" tabIndex={0}>
      <div className="not-found-art" aria-hidden="true">
        <svg viewBox="0 0 640 420" focusable="false">
          <path
            className="not-found-orbit"
            d="M88 236C117 91 281 24 430 81c116 45 168 177 94 267"
          />
          <circle className="not-found-star" cx="104" cy="190" r="5" />
          <circle className="not-found-star" cx="487" cy="95" r="4" />
          <circle className="not-found-star" cx="533" cy="308" r="6" />
          <g className="not-found-screen">
            <rect x="171" y="104" width="292" height="190" rx="28" />
            <path d="M198 140h238" />
            <circle cx="207" cy="122" r="4" />
            <circle cx="223" cy="122" r="4" />
            <path d="m298 182 51 31-51 31z" />
            <path d="m370 104-20 35 25 25-29 34 24 29-18 31 22 36" />
          </g>
          <g className="not-found-search">
            <circle cx="449" cy="286" r="61" />
            <path d="m493 331 50 50" />
            <path d="M432 270c2-15 31-18 34 0 2 13-17 15-17 29" />
            <circle cx="449" cy="313" r="3" />
          </g>
        </svg>
      </div>

      <div className="not-found-copy">
        <p className="page-kicker">{t("pages.notFound.kicker")}</p>
        <h1 id="not-found-heading">{t("pages.notFound.heading")}</h1>
        <p>{t("pages.notFound.description")}</p>
      </div>
    </section>
  );
}
