//! Seerr client (Overseerr/Jellyseerr-compatible `/api/v1`). Auth is the
//! `X-Api-Key` header (an administrator key, so requests can carry `userId`
//! to act on behalf of a user). The request list carries ids only, so titles
//! come from `title_info` when a new local row is created.
//!
//! Request status: 1 pending, 2 approved, 3 declined, 4 failed, 5 completed;
//! media status 5 (available) also counts as available.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use playarr_model::discovery::DiscoveryKind;
use playarr_model::requests::{ExternalUser, RequestStatus};
use playarr_model::Sensitive;
use serde_json::{json, Value};

use crate::http::build_http_client;
use crate::request_manager::{
    tmdb_poster, year_of, NewRemoteRequest, RemoteRequest, RequestManagerClient, TitleInfo,
};
use crate::ArrClientError;

const APP: &str = "seerr";
const PAGE: usize = 100;
const MAX_PAGES: usize = 100;

pub struct SeerrClient {
    base_url: String,
    api_key: Sensitive<String>,
    http: reqwest::Client,
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|x| !x.is_empty())
        .map(str::to_string)
}

fn user_of(v: &Value) -> Option<ExternalUser> {
    let id = v.get("id").and_then(Value::as_i64)?.to_string();
    Some(ExternalUser {
        id,
        username: s(v, "username")
            .or_else(|| s(v, "jellyfinUsername"))
            .or_else(|| s(v, "plexUsername")),
        email: s(v, "email"),
        display_name: s(v, "displayName"),
    })
}

pub(crate) fn status_of(request: i64, media: i64) -> RequestStatus {
    match request {
        3 => RequestStatus::Declined,
        4 => RequestStatus::Failed,
        5 => RequestStatus::Available,
        _ if media == 5 => RequestStatus::Available,
        2 => RequestStatus::Approved,
        _ => RequestStatus::Pending,
    }
}

pub(crate) fn parse_request(v: &Value) -> Option<RemoteRequest> {
    let id = v.get("id")?.as_i64()?.to_string();
    let kind = match v.get("type").and_then(Value::as_str)? {
        "tv" => DiscoveryKind::Series,
        _ => DiscoveryKind::Movie,
    };
    let media = v.get("media").cloned().unwrap_or(Value::Null);
    let mut seasons: Vec<i32> = v
        .get("seasons")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|s| s.get("seasonNumber").and_then(Value::as_i64))
                .map(|n| n as i32)
                .collect()
        })
        .unwrap_or_default();
    seasons.sort_unstable();
    Some(RemoteRequest {
        id,
        kind,
        title: String::new(),
        year: None,
        tmdb_id: media
            .get("tmdbId")
            .and_then(Value::as_i64)
            .filter(|i| *i > 0),
        tvdb_id: media
            .get("tvdbId")
            .and_then(Value::as_i64)
            .filter(|i| *i > 0),
        imdb_id: s(&media, "imdbId"),
        poster_url: None,
        seasons,
        requester: v.get("requestedBy").and_then(user_of),
        status: status_of(
            v.get("status").and_then(Value::as_i64).unwrap_or(1),
            media.get("status").and_then(Value::as_i64).unwrap_or(1),
        ),
        created_at: s(v, "createdAt")
            .and_then(|d| DateTime::parse_from_rfc3339(&d).ok())
            .map(|d| d.with_timezone(&Utc)),
        note: None,
    })
}

impl SeerrClient {
    pub fn new(base_url: &str, api_key: impl Into<String>) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: Sensitive::new(api_key.into()),
            http: build_http_client(),
        }
    }

    async fn send(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value, ArrClientError> {
        let mut req = self
            .http
            .request(method, format!("{}/api/v1{}", self.base_url, path))
            .header("X-Api-Key", self.api_key.expose_secret());
        if let Some(body) = body {
            req = req.json(body);
        }
        let response = req.send().await?;
        let status = response.status();
        let text = response.text().await?;
        if !status.is_success() {
            return Err(ArrClientError::UnexpectedStatus {
                app: APP,
                status,
                body: text,
            });
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text).map_err(|source| ArrClientError::Decode { app: APP, source })
    }
}

#[async_trait]
impl RequestManagerClient for SeerrClient {
    async fn test(&self) -> Result<String, ArrClientError> {
        let v = self.send(reqwest::Method::GET, "/status", None).await?;
        // /status is public; /settings/main needs the key, so use a keyed call
        // to prove the key too.
        self.send(reqwest::Method::GET, "/request/count", None)
            .await?;
        Ok(s(&v, "version").unwrap_or_else(|| "Seerr".into()))
    }

    async fn users(&self) -> Result<Vec<ExternalUser>, ArrClientError> {
        let mut out = Vec::new();
        for page in 0..MAX_PAGES {
            let v = self
                .send(
                    reqwest::Method::GET,
                    &format!("/user?take={PAGE}&skip={}", page * PAGE),
                    None,
                )
                .await?;
            let results = v
                .get("results")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let n = results.len();
            out.extend(results.iter().filter_map(user_of));
            if n < PAGE {
                break;
            }
        }
        Ok(out)
    }

    async fn list_requests(&self) -> Result<Vec<RemoteRequest>, ArrClientError> {
        let mut out = Vec::new();
        for page in 0..MAX_PAGES {
            let v = self
                .send(
                    reqwest::Method::GET,
                    &format!(
                        "/request?take={PAGE}&skip={}&filter=all&sort=added",
                        page * PAGE
                    ),
                    None,
                )
                .await?;
            let results = v
                .get("results")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let n = results.len();
            out.extend(results.iter().filter_map(parse_request));
            if n < PAGE {
                break;
            }
        }
        Ok(out)
    }

    async fn title_info(
        &self,
        kind: DiscoveryKind,
        tmdb_id: i64,
    ) -> Result<TitleInfo, ArrClientError> {
        let (path, title_key, date_key) = match kind {
            DiscoveryKind::Series => (format!("/tv/{tmdb_id}"), "name", "firstAirDate"),
            _ => (format!("/movie/{tmdb_id}"), "title", "releaseDate"),
        };
        let v = self.send(reqwest::Method::GET, &path, None).await?;
        Ok(TitleInfo {
            title: s(&v, title_key).unwrap_or_default(),
            year: s(&v, date_key).as_deref().and_then(year_of),
            poster_url: s(&v, "posterPath").as_deref().and_then(tmdb_poster),
        })
    }

    async fn create_request(
        &self,
        new: &NewRemoteRequest,
    ) -> Result<RemoteRequest, ArrClientError> {
        let tmdb = new
            .tmdb_id
            .ok_or_else(|| ArrClientError::UnexpectedStatus {
                app: APP,
                status: reqwest::StatusCode::UNPROCESSABLE_ENTITY,
                body: "Seerr needs a TMDB id for this title".into(),
            })?;
        let mut body = match new.kind {
            DiscoveryKind::Series => json!({
                "mediaType": "tv",
                "mediaId": tmdb,
                "tvdbId": new.tvdb_id,
                "seasons": if new.seasons.is_empty() { json!("all") } else { json!(new.seasons) },
            }),
            _ => json!({ "mediaType": "movie", "mediaId": tmdb }),
        };
        if let Some(user) = new
            .on_behalf_of
            .as_deref()
            .and_then(|u| u.parse::<i64>().ok())
        {
            body["userId"] = json!(user);
        }
        let v = self
            .send(reqwest::Method::POST, "/request", Some(&body))
            .await?;
        let mut r = parse_request(&v).ok_or_else(|| ArrClientError::UnexpectedStatus {
            app: APP,
            status: reqwest::StatusCode::BAD_GATEWAY,
            body: "unexpected reply to a request".into(),
        })?;
        r.title = new.title.clone();
        r.tmdb_id = r.tmdb_id.or(Some(tmdb));
        Ok(r)
    }

    async fn approve(&self, _kind: DiscoveryKind, id: &str) -> Result<(), ArrClientError> {
        self.send(
            reqwest::Method::POST,
            &format!("/request/{id}/approve"),
            None,
        )
        .await?;
        Ok(())
    }

    async fn decline(
        &self,
        _kind: DiscoveryKind,
        id: &str,
        _reason: Option<&str>,
    ) -> Result<(), ArrClientError> {
        self.send(
            reqwest::Method::POST,
            &format!("/request/{id}/decline"),
            None,
        )
        .await?;
        Ok(())
    }

    async fn remove(&self, _kind: DiscoveryKind, id: &str) -> Result<(), ArrClientError> {
        self.send(reqwest::Method::DELETE, &format!("/request/{id}"), None)
            .await?;
        Ok(())
    }

    /// Seerr derives availability from Radarr/Sonarr itself.
    async fn mark_available(&self, _kind: DiscoveryKind, _id: &str) -> Result<(), ArrClientError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use wiremock::matchers::{body_partial_json, header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    fn req(id: i64, status: i64, media_status: i64) -> Value {
        json!({"id": id, "status": status, "type": "movie", "createdAt": "2026-10-01T10:00:00.000Z",
            "media": {"tmdbId": 603, "tvdbId": null, "status": media_status},
            "requestedBy": {"id": 3, "email": "u@example.com", "username": "u", "displayName": "U"}})
    }

    #[test]
    fn status_mapping() {
        assert_eq!(status_of(1, 1), RequestStatus::Pending);
        assert_eq!(status_of(2, 3), RequestStatus::Approved);
        assert_eq!(status_of(2, 5), RequestStatus::Available);
        assert_eq!(status_of(3, 1), RequestStatus::Declined);
        assert_eq!(status_of(3, 5), RequestStatus::Declined);
        assert_eq!(status_of(4, 1), RequestStatus::Failed);
        assert_eq!(status_of(5, 1), RequestStatus::Available);
    }

    #[test]
    fn parses_tv_request_with_seasons() {
        let v = json!({"id": 4, "status": 2, "type": "tv", "seasons": [{"seasonNumber": 2}, {"seasonNumber": 1}],
            "media": {"tmdbId": 1399, "tvdbId": 121361, "status": 3}});
        let r = parse_request(&v).unwrap();
        assert_eq!(r.kind, DiscoveryKind::Series);
        assert_eq!(r.seasons, vec![1, 2]);
        assert_eq!(r.tvdb_id, Some(121361));
    }

    #[tokio::test]
    async fn pages_requests_users_and_acts() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/request"))
            .and(header("X-Api-Key", "k"))
            .and(query_param("skip", "0"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"results": [req(1, 1, 1), req(2, 2, 5)]})),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/user"))
            .and(header("X-Api-Key", "k"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                json!({"results": [{"id": 3, "email": "u@example.com", "username": "u"}]}),
            ))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/movie/603"))
            .and(header("X-Api-Key", "k"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                json!({"title": "Sample Movie Kilo", "releaseDate": "1999-03-30", "posterPath": "/m.jpg"}),
            ))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/v1/request"))
            .and(header("X-Api-Key", "k"))
            .and(body_partial_json(
                json!({"mediaType": "movie", "mediaId": 603, "userId": 3}),
            ))
            .respond_with(ResponseTemplate::new(201).set_body_json(req(9, 1, 1)))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/v1/request/9/approve"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/v1/request/9/decline"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("DELETE"))
            .and(path("/api/v1/request/9"))
            .respond_with(ResponseTemplate::new(204))
            .expect(1)
            .mount(&server)
            .await;

        let c = SeerrClient::new(&server.uri(), "k");
        assert_eq!(c.list_requests().await.unwrap().len(), 2);
        assert_eq!(
            c.users().await.unwrap()[0].email.as_deref(),
            Some("u@example.com")
        );
        let info = c.title_info(DiscoveryKind::Movie, 603).await.unwrap();
        assert_eq!((info.title.as_str(), info.year), ("Sample Movie Kilo", Some(1999)));
        let created = c
            .create_request(&NewRemoteRequest {
                kind: DiscoveryKind::Movie,
                title: "Sample Movie Kilo".into(),
                tmdb_id: Some(603),
                tvdb_id: None,
                seasons: vec![],
                on_behalf_of: Some("3".into()),
            })
            .await
            .unwrap();
        assert_eq!(
            (created.id.as_str(), created.title.as_str()),
            ("9", "Sample Movie Kilo")
        );
        c.approve(DiscoveryKind::Movie, "9").await.unwrap();
        c.decline(DiscoveryKind::Movie, "9", None).await.unwrap();
        c.remove(DiscoveryKind::Movie, "9").await.unwrap();
    }

    #[tokio::test]
    async fn tv_create_sends_all_seasons_and_needs_tmdb() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/v1/request"))
            .and(body_partial_json(
                json!({"mediaType": "tv", "mediaId": 1399, "seasons": "all"}),
            ))
            .respond_with(ResponseTemplate::new(201).set_body_json(
                json!({"id": 5, "status": 1, "type": "tv", "media": {"tmdbId": 1399, "status": 1}}),
            ))
            .expect(1)
            .mount(&server)
            .await;
        let c = SeerrClient::new(&server.uri(), "k");
        let mut new = NewRemoteRequest {
            kind: DiscoveryKind::Series,
            title: "GoT".into(),
            tmdb_id: Some(1399),
            tvdb_id: Some(121361),
            seasons: vec![],
            on_behalf_of: None,
        };
        assert_eq!(c.create_request(&new).await.unwrap().id, "5");
        new.tmdb_id = None;
        assert!(c.create_request(&new).await.is_err());
    }
}
