/**
 * Human labels for the player's audio and subtitle menus, shared in shape with the Android client
 * (`PlayarrTrackLabels.kt`): the localised language name, a distinguishing title (commentary, SDH...),
 * the codec label and the channel layout, joined with " · " - for example "German · AAC · Stereo" or
 * "English · Commentary · AC3 · 5.1". Keep the two implementations in step.
 */

const SEPARATOR = " · ";

const BIBLIOGRAPHIC_LANGUAGE_CODES: Record<string, string> = {
  fre: "fra", ger: "deu", dut: "nld", chi: "zho", cze: "ces", gre: "ell", ice: "isl", mac: "mkd",
  mao: "mri", may: "msa", per: "fas", rum: "ron", slo: "slk", tib: "bod", wel: "cym", arm: "hye",
  baq: "eus", bur: "mya", geo: "kat", alb: "sqi",
};

export interface TrackLabelWords {
  mono: string;
  stereo: string;
  forced: string;
}

export interface AudioTrackLabelInput {
  label: string;
  language?: string | null;
  /** Codec label such as `AAC` or `DTS-HD MA` (see `audioCodecName`). */
  codec?: string | null;
  channelsCount?: number | null;
}

export interface SubtitleTrackLabelInput {
  label: string;
  language?: string | null;
  forced?: boolean;
}

/** The language's name in `locale` ("deu" is "German" in English); the bare code when it is unknown. */
export function trackLanguageName(code: string | null | undefined, locale: string): string | undefined {
  const trimmed = code?.trim().toLowerCase();
  if (!trimmed || trimmed === "und") return undefined;
  const canonical = BIBLIOGRAPHIC_LANGUAGE_CODES[trimmed] ?? trimmed;
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(canonical);
    if (name && name.toLowerCase() !== canonical) return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  } catch {
    // Unsupported locale or malformed code: fall back to the code itself.
  }
  return trimmed;
}

/** The track's own title when it adds something beyond the language ("Commentary", "SDH"). */
export function trackTitle(
  label: string,
  languageCode: string | null | undefined,
  languageName: string | undefined
): string | undefined {
  const title = label.trim();
  if (!title) return undefined;
  const normalised = title.toLowerCase();
  if (normalised === languageCode?.trim().toLowerCase()) return undefined;
  if (languageName && normalised.includes(languageName.toLowerCase())) return undefined;
  // The server's own fallbacks ("Audio 2", "Subtitles 3") say nothing.
  if (/^(audio|subtitles?)\s*\d+$/.test(normalised)) return undefined;
  return title;
}

/** A readable codec name from the server's raw ffprobe codec (`ac3` is `AC3`, `truehd` is `TrueHD`). */
export function audioCodecName(codec: string | null | undefined): string | undefined {
  const value = codec?.trim().toLowerCase();
  if (!value) return undefined;
  if (value.startsWith("pcm")) return "PCM";
  switch (value) {
    case "ac3": return "AC3";
    case "eac3": return "E-AC3";
    case "truehd": return "TrueHD";
    case "opus": return "Opus";
    case "vorbis": return "Vorbis";
    default: return value.toUpperCase();
  }
}

export function channelLayoutLabel(
  channels: number | null | undefined,
  words: Pick<TrackLabelWords, "mono" | "stereo">
): string | undefined {
  switch (channels) {
    case null:
    case undefined:
    case 0: return undefined;
    case 1: return words.mono;
    case 2: return words.stereo;
    case 3: return "2.1";
    case 4: return "4.0";
    case 5: return "5.0";
    case 6: return "5.1";
    case 7: return "6.1";
    case 8: return "7.1";
    default: return `${channels} ch`;
  }
}

export function audioTrackLabel(
  track: AudioTrackLabelInput,
  locale: string,
  words: Pick<TrackLabelWords, "mono" | "stereo">
): string {
  const language = trackLanguageName(track.language, locale);
  const parts = [
    language,
    trackTitle(track.label, track.language, language),
    track.codec?.trim() || undefined,
    channelLayoutLabel(track.channelsCount, words),
  ].filter((part): part is string => Boolean(part));
  return parts.join(SEPARATOR) || track.label;
}

export function subtitleTrackLabel(
  track: SubtitleTrackLabelInput,
  locale: string,
  words: Pick<TrackLabelWords, "forced">
): string {
  const language = trackLanguageName(track.language, locale);
  const parts = [
    language,
    trackTitle(track.label, track.language, language),
    track.forced ? words.forced : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.join(SEPARATOR) || track.label;
}
