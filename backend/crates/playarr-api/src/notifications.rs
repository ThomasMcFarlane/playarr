use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use chrono::{Duration, Utc};
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use playarr_model::{ClientPlatform, PushRegistration};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use utoipa::ToSchema;

use crate::auth_extractor::StreamingUser;
use crate::error::ApiError;
use crate::AppState;

#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct FirebaseWebConfig {
    pub api_key: String,
    pub auth_domain: String,
    pub project_id: String,
    pub storage_bucket: String,
    pub messaging_sender_id: String,
    pub app_id: String,
    pub vapid_public_key: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RegisterPushRequest {
    pub token: String,
    pub platform: ClientPlatform,
}

#[derive(Debug, Clone)]
pub struct PushMessage {
    pub title: String,
    pub body: String,
    pub link: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PushSendOutcome {
    Delivered,
    InvalidRegistration,
    Disabled,
}

#[async_trait]
pub trait PushNotifier: Send + Sync {
    async fn send(&self, token: &str, message: &PushMessage) -> Result<PushSendOutcome, String>;
}

pub struct DisabledPushNotifier;

#[async_trait]
impl PushNotifier for DisabledPushNotifier {
    async fn send(&self, _token: &str, _message: &PushMessage) -> Result<PushSendOutcome, String> {
        Ok(PushSendOutcome::Disabled)
    }
}

#[derive(Debug, Deserialize)]
struct ServiceAccount {
    project_id: String,
    private_key: String,
    client_email: String,
    #[serde(default = "default_token_uri")]
    token_uri: String,
}

fn default_token_uri() -> String {
    "https://oauth2.googleapis.com/token".to_string()
}

#[derive(Serialize)]
struct ServiceAccountClaims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    iat: i64,
    exp: i64,
}

#[derive(Deserialize)]
struct AccessTokenResponse {
    access_token: String,
    expires_in: i64,
}

struct CachedAccessToken {
    value: String,
    expires_at: chrono::DateTime<Utc>,
}

pub struct FcmNotifier {
    credentials: ServiceAccount,
    encoding_key: EncodingKey,
    client: reqwest::Client,
    access_token: Mutex<Option<CachedAccessToken>>,
}

impl FcmNotifier {
    pub fn from_service_account_file(path: impl AsRef<Path>) -> Result<Self, String> {
        let bytes = std::fs::read(path.as_ref()).map_err(|err| {
            format!(
                "failed to read Firebase service account {}: {err}",
                path.as_ref().display()
            )
        })?;
        let credentials: ServiceAccount = serde_json::from_slice(&bytes)
            .map_err(|err| format!("invalid Firebase service account JSON: {err}"))?;
        let encoding_key = EncodingKey::from_rsa_pem(credentials.private_key.as_bytes())
            .map_err(|err| format!("invalid Firebase service account private key: {err}"))?;
        Ok(Self {
            credentials,
            encoding_key,
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .map_err(|err| format!("failed to build Firebase HTTP client: {err}"))?,
            access_token: Mutex::new(None),
        })
    }

    async fn access_token(&self) -> Result<String, String> {
        let mut cached = self.access_token.lock().await;
        if let Some(token) = cached.as_ref() {
            if token.expires_at > Utc::now() + Duration::minutes(2) {
                return Ok(token.value.clone());
            }
        }

        let now = Utc::now();
        let claims = ServiceAccountClaims {
            iss: &self.credentials.client_email,
            scope: "https://www.googleapis.com/auth/firebase.messaging",
            aud: &self.credentials.token_uri,
            iat: now.timestamp(),
            exp: (now + Duration::hours(1)).timestamp(),
        };
        let assertion =
            jsonwebtoken::encode(&Header::new(Algorithm::RS256), &claims, &self.encoding_key)
                .map_err(|err| format!("failed to sign Firebase access-token request: {err}"))?;
        let response = self
            .client
            .post(&self.credentials.token_uri)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", assertion.as_str()),
            ])
            .send()
            .await
            .map_err(|err| format!("Firebase OAuth request failed: {err}"))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Firebase OAuth returned {status}: {body}"));
        }
        let token: AccessTokenResponse = response
            .json()
            .await
            .map_err(|err| format!("invalid Firebase OAuth response: {err}"))?;
        let value = token.access_token.clone();
        *cached = Some(CachedAccessToken {
            value: token.access_token,
            expires_at: now + Duration::seconds(token.expires_in),
        });
        Ok(value)
    }
}

#[async_trait]
impl PushNotifier for FcmNotifier {
    async fn send(&self, token: &str, message: &PushMessage) -> Result<PushSendOutcome, String> {
        let access_token = self.access_token().await?;
        let url = format!(
            "https://fcm.googleapis.com/v1/projects/{}/messages:send",
            self.credentials.project_id
        );
        let response = self
            .client
            .post(url)
            .bearer_auth(access_token)
            .json(&serde_json::json!({
                "message": {
                    "token": token,
                    "notification": { "title": message.title, "body": message.body },
                    "data": { "link": message.link, "kind": "invite_approved" },
                    "webpush": { "fcm_options": { "link": message.link } },
                    "android": { "priority": "high" }
                }
            }))
            .send()
            .await
            .map_err(|err| format!("FCM send failed: {err}"))?;
        if response.status().is_success() {
            return Ok(PushSendOutcome::Delivered);
        }
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if status == reqwest::StatusCode::NOT_FOUND
            || status == reqwest::StatusCode::GONE
            || body.contains("UNREGISTERED")
        {
            return Ok(PushSendOutcome::InvalidRegistration);
        }
        Err(format!("FCM returned {status}: {body}"))
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/notifications/config",
    tag = "users",
    responses(
        (status = 200, description = "Firebase Web configuration", body = FirebaseWebConfig, example = json!({
            "api_key": "AIzaSyD-example1234567890abcdefghijklmno",
            "auth_domain": "example-project.firebaseapp.com",
            "project_id": "example-project",
            "storage_bucket": "example-project.appspot.com",
            "messaging_sender_id": "000000000000",
            "app_id": "1:000000000000:web:9f2a3b7c1d4e5f6a7b8c9d",
            "vapid_public_key": "BEl62iUYgUivxIkv69yViEuiBIa40HI8YlOm5EF7Wv3-VBs9aLLpFBc5eDo8mV5yYBQNe4x7l9mLKQ3sXk9ZgYo"
        })),
        (status = 404, description = "Push notifications are not configured"),
        (status = 401, description = "Missing or invalid access token")
    )
)]
pub async fn push_config_handler(
    State(state): State<AppState>,
    _streaming: StreamingUser,
) -> Result<Json<FirebaseWebConfig>, ApiError> {
    state
        .firebase_web_config
        .as_ref()
        .cloned()
        .map(Json)
        .ok_or_else(|| ApiError::not_found("push notifications are not configured"))
}

#[utoipa::path(
    post,
    path = "/api/v1/users/me/push-registrations",
    tag = "users",
    request_body(content = RegisterPushRequest, example = json!({
        "token": "firebase-installation-id",
        "platform": "web"
    })),
    responses(
        (status = 204, description = "Push registration saved"),
        (status = 400, description = "Unsupported platform or invalid token"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Account cannot use Playarr")
    )
)]
pub async fn register_push_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Json(body): Json<RegisterPushRequest>,
) -> Result<StatusCode, ApiError> {
    if body.token.trim().is_empty() || body.token.len() > 4096 {
        return Err(ApiError::bad_request("push token is invalid"));
    }
    if !matches!(
        body.platform,
        ClientPlatform::Web | ClientPlatform::AndroidMobile | ClientPlatform::AndroidTv
    ) {
        return Err(ApiError::bad_request(
            "push notifications are supported only on web and Android clients",
        ));
    }
    state
        .push_registration_repo
        .upsert(&PushRegistration {
            token: body.token,
            user_id: streaming.user_id,
            platform: body.platform,
            updated_at: Utc::now(),
        })
        .await
        .map_err(|err| ApiError::internal(format!("failed to save push registration: {err}")))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn notify_invite_approved(state: &AppState, user_id: uuid::Uuid) {
    let registrations = match state.push_registration_repo.list_for_user(user_id).await {
        Ok(registrations) => registrations,
        Err(err) => {
            tracing::warn!(%user_id, %err, "failed to load push registrations");
            return;
        }
    };
    let message = PushMessage {
        title: "Friend invite approved".to_string(),
        body: "Open Playarr Settings to generate your 24-hour invite QR.".to_string(),
        link: "https://playarr.app/settings".to_string(),
    };
    for registration in registrations {
        match state
            .push_notifier
            .send(&registration.token, &message)
            .await
        {
            Ok(PushSendOutcome::InvalidRegistration) => {
                if let Err(err) = state
                    .push_registration_repo
                    .delete(&registration.token)
                    .await
                {
                    tracing::warn!(%err, "failed to remove invalid push registration");
                }
            }
            Ok(PushSendOutcome::Delivered | PushSendOutcome::Disabled) => {}
            Err(err) => {
                tracing::warn!(%user_id, platform = %registration.platform.wire_name(), %err, "invite approval push failed")
            }
        }
    }
}

pub fn disabled_notifier() -> Arc<dyn PushNotifier> {
    Arc::new(DisabledPushNotifier)
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use playarr_model::ClientPlatform;
    use tower::ServiceExt;
    use uuid::Uuid;

    use crate::test_support::{bearer_header, mint_access_token, seed_streaming_user, test_state};

    #[tokio::test]
    async fn streaming_user_registers_web_push_installation() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/users/me/push-registrations")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(
                        serde_json::json!({
                            "token": "firebase-installation-id",
                            "platform": "web"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let registrations = state
            .app
            .push_registration_repo
            .list_for_user(user_id)
            .await
            .unwrap();
        assert_eq!(registrations.len(), 1);
        assert_eq!(registrations[0].platform, ClientPlatform::Web);
    }
}
