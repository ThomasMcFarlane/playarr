//! Ombi client (v4 API). Auth is the `ApiKey` header; the key acts as an
//! administrator so requests can be created on behalf of a user
//! (`requestOnBehalf`). Movie requests use `/api/v1/Request/movie`, TV uses
//! the v2 endpoint keyed by TMDB id; TV is tracked per *child request*, which
//! is the unit Ombi approves, denies and deletes.

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

const APP: &str = "ombi";

pub struct OmbiClient {
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

fn b(v: &Value, k: &str) -> bool {
    v.get(k).and_then(Value::as_bool).unwrap_or(false)
}

fn dt(v: &Value, k: &str) -> Option<DateTime<Utc>> {
    let d = DateTime::parse_from_rfc3339(v.get(k)?.as_str()?)
        .ok()?
        .with_timezone(&Utc);
    (d.timestamp() > 0).then_some(d)
}

fn user_of(v: &Value) -> Option<ExternalUser> {
    let u = v.get("requestedUser").filter(|u| u.is_object());
    let id = s(v, "requestedUserId").or_else(|| u.and_then(|u| s(u, "id")))?;
    Some(ExternalUser {
        id,
        username: u.and_then(|u| s(u, "userName")),
        email: u.and_then(|u| s(u, "emailAddress")),
        display_name: u.and_then(|u| s(u, "alias")),
    })
}

fn status_of(approved: bool, available: bool, denied: bool) -> RequestStatus {
    if denied {
        RequestStatus::Declined
    } else if available {
        RequestStatus::Available
    } else if approved {
        RequestStatus::Approved
    } else {
        RequestStatus::Pending
    }
}

pub(crate) fn parse_movie(v: &Value) -> Option<RemoteRequest> {
    let id = v.get("id")?.as_i64()?.to_string();
    Some(RemoteRequest {
        id,
        kind: DiscoveryKind::Movie,
        title: s(v, "title").unwrap_or_default(),
        year: s(v, "releaseDate").as_deref().and_then(year_of),
        tmdb_id: v
            .get("theMovieDbId")
            .and_then(Value::as_i64)
            .filter(|i| *i > 0),
        tvdb_id: None,
        imdb_id: s(v, "imdbId"),
        poster_url: s(v, "posterPath").as_deref().and_then(tmdb_poster),
        seasons: Vec::new(),
        requester: user_of(v),
        status: status_of(b(v, "approved"), b(v, "available"), b(v, "denied")),
        created_at: dt(v, "requestedDate"),
        note: s(v, "deniedReason"),
    })
}

/// One remote request per child request of a series.
pub(crate) fn parse_tv(v: &Value) -> Vec<RemoteRequest> {
    let tvdb = v.get("tvDbId").and_then(Value::as_i64).filter(|i| *i > 0);
    let tmdb = v
        .get("externalProviderId")
        .and_then(Value::as_i64)
        .filter(|i| *i > 0);
    let Some(children) = v.get("childRequests").and_then(Value::as_array) else {
        return Vec::new();
    };
    children
        .iter()
        .filter_map(|c| {
            let id = c.get("id")?.as_i64()?.to_string();
            let seasons = c
                .get("seasonRequests")
                .and_then(Value::as_array)
                .map(|a| {
                    let mut n: Vec<i32> = a
                        .iter()
                        .filter_map(|s| s.get("seasonNumber").and_then(Value::as_i64))
                        .map(|n| n as i32)
                        .collect();
                    n.sort_unstable();
                    n
                })
                .unwrap_or_default();
            Some(RemoteRequest {
                id,
                kind: DiscoveryKind::Series,
                title: s(v, "title").unwrap_or_default(),
                year: s(v, "releaseDate").as_deref().and_then(year_of),
                tmdb_id: tmdb,
                tvdb_id: tvdb,
                imdb_id: s(v, "imdbId"),
                poster_url: s(v, "posterPath").as_deref().and_then(tmdb_poster),
                seasons,
                requester: user_of(c),
                status: status_of(b(c, "approved"), b(c, "available"), b(c, "denied")),
                created_at: dt(c, "requestedDate"),
                note: s(c, "deniedReason"),
            })
        })
        .collect()
}

impl OmbiClient {
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
            .request(method, format!("{}{}", self.base_url, path))
            .header("ApiKey", self.api_key.expose_secret());
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
        Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
    }

    /// Ombi reports many failures as HTTP 200 with `isError`/`result:false`.
    fn check_result(value: &Value) -> Result<(), ArrClientError> {
        let failed = value.get("isError").and_then(Value::as_bool) == Some(true)
            || value.get("result").and_then(Value::as_bool) == Some(false);
        if failed {
            let msg = s(value, "errorMessage")
                .or_else(|| s(value, "message"))
                .unwrap_or_else(|| "request rejected".into());
            return Err(ArrClientError::UnexpectedStatus {
                app: APP,
                status: reqwest::StatusCode::UNPROCESSABLE_ENTITY,
                body: msg,
            });
        }
        Ok(())
    }
}

#[async_trait]
impl RequestManagerClient for OmbiClient {
    async fn test(&self) -> Result<String, ArrClientError> {
        // Authenticated, cheap, and rejects a wrong key (401).
        self.send(reqwest::Method::GET, "/api/v1/Request/movie/total", None)
            .await?;
        Ok("Ombi".into())
    }

    async fn users(&self) -> Result<Vec<ExternalUser>, ArrClientError> {
        let v = self
            .send(reqwest::Method::GET, "/api/v1/Identity/Users", None)
            .await?;
        Ok(v.as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|u| {
                        Some(ExternalUser {
                            id: s(u, "id")?,
                            username: s(u, "userName"),
                            email: s(u, "emailAddress"),
                            display_name: s(u, "alias"),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    async fn list_requests(&self) -> Result<Vec<RemoteRequest>, ArrClientError> {
        let movies = self
            .send(reqwest::Method::GET, "/api/v1/Request/movie", None)
            .await?;
        let tv = self
            .send(reqwest::Method::GET, "/api/v1/Request/tv", None)
            .await?;
        let mut out: Vec<RemoteRequest> = movies
            .as_array()
            .map(|a| a.iter().filter_map(parse_movie).collect())
            .unwrap_or_default();
        if let Some(a) = tv.as_array() {
            out.extend(a.iter().flat_map(parse_tv));
        }
        Ok(out)
    }

    async fn title_info(
        &self,
        kind: DiscoveryKind,
        tmdb_id: i64,
    ) -> Result<TitleInfo, ArrClientError> {
        let path = match kind {
            DiscoveryKind::Series => format!("/api/v2/Search/tv/moviedb/{tmdb_id}"),
            _ => format!("/api/v2/Search/movie/{tmdb_id}"),
        };
        let v = self.send(reqwest::Method::GET, &path, None).await?;
        Ok(TitleInfo {
            title: s(&v, "title").unwrap_or_default(),
            year: s(&v, "releaseDate")
                .or_else(|| s(&v, "firstAired"))
                .as_deref()
                .and_then(year_of),
            poster_url: s(&v, "posterPath")
                .or_else(|| s(&v, "banner"))
                .as_deref()
                .and_then(tmdb_poster),
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
                body: "Ombi needs a TMDB id for this title".into(),
            })?;
        let (path, body) = match new.kind {
            DiscoveryKind::Series => {
                let seasons: Vec<Value> = new
                    .seasons
                    .iter()
                    .map(|n| json!({ "seasonNumber": n, "episodes": [] }))
                    .collect();
                (
                    "/api/v2/Requests/tv",
                    json!({
                        "theMovieDbId": tmdb,
                        "languageCode": "en",
                        "requestAll": new.seasons.is_empty(),
                        "latestSeason": false,
                        "firstSeason": false,
                        "seasons": seasons,
                        "requestOnBehalf": new.on_behalf_of,
                    }),
                )
            }
            _ => (
                "/api/v1/Request/movie",
                json!({
                    "theMovieDbId": tmdb,
                    "languageCode": "en",
                    "requestOnBehalf": new.on_behalf_of,
                }),
            ),
        };
        let reply = self.send(reqwest::Method::POST, path, Some(&body)).await?;
        Self::check_result(&reply)?;
        // The create reply is not reliable about the new id across versions;
        // read the request back. For TV the newest matching child wins.
        let all = self.list_requests().await?;
        all.into_iter()
            .filter(|r| r.kind == new.kind && r.tmdb_id == Some(tmdb))
            .max_by_key(|r| r.id.parse::<i64>().unwrap_or(0))
            .ok_or_else(|| ArrClientError::UnexpectedStatus {
                app: APP,
                status: reqwest::StatusCode::BAD_GATEWAY,
                body: "request was accepted but could not be read back".into(),
            })
    }

    async fn approve(&self, kind: DiscoveryKind, id: &str) -> Result<(), ArrClientError> {
        let (path, body) = update_call(kind, "approve", id);
        let r = self.send(reqwest::Method::POST, path, Some(&body)).await?;
        Self::check_result(&r)
    }

    async fn decline(
        &self,
        kind: DiscoveryKind,
        id: &str,
        reason: Option<&str>,
    ) -> Result<(), ArrClientError> {
        let (path, mut body) = update_call(kind, "deny", id);
        body["reason"] = json!(reason.unwrap_or(""));
        let r = self.send(reqwest::Method::PUT, path, Some(&body)).await?;
        Self::check_result(&r)
    }

    async fn remove(&self, kind: DiscoveryKind, id: &str) -> Result<(), ArrClientError> {
        let path = match kind {
            DiscoveryKind::Series => format!("/api/v1/Request/tv/child/{id}"),
            _ => format!("/api/v1/Request/movie/{id}"),
        };
        self.send(reqwest::Method::DELETE, &path, None).await?;
        Ok(())
    }

    async fn mark_available(&self, kind: DiscoveryKind, id: &str) -> Result<(), ArrClientError> {
        let (path, body) = update_call(kind, "available", id);
        let r = self.send(reqwest::Method::POST, path, Some(&body)).await?;
        Self::check_result(&r)
    }
}

fn update_call(kind: DiscoveryKind, action: &str, id: &str) -> (&'static str, Value) {
    let id: i64 = id.parse().unwrap_or(0);
    match (kind, action) {
        (DiscoveryKind::Series, "approve") => ("/api/v1/Request/tv/approve", json!({ "id": id })),
        (DiscoveryKind::Series, "deny") => ("/api/v1/Request/tv/deny", json!({ "id": id })),
        (DiscoveryKind::Series, _) => ("/api/v1/Request/tv/available", json!({ "id": id })),
        (_, "approve") => ("/api/v1/Request/movie/approve", json!({ "id": id })),
        (_, "deny") => ("/api/v1/Request/movie/deny", json!({ "id": id })),
        (_, _) => ("/api/v1/Request/movie/available", json!({ "id": id })),
    }
}

#[cfg(test)]
mod tests {
    use wiremock::matchers::{body_partial_json, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    fn movie(id: i64, approved: bool, denied: bool) -> Value {
        json!({
            "id": id, "theMovieDbId": 800787, "title": "A Sample Person",
            "releaseDate": "2023-03-23T00:00:00Z", "posterPath": "/p.jpg", "imdbId": "tt14153080",
            "approved": approved, "available": false, "denied": denied, "deniedReason": null,
            "requestedDate": "2024-03-15T23:50:00Z", "requestedUserId": "u1",
            "requestedUser": {"id": "u1", "userName": "finlay", "emailAddress": "f@example.com", "alias": ""}
        })
    }

    #[test]
    fn parses_movie_status_and_user() {
        let r = parse_movie(&movie(5, true, false)).unwrap();
        assert_eq!(r.id, "5");
        assert_eq!(r.status, RequestStatus::Approved);
        assert_eq!(r.year, Some(2023));
        assert_eq!(r.tmdb_id, Some(800787));
        assert_eq!(r.requester.unwrap().email.as_deref(), Some("f@example.com"));
        assert_eq!(
            parse_movie(&movie(6, false, true)).unwrap().status,
            RequestStatus::Declined
        );
        assert_eq!(
            parse_movie(&movie(7, false, false)).unwrap().status,
            RequestStatus::Pending
        );
    }

    #[test]
    fn parses_tv_children_with_seasons() {
        let v = json!({"tvDbId": 420207, "externalProviderId": 202308, "title": "Alert", "releaseDate": "2023-01-08T00:00:00Z",
            "childRequests": [{"id": 9, "approved": true, "available": false, "denied": false, "requestedUserId": "u2",
              "seasonRequests": [{"seasonNumber": 2}, {"seasonNumber": 1}]}]});
        let r = parse_tv(&v);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].seasons, vec![1, 2]);
        assert_eq!(r[0].tvdb_id, Some(420207));
        assert_eq!(r[0].tmdb_id, Some(202308));
        assert_eq!(r[0].status, RequestStatus::Approved);
    }

    #[tokio::test]
    async fn lists_creates_on_behalf_and_acts() {
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/api/v1/Request/movie"))
            .and(header("ApiKey", "secret"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([movie(5, false, false)])))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/Request/tv"))
            .and(header("ApiKey", "secret"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/v1/Request/movie"))
            .and(header("ApiKey", "secret"))
            .and(body_partial_json(
                json!({"theMovieDbId": 800787, "requestOnBehalf": "u1"}),
            ))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"result": true, "message": "ok", "isError": false})),
            )
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/v1/Request/movie/approve"))
            .and(body_partial_json(json!({"id": 5})))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!({"result": true, "isError": false})),
            )
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("PUT"))
            .and(path("/api/v1/Request/movie/deny"))
            .and(body_partial_json(json!({"id": 5, "reason": "no"})))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"result": true})))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("DELETE"))
            .and(path("/api/v1/Request/movie/5"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;

        let c = OmbiClient::new(&server.uri(), "secret");
        let listed = c.list_requests().await.unwrap();
        assert_eq!(listed.len(), 1);
        let created = c
            .create_request(&NewRemoteRequest {
                kind: DiscoveryKind::Movie,
                title: "A Sample Person".into(),
                tmdb_id: Some(800787),
                tvdb_id: None,
                seasons: vec![],
                on_behalf_of: Some("u1".into()),
            })
            .await
            .unwrap();
        assert_eq!(created.id, "5");
        c.approve(DiscoveryKind::Movie, "5").await.unwrap();
        c.decline(DiscoveryKind::Movie, "5", Some("no"))
            .await
            .unwrap();
        c.remove(DiscoveryKind::Movie, "5").await.unwrap();
    }

    #[tokio::test]
    async fn surfaces_ombi_error_results_and_missing_tmdb() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/v1/Request/movie"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                json!({"result": false, "isError": true, "errorMessage": "Already requested"}),
            ))
            .mount(&server)
            .await;
        let c = OmbiClient::new(&server.uri(), "secret");
        let mut new = NewRemoteRequest {
            kind: DiscoveryKind::Movie,
            title: "x".into(),
            tmdb_id: Some(1),
            tvdb_id: None,
            seasons: vec![],
            on_behalf_of: None,
        };
        let err = c.create_request(&new).await.unwrap_err().to_string();
        assert!(err.contains("Already requested"), "{err}");
        new.tmdb_id = None;
        assert!(c
            .create_request(&new)
            .await
            .unwrap_err()
            .to_string()
            .contains("TMDB"));
    }

    #[tokio::test]
    async fn wrong_key_is_an_error() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;
        assert!(OmbiClient::new(&server.uri(), "bad").test().await.is_err());
    }
}
