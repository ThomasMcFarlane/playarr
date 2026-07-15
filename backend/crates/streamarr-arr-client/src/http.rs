//! Request plumbing shared by every *arr client: building a `reqwest`
//! client, attaching the `X-Api-Key` header every *arr app expects, and
//! turning a non-2xx response into an [`ArrClientError`] uniformly so each
//! per-app module only has to describe *which* endpoint and *what shape*,
//! not how to make an HTTP request.

use serde::de::DeserializeOwned;
use streamarr_model::Sensitive;

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
