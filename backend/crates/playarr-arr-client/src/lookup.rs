//! Title lookup and add ("request") shared by Radarr and Sonarr: both expose
//! `GET {resource}/lookup?term=` for catalogue search and `POST {resource}` to
//! start tracking (and optionally searching for) a title, and both accept the
//! lookup object posted back with the destination fields filled in.

use serde_json::{json, Value};

/// One lookup hit, with the raw object kept so it can be posted back to add.
#[derive(Debug, Clone)]
pub struct LookupTitle {
    /// The app's own id; present and non-zero when the title is already tracked.
    pub arr_id: Option<i64>,
    pub title: String,
    pub year: Option<i32>,
    pub tmdb_id: Option<i64>,
    pub tvdb_id: Option<i64>,
    pub imdb_id: Option<String>,
    pub overview: Option<String>,
    pub poster_url: Option<String>,
    pub raw: Value,
}

impl LookupTitle {
    pub fn from_value(raw: Value) -> Option<Self> {
        let title = raw.get("title")?.as_str()?.to_string();
        let id = |key: &str| raw.get(key).and_then(Value::as_i64).filter(|v| *v > 0);
        let poster_url = raw
            .get("images")
            .and_then(Value::as_array)
            .and_then(|images| {
                images
                    .iter()
                    .find(|i| i.get("coverType").and_then(Value::as_str) == Some("poster"))
            })
            .and_then(|i| i.get("remoteUrl").or_else(|| i.get("url")))
            .and_then(Value::as_str)
            .map(str::to_string);
        Some(Self {
            arr_id: id("id"),
            year: raw
                .get("year")
                .and_then(Value::as_i64)
                .filter(|y| *y > 0)
                .map(|y| y as i32),
            tmdb_id: id("tmdbId"),
            tvdb_id: id("tvdbId"),
            imdb_id: raw
                .get("imdbId")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            overview: raw
                .get("overview")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            poster_url,
            title,
            raw,
        })
    }
}

/// Builds `path?term=...` with the term percent-encoded.
pub(crate) fn lookup_path(path: &str, term: &str) -> String {
    let mut url = reqwest::Url::parse("http://localhost/").expect("static url");
    url.set_path(path);
    url.query_pairs_mut().append_pair("term", term);
    format!("{}?{}", url.path(), url.query().unwrap_or_default())
}

/// The add payload: the lookup object with destination fields set.
pub(crate) fn add_body(
    mut raw: Value,
    root_folder_path: &str,
    quality_profile_id: i64,
    search_key: &str,
) -> Value {
    if let Some(obj) = raw.as_object_mut() {
        obj.insert("rootFolderPath".into(), json!(root_folder_path));
        obj.insert("qualityProfileId".into(), json!(quality_profile_id));
        obj.insert("monitored".into(), json!(true));
        obj.insert("addOptions".into(), json!({ search_key: true }));
    }
    raw
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lookup_hit_with_poster_and_ids() {
        let hit = LookupTitle::from_value(json!({
            "title": "Orbit", "year": 1995, "tmdbId": 949, "imdbId": "tt0113277",
            "id": 0, "overview": "", "images": [
                {"coverType": "fanart", "remoteUrl": "https://img/f.jpg"},
                {"coverType": "poster", "remoteUrl": "https://img/p.jpg"}
            ]
        }))
        .unwrap();
        assert_eq!(hit.tmdb_id, Some(949));
        assert_eq!(hit.arr_id, None);
        assert_eq!(hit.overview, None);
        assert_eq!(hit.poster_url.as_deref(), Some("https://img/p.jpg"));
    }

    #[test]
    fn lookup_path_percent_encodes_the_term() {
        assert_eq!(
            lookup_path("/api/v3/movie/lookup", "sampleseven & co"),
            "/api/v3/movie/lookup?term=sampleseven+%26+co"
        );
    }

    #[test]
    fn add_body_sets_destination_and_search() {
        let body = add_body(json!({"title": "Orbit"}), "/movies", 4, "searchForMovie");
        assert_eq!(body["rootFolderPath"], "/movies");
        assert_eq!(body["qualityProfileId"], 4);
        assert_eq!(body["addOptions"]["searchForMovie"], true);
    }
}
