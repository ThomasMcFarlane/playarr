use async_trait::async_trait;
use playarr_model::Sensitive;
use serde::{Deserialize, Serialize};

use crate::http::{build_http_client, get_json, get_status};
use crate::{ArrClientError, ArrConnector};

/// An author as Readarr's `/api/v1/author` endpoint returns it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadarrAuthor {
    pub id: i64,
    #[serde(rename = "authorName")]
    pub author_name: String,
    /// Goodreads author id.
    #[serde(rename = "foreignAuthorId")]
    pub foreign_author_id: String,
    pub monitored: bool,
    pub path: String,
}

/// A book as Readarr's `/api/v1/book` endpoint returns it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadarrBook {
    pub id: i64,
    pub title: String,
    /// Goodreads (or other configured metadata provider) book id.
    #[serde(rename = "foreignBookId")]
    pub foreign_book_id: String,
    #[serde(rename = "authorId")]
    pub author_id: i64,
    pub monitored: bool,
}

/// The nested `quality.quality` object on Readarr's quality-bearing
/// resources (e.g. `"EPUB"`, `"PDF"`, `"MP3-320"` for audiobooks).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadarrQualityInfo {
    pub id: i64,
    pub name: String,
}

/// The nested `quality.revision` object — repack tracking.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadarrRevision {
    pub version: i64,
    pub real: i64,
    #[serde(rename = "isRepack")]
    pub is_repack: bool,
}

/// The `quality` object embedded in a book file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadarrQuality {
    pub quality: ReadarrQualityInfo,
    pub revision: ReadarrRevision,
}

/// A book file as Readarr's `/api/v1/bookfile` endpoint returns it.
///
/// **Uncertainty note (per this task's instructions to implement Readarr's
/// best-effort real attempt rather than skip it):** Readarr is the "best
/// effort, archived upstream" integration in this codebase — it has no
/// actively maintained public API reference (no published OpenAPI/Swagger
/// spec equivalent to Sonarr/Radarr's) to verify this shape against at
/// implementation time. Readarr forked from the same "Servarr" codebase
/// family as Sonarr/Radarr/Lidarr, and its book-file resource is expected
/// to mirror Lidarr's `TrackFileResource` shape closely (same underlying
/// `id`/`<parent>Id`/`path`/`size`/`quality` pattern, since Readarr's
/// author/book relationship is structurally identical to Lidarr's
/// artist/album one). This struct is deliberately narrower than the
/// Sonarr/Radarr/Lidarr file structs — it omits `mediaInfo` and
/// `relativePath`, whose presence/shape for Readarr specifically could not
/// be confirmed — and should be corrected against a real Readarr instance's
/// response before being relied on for anything beyond `id`/`path`/`size`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadarrBookFile {
    pub id: i64,
    #[serde(rename = "authorId")]
    pub author_id: i64,
    #[serde(rename = "bookId")]
    pub book_id: i64,
    pub path: String,
    pub size: i64,
    pub quality: ReadarrQuality,
}

pub struct ReadarrClient {
    http: reqwest::Client,
    base_url: String,
    api_key: Sensitive<String>,
}

impl ReadarrClient {
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            http: build_http_client(),
            base_url: base_url.into(),
            api_key: Sensitive::new(api_key.into()),
        }
    }

    /// `GET /api/v1/author` — every author Readarr currently tracks.
    pub async fn list_authors(&self) -> Result<Vec<ReadarrAuthor>, ArrClientError> {
        get_json(
            &self.http,
            "readarr",
            &self.base_url,
            &self.api_key,
            "/api/v1/author",
        )
        .await
    }

    /// `GET /api/v1/author/{id}` — a single author by Readarr's own id.
    pub async fn get_author(&self, id: i64) -> Result<ReadarrAuthor, ArrClientError> {
        get_json(
            &self.http,
            "readarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v1/author/{id}"),
        )
        .await
    }

    /// `GET /api/v1/book` — every book Readarr currently tracks, across all
    /// authors.
    pub async fn list_books(&self) -> Result<Vec<ReadarrBook>, ArrClientError> {
        get_json(
            &self.http,
            "readarr",
            &self.base_url,
            &self.api_key,
            "/api/v1/book",
        )
        .await
    }

    /// `GET /api/v1/book?authorId={id}` — the books belonging to one
    /// author, e.g. to populate an author detail view without pulling
    /// Readarr's entire catalog.
    pub async fn list_books_for_author(
        &self,
        author_id: i64,
    ) -> Result<Vec<ReadarrBook>, ArrClientError> {
        get_json(
            &self.http,
            "readarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v1/book?authorId={author_id}"),
        )
        .await
    }

    /// `GET /api/v1/bookfile?authorId={id}` — every book file Readarr has
    /// imported for one author, across all their books.
    ///
    /// See [`ReadarrBookFile`]'s doc comment for the uncertainty around
    /// this endpoint/shape: Readarr's API is not authoritatively
    /// documented the way Sonarr/Radarr/Lidarr's are, so this is a
    /// best-effort real implementation by analogy with Lidarr's
    /// equivalent `/api/v1/trackfile?artistId={id}` endpoint, not a
    /// verified-against-spec one.
    pub async fn list_book_files(
        &self,
        author_id: i64,
    ) -> Result<Vec<ReadarrBookFile>, ArrClientError> {
        get_json(
            &self.http,
            "readarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v1/bookfile?authorId={author_id}"),
        )
        .await
    }
}

impl ReadarrClient {
    /// `GET /api/v1/calendar` -- books releasing in the inclusive
    /// `[start, end]` day window, including unmonitored items.
    pub async fn calendar(
        &self,
        start: chrono::NaiveDate,
        end: chrono::NaiveDate,
    ) -> Result<Vec<crate::calendar::ReadarrCalendarBook>, ArrClientError> {
        let query = crate::calendar::window_query(start, end, "includeAuthor=true");
        get_json(
            &self.http,
            "readarr",
            &self.base_url,
            &self.api_key,
            &format!("/api/v1/calendar?{query}"),
        )
        .await
    }
}

#[async_trait]
impl ArrConnector for ReadarrClient {
    fn base_url(&self) -> &str {
        &self.base_url
    }

    async fn health_check(&self) -> Result<(), ArrClientError> {
        get_status(
            &self.http,
            "readarr",
            &self.base_url,
            &self.api_key,
            "/api/v1/system/status",
        )
        .await
    }
}

impl ReadarrClient {
    /// `GET /api/v1/rootfolder` — every root folder configured in the app.
    pub async fn list_root_folders(&self) -> Result<Vec<crate::ArrRootFolder>, ArrClientError> {
        get_json(
            &self.http,
            "readarr",
            &self.base_url,
            &self.api_key,
            "/api/v1/rootfolder",
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    #[tokio::test]
    async fn list_root_folders_uses_the_rootfolder_endpoint() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/rootfolder"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {"id": 3, "path": "/library/sample", "accessible": true,
                  "freeSpace": 100, "totalSpace": 200, "unmappedFolders": []}
            ])))
            .mount(&server)
            .await;
        let roots = ReadarrClient::new(server.uri(), "test-key")
            .list_root_folders()
            .await
            .expect("root folders parse");
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].id, 3);
        assert_eq!(roots[0].path, "/library/sample");
        assert_eq!(roots[0].free_space, Some(100));
    }

    #[tokio::test]
    async fn list_authors_parses_response_and_sends_api_key() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/author"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 1,
                    "authorName": "Ursula K. Le Guin",
                    "foreignAuthorId": "874602",
                    "monitored": true,
                    "path": "/books/Ursula K. Le Guin"
                }
            ])))
            .mount(&server)
            .await;

        let client = ReadarrClient::new(server.uri(), "test-key");
        let authors = client
            .list_authors()
            .await
            .expect("list_authors should succeed against a healthy mock");

        assert_eq!(authors.len(), 1);
        assert_eq!(authors[0].author_name, "Ursula K. Le Guin");
    }

    #[tokio::test]
    async fn get_author_parses_single_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/author/5"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": 5,
                "authorName": "Sample Author",
                "foreignAuthorId": "58610",
                "monitored": true,
                "path": "/books/Sample Author"
            })))
            .mount(&server)
            .await;

        let client = ReadarrClient::new(server.uri(), "test-key");
        let author = client
            .get_author(5)
            .await
            .expect("get_author should succeed against a healthy mock");

        assert_eq!(author.id, 5);
        assert_eq!(author.author_name, "Sample Author");
    }

    #[tokio::test]
    async fn list_books_parses_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/book"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 200,
                    "title": "Sample Title",
                    "foreignBookId": "234225",
                    "authorId": 5,
                    "monitored": true
                }
            ])))
            .mount(&server)
            .await;

        let client = ReadarrClient::new(server.uri(), "test-key");
        let books = client
            .list_books()
            .await
            .expect("list_books should succeed against a healthy mock");

        assert_eq!(books.len(), 1);
        assert_eq!(books[0].title, "Sample Title");
        assert_eq!(books[0].author_id, 5);
    }

    #[tokio::test]
    async fn list_books_for_author_filters_by_query_param() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/book"))
            .and(query_param("authorId", "5"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 200,
                    "title": "Sample Title",
                    "foreignBookId": "234225",
                    "authorId": 5,
                    "monitored": true
                }
            ])))
            .mount(&server)
            .await;

        let client = ReadarrClient::new(server.uri(), "test-key");
        let books = client
            .list_books_for_author(5)
            .await
            .expect("list_books_for_author should succeed against a healthy mock");

        assert_eq!(books.len(), 1);
        assert_eq!(books[0].author_id, 5);
    }

    #[tokio::test]
    async fn list_book_files_filters_by_author_id_and_parses_quality() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/bookfile"))
            .and(query_param("authorId", "5"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {
                    "id": 900,
                    "authorId": 5,
                    "bookId": 200,
                    "path": "/books/Sample Author/Sample Title/Sample Title.epub",
                    "size": 2_345_678,
                    "quality": {
                        "quality": {
                            "id": 1,
                            "name": "EPUB"
                        },
                        "revision": {
                            "version": 1,
                            "real": 0,
                            "isRepack": false
                        }
                    }
                }
            ])))
            .mount(&server)
            .await;

        let client = ReadarrClient::new(server.uri(), "test-key");
        let files = client
            .list_book_files(5)
            .await
            .expect("list_book_files should succeed against a healthy mock");

        assert_eq!(files.len(), 1);
        let file = &files[0];
        assert_eq!(file.id, 900);
        assert_eq!(file.author_id, 5);
        assert_eq!(file.book_id, 200);
        assert_eq!(
            file.path,
            "/books/Sample Author/Sample Title/Sample Title.epub"
        );
        assert_eq!(file.quality.quality.name, "EPUB");
    }

    #[tokio::test]
    async fn list_book_files_returns_empty_vec_when_author_has_no_files() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/bookfile"))
            .and(query_param("authorId", "77"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;

        let client = ReadarrClient::new(server.uri(), "test-key");
        let files = client
            .list_book_files(77)
            .await
            .expect("list_book_files should succeed even with an empty result");

        assert!(files.is_empty());
    }

    #[tokio::test]
    async fn health_check_surfaces_401_as_unexpected_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/system/status"))
            .respond_with(ResponseTemplate::new(401).set_body_string("Unauthorized"))
            .mount(&server)
            .await;

        let client = ReadarrClient::new(server.uri(), "wrong-key");
        let err = client
            .health_check()
            .await
            .expect_err("a 401 status should surface as an error, not Ok");

        match err {
            ArrClientError::UnexpectedStatus { app, status, .. } => {
                assert_eq!(app, "readarr");
                assert_eq!(status, reqwest::StatusCode::UNAUTHORIZED);
            }
            other => panic!("expected UnexpectedStatus, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn list_authors_surfaces_500_as_unexpected_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/author"))
            .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
            .mount(&server)
            .await;

        let client = ReadarrClient::new(server.uri(), "test-key");
        let err = client
            .list_authors()
            .await
            .expect_err("a 500 status should surface as an error, not panic");

        match err {
            ArrClientError::UnexpectedStatus { app, status, .. } => {
                assert_eq!(app, "readarr");
                assert_eq!(status, reqwest::StatusCode::INTERNAL_SERVER_ERROR);
            }
            other => panic!("expected UnexpectedStatus, got {other:?}"),
        }
    }
}
