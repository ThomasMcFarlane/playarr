/** `GET /api/v1/calendar` wire types (the fields the TV agenda uses); names mirror the server contract. */

export type CalendarMediaKind = "episode" | "movie" | "album" | "book";
export type CalendarReleaseType = "air" | "cinema" | "digital" | "physical" | "release";

export interface CalendarAction {
  action: string;
  enabled: boolean;
  reason?: string | null;
  work_id?: string | null;
  media_file_id?: string | null;
  position_ms?: number | null;
  /** `watchlist`: already listed. `request`: already requested. */
  active?: boolean;
}

/** The title identity the server hands out; posted back unchanged to the watchlist endpoints. */
export type TitleSnapshot = Record<string, Object | null>;

export interface CalendarEntry {
  id: string;
  media_kind: CalendarMediaKind;
  release_type: CalendarReleaseType;
  title: string;
  subtitle?: string | null;
  season_number?: number | null;
  episode_number?: number | null;
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  release_at?: string | null;
  monitored: boolean;
  has_file: boolean;
  poster_url?: string | null;
  work_id?: string | null;
  overview?: string | null;
  actions?: CalendarAction[];
  snapshot?: TitleSnapshot | null;
}

export interface CalendarResponse {
  start: string;
  end: string;
  entries: CalendarEntry[];
}
