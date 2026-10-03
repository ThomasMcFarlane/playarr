//! Request plumbing shared by every *arr client: building a `reqwest`
//! client, attaching the `X-Api-Key` header every *arr app expects, and
//! turning a non-2xx response into an [`ArrClientError`] uniformly so each
//! per-app module only has to describe *which* endpoint and *what shape*,
//! not how to make an HTTP request.

use playarr_model::Sensitive;
use serde::de::DeserializeOwned;

use crate::ArrClientError;

pub(crate) fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .build()
        .expect("reqwest::Client::builder with only default settings should never fail")
}

/// `GET`s `path` against `base_url`, decoding the JSON body as `T`.
pub(crate) async fn get_json<T: DeserializeOwned>(
    http: &reqwest::Client,
    app: &'static str,
    base_url: &str,
    api_key: &Sensitive<String>,
    path: &str,
) -> Result<T, ArrClientError> {
    let url = format!("{}{}", base_url.trim_end_matches('/'), path);
    let response = http
        .get(&url)
        .header("X-Api-Key", api_key.expose_secret())
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(ArrClientError::UnexpectedStatus { app, status, body });
    }

    let bytes = response.bytes().await?;
    serde_json::from_slice(&bytes).map_err(|source| ArrClientError::Decode { app, source })
}

/// `POST`s `body` as JSON to `path`, decoding the JSON response as `T`.
pub(crate) async fn post_json<T: DeserializeOwned>(
    http: &reqwest::Client,
    app: &'static str,
    base_url: &str,
    api_key: &Sensitive<String>,
    path: &str,
    body: &serde_json::Value,
) -> Result<T, ArrClientError> {
    let url = format!("{}{}", base_url.trim_end_matches('/'), path);
    let response = http
        .post(&url)
        .header("X-Api-Key", api_key.expose_secret())
        .json(body)
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(ArrClientError::UnexpectedStatus { app, status, body });
    }

    let bytes = response.bytes().await?;
    serde_json::from_slice(&bytes).map_err(|source| ArrClientError::Decode { app, source })
}

/// `GET`s `path`, discarding the body — used for health checks where only
/// the status code matters.
pub(crate) async fn get_status(
    http: &reqwest::Client,
    app: &'static str,
    base_url: &str,
    api_key: &Sensitive<String>,
    path: &str,
) -> Result<(), ArrClientError> {
    let url = format!("{}{}", base_url.trim_end_matches('/'), path);
    let response = http
        .get(&url)
        .header("X-Api-Key", api_key.expose_secret())
        .send()
        .await?;

    let status = response.status();
    if status.is_success() {
        Ok(())
    } else {
        let body = response.text().await.unwrap_or_default();
        Err(ArrClientError::UnexpectedStatus { app, status, body })
    }
}

#[cfg(test)]
mod tests {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    #[tokio::test]
    async fn get_json_maps_malformed_body_to_decode_error() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/broken"))
            .respond_with(ResponseTemplate::new(200).set_body_string("not json"))
            .mount(&server)
            .await;

        let http = build_http_client();
        let api_key = Sensitive::new("test-key".to_string());

        let err =
            get_json::<serde_json::Value>(&http, "sonarr", &server.uri(), &api_key, "/broken")
                .await
                .expect_err("a non-JSON 200 body should surface as a Decode error, not panic");

        match err {
            ArrClientError::Decode { app, .. } => assert_eq!(app, "sonarr"),
            other => panic!("expected Decode, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn get_status_maps_connection_failure_to_request_error() {
        // Port 1 (tcpmux) is a privileged port no unprivileged process binds
        // in a test sandbox, so nothing answers and the request fails at
        // the transport layer (connection refused) rather than getting an
        // HTTP response at all — exercising the `#[from] reqwest::Error`
        // path distinct from `UnexpectedStatus`. Unlike starting-then-
        // dropping a `MockServer`, this doesn't race another test's server
        // being handed the same now-free port.
        let http = build_http_client();
        let api_key = Sensitive::new("test-key".to_string());

        let err = get_status(
            &http,
            "sonarr",
            "http://127.0.0.1:1",
            &api_key,
            "/api/v3/system/status",
        )
        .await
        .expect_err("an unreachable host should surface as a transport error, not panic");

        assert!(
            matches!(err, ArrClientError::Request(_)),
            "expected Request, got {err:?}"
        );
    }
}
