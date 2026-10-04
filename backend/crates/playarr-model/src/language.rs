//! Language-code normalisation for the audio/subtitle language index.
//!
//! Every source of language information (Sonarr/Radarr `mediaInfo` strings,
//! ffprobe stream tags, sidecar subtitle file names) is reduced to one
//! canonical code: the ISO 639-1 two-letter code where one exists (`en`,
//! `ja`), otherwise the ISO 639-2/T three-letter code. `und`, `zxx`, `mul`
//! and empty values are not languages and normalise to `None`.

/// (ISO 639-1, ISO 639-2/T, ISO 639-2/B when different, English name,
/// extra lowercase aliases).
type Entry = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static [&'static str],
);

const LANGUAGES: &[Entry] = &[
    ("ar", "ara", "", "Arabic", &[]),
    ("bg", "bul", "", "Bulgarian", &[]),
    ("bn", "ben", "", "Bengali", &["bangla"]),
    ("ca", "cat", "", "Catalan", &["valencian"]),
    ("cs", "ces", "cze", "Czech", &[]),
    ("cy", "cym", "wel", "Welsh", &[]),
    ("da", "dan", "", "Danish", &[]),
    ("de", "deu", "ger", "German", &[]),
    ("el", "ell", "gre", "Greek", &[]),
    ("en", "eng", "", "English", &[]),
    ("es", "spa", "", "Spanish", &["castilian", "latino"]),
    ("et", "est", "", "Estonian", &[]),
    ("eu", "eus", "baq", "Basque", &[]),
    ("fa", "fas", "per", "Persian", &["farsi"]),
    ("fi", "fin", "", "Finnish", &[]),
    ("fil", "fil", "", "Filipino", &["tagalog", "tl", "tgl"]),
    ("fr", "fra", "fre", "French", &[]),
    ("ga", "gle", "", "Irish", &[]),
    ("gl", "glg", "", "Galician", &[]),
    ("gu", "guj", "", "Gujarati", &[]),
    ("he", "heb", "", "Hebrew", &["iw"]),
    ("hi", "hin", "", "Hindi", &[]),
    ("hr", "hrv", "", "Croatian", &[]),
    ("hu", "hun", "", "Hungarian", &[]),
    ("hy", "hye", "arm", "Armenian", &[]),
    ("id", "ind", "", "Indonesian", &["in"]),
    ("is", "isl", "ice", "Icelandic", &[]),
    ("it", "ita", "", "Italian", &[]),
    ("ja", "jpn", "", "Japanese", &[]),
    ("ka", "kat", "geo", "Georgian", &[]),
    ("kk", "kaz", "", "Kazakh", &[]),
    ("kn", "kan", "", "Kannada", &[]),
    ("ko", "kor", "", "Korean", &[]),
    ("la", "lat", "", "Latin", &[]),
    ("lt", "lit", "", "Lithuanian", &[]),
    ("lv", "lav", "", "Latvian", &[]),
    ("mk", "mkd", "mac", "Macedonian", &[]),
    ("ml", "mal", "", "Malayalam", &[]),
    ("mr", "mar", "", "Marathi", &[]),
    ("ms", "msa", "may", "Malay", &[]),
    ("mt", "mlt", "", "Maltese", &[]),
    ("nb", "nob", "", "Norwegian Bokmal", &["norwegian bokmål"]),
    ("nl", "nld", "dut", "Dutch", &["flemish"]),
    ("no", "nor", "", "Norwegian", &[]),
    ("pa", "pan", "", "Punjabi", &["panjabi"]),
    ("pl", "pol", "", "Polish", &[]),
    ("pt", "por", "", "Portuguese", &[]),
    ("ro", "ron", "rum", "Romanian", &["moldavian", "moldovan"]),
    ("ru", "rus", "", "Russian", &[]),
    ("sk", "slk", "slo", "Slovak", &[]),
    ("sl", "slv", "", "Slovenian", &["slovene"]),
    ("sq", "sqi", "alb", "Albanian", &[]),
    ("sr", "srp", "", "Serbian", &[]),
    ("sv", "swe", "", "Swedish", &[]),
    ("sw", "swa", "", "Swahili", &[]),
    ("ta", "tam", "", "Tamil", &[]),
    ("te", "tel", "", "Telugu", &[]),
    ("th", "tha", "", "Thai", &[]),
    ("tr", "tur", "", "Turkish", &[]),
    ("uk", "ukr", "", "Ukrainian", &[]),
    ("ur", "urd", "", "Urdu", &[]),
    ("vi", "vie", "", "Vietnamese", &[]),
    (
        "zh",
        "zho",
        "chi",
        "Chinese",
        &[
            "mandarin",
            "cantonese",
            "chinese (mandarin)",
            "chinese (cantonese)",
        ],
    ),
];

/// Values that mean "no usable language".
fn is_undetermined(value: &str) -> bool {
    matches!(
        value,
        "" | "und"
            | "unk"
            | "unknown"
            | "undetermined"
            | "zxx"
            | "mul"
            | "mis"
            | "original"
            | "default"
            | "none"
    )
}

fn canonical(entry: &Entry) -> String {
    entry.0.to_string()
}

/// Normalises one language token (ISO 639-1/2 code, regional tag such as
/// `en-US` or `pt_BR`, or an English name such as `Japanese`) to the
/// canonical code. Unknown values return `None` rather than a guess, except
/// that an unrecognised well-formed three-letter code passes through
/// lower-cased so rarer ISO 639-3 languages remain filterable.
pub fn normalize_language(raw: &str) -> Option<String> {
    normalize_inner(raw, true)
}

/// Like [`normalize_language`] but only accepts languages in the built-in
/// table. For untrusted tokens such as sidecar file name parts, where a
/// stray three-letter word (`web`, `cut`) must not become a language.
pub fn normalize_known_language(raw: &str) -> Option<String> {
    normalize_inner(raw, false)
}

fn normalize_inner(raw: &str, allow_unlisted_iso3: bool) -> Option<String> {
    let lowered = raw.trim().trim_matches('"').to_lowercase();
    if is_undetermined(&lowered) {
        return None;
    }
    // Names first (so `Dutch` is not read as a code), then codes.
    for entry in LANGUAGES {
        if entry.3.to_lowercase() == lowered || entry.4.contains(&lowered.as_str()) {
            return Some(canonical(entry));
        }
    }
    let base = lowered.split(['-', '_']).next().unwrap_or("");
    if is_undetermined(base) {
        return None;
    }
    for entry in LANGUAGES {
        if entry.0 == base || entry.1 == base || (!entry.2.is_empty() && entry.2 == base) {
            return Some(canonical(entry));
        }
    }
    if allow_unlisted_iso3 && base.len() == 3 && base.chars().all(|c| c.is_ascii_lowercase()) {
        return Some(base.to_string());
    }
    None
}

/// Splits a Sonarr/Radarr `mediaInfo.audioLanguages` or `subtitles` value
/// (`"English/Japanese"`, `"eng / jpn"`, `"English, French"`) into a sorted,
/// de-duplicated list of canonical codes. Undetermined entries are dropped.
pub fn parse_arr_languages(raw: Option<&str>) -> Vec<String> {
    let Some(raw) = raw else {
        return Vec::new();
    };
    let mut out: Vec<String> = raw
        .split(['/', ',', ';', '|', '+'])
        .filter_map(normalize_language)
        .collect();
    out.sort();
    out.dedup();
    out
}

/// English display name for a canonical code, when known. Clients localise
/// names themselves (platform locale APIs); this is the fallback.
pub fn language_english_name(code: &str) -> Option<&'static str> {
    LANGUAGES
        .iter()
        .find(|entry| entry.0 == code || entry.1 == code)
        .map(|entry| entry.3)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalises_codes_names_and_regional_tags() {
        assert_eq!(normalize_language("eng").as_deref(), Some("en"));
        assert_eq!(normalize_language("EN").as_deref(), Some("en"));
        assert_eq!(normalize_language("en-US").as_deref(), Some("en"));
        assert_eq!(normalize_language("pt_BR").as_deref(), Some("pt"));
        assert_eq!(normalize_language("Japanese").as_deref(), Some("ja"));
        assert_eq!(normalize_language("jpn").as_deref(), Some("ja"));
        assert_eq!(normalize_language("fre").as_deref(), Some("fr"));
        assert_eq!(normalize_language("ger").as_deref(), Some("de"));
        assert_eq!(normalize_language("chi").as_deref(), Some("zh"));
        assert_eq!(normalize_language("Dutch").as_deref(), Some("nl"));
        assert_eq!(normalize_language("fil").as_deref(), Some("fil"));
        assert_eq!(normalize_language("haw").as_deref(), Some("haw"));
    }

    #[test]
    fn strict_normalisation_rejects_unlisted_three_letter_words() {
        assert_eq!(normalize_known_language("web"), None);
        assert_eq!(normalize_known_language("eng").as_deref(), Some("en"));
    }

    #[test]
    fn undetermined_values_are_not_languages() {
        for raw in ["", " ", "und", "Unknown", "zxx", "mul", "Original", "xx1"] {
            assert_eq!(normalize_language(raw), None, "{raw}");
        }
    }

    #[test]
    fn splits_arr_strings() {
        assert_eq!(
            parse_arr_languages(Some("English/Japanese")),
            vec!["en", "ja"]
        );
        assert_eq!(
            parse_arr_languages(Some("jpn / eng, Japanese")),
            vec!["en", "ja"]
        );
        assert_eq!(parse_arr_languages(Some("Unknown")), Vec::<String>::new());
        assert_eq!(parse_arr_languages(None), Vec::<String>::new());
    }

    #[test]
    fn english_names_resolve_from_either_code_form() {
        assert_eq!(language_english_name("ja"), Some("Japanese"));
        assert_eq!(language_english_name("jpn"), Some("Japanese"));
        assert_eq!(language_english_name("haw"), None);
    }
}
