import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  describeApiError,
  type DiscoverResponse,
  type DiscoveryScope,
} from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import {
  discoveryUnsupportedByServer,
  extraTitles,
  libraryDetailRoute,
  snapshotFromTitle,
  sourceChipKey,
  uniqueSourceKinds,
} from "../lib/discovery";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { RequestButton } from "./RequestButton";
import { WatchlistToggle } from "./WatchlistToggle";

type State =
  | { status: "loading" }
  | { status: "ready"; response: DiscoverResponse }
  | { status: "error"; message: string };

/**
 * Titles from beyond the local library (peers, request catalogues, games),
 * with their sources and a watchlist toggle. Providers that cannot answer are
 * named with their reason instead of silently producing an empty list.
 */
export function DiscoveryExtras({
  query,
  gamesOnly,
}: {
  query: string;
  gamesOnly: boolean;
}) {
  const { t } = useLanguage();
  const client = useApiClient();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const scope: DiscoveryScope = gamesOnly ? "games" : "media";
    void client
      .discover(query, { scope, limit: 25 })
      .then((response) => {
        if (!cancelled) setState({ status: "ready", response });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: discoveryUnsupportedByServer(error)
              ? t("discovery.serverUnsupported")
              : describeApiError(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, query, gamesOnly, t]);

  if (state.status === "loading") {
    return (
      <p className="tv-discovery-note" role="status">
        {t("discovery.extras.loading")}
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className="tv-discovery-note" role="alert">
        {state.message}
      </p>
    );
  }

  const titles = extraTitles(state.response.titles);
  const relevantProvider = gamesOnly ? "game" : null;
  const notices = state.response.providers.filter(
    (provider) =>
      provider.state !== "ok" && provider.reason && provider.provider === relevantProvider
  );

  return (
    <section
      className="tv-discovery-extras"
      aria-label={gamesOnly ? t("discovery.extras.gamesTitle") : t("discovery.extras.title")}
    >
      <h2>{gamesOnly ? t("discovery.extras.gamesTitle") : t("discovery.extras.title")}</h2>
      {notices.map((provider) => (
        <p key={provider.provider} className="tv-discovery-note" role="status">
          {provider.reason}
        </p>
      ))}
      {titles.length === 0 && notices.length === 0 ? (
        <p className="tv-discovery-note">{t("discovery.extras.none")}</p>
      ) : null}
      <ul className="tv-discovery-list">
        {titles.map((title) => {
          const route = libraryDetailRoute(title);
          return (
            <li key={title.title_key} className="tv-discovery-item">
              <div className="tv-discovery-copy">
                {route ? (
                  <Link to={route}>
                    <strong>{title.title}</strong>
                  </Link>
                ) : (
                  <strong>{title.title}</strong>
                )}
                <small>
                  {title.year ? `${title.year} · ` : ""}
                  {uniqueSourceKinds(title.sources)
                    .map((kind) => t(sourceChipKey(kind)))
                    .join(" · ")}
                </small>
                {title.editions.length > 0 ? (
                  <small>{title.editions.join(" · ")}</small>
                ) : null}
              </div>
              {title.sources.some(
                (source) =>
                  source.source === "request" && source.availability === "requestable"
              ) ? (
                <RequestButton
                  snapshot={snapshotFromTitle(title)}
                  focusKey={`discover:${title.title_key}:request`}
                />
              ) : null}
              <WatchlistToggle
                snapshot={snapshotFromTitle(title)}
                initialListed={title.in_watchlist}
                focusKey={`discover:${title.title_key}:watch`}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
