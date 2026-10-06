//! Storage for unified media requests, Ombi/Seerr integrations and request
//! settings (TASKS 280-287; model in `playarr_model::requests`).

use std::collections::BTreeMap;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use playarr_model::discovery::DiscoveryKind;
use playarr_model::requests::{
    IntegrationKind, MediaRequest, RequestIntegration, RequestOrigin, RequestStatus,
    UserMappingStrategy,
};
use playarr_model::Sensitive;
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{
    bool_from_i64, bool_to_i64, decode_err, format_datetime, parse_datetime, parse_uuid,
};
use crate::error::DbError;
use crate::pool::DbPool;

#[async_trait]
pub trait MediaRequestRepo: Send + Sync {
    /// Newest first.
    async fn list(&self) -> Result<Vec<MediaRequest>, DbError>;
    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<MediaRequest>, DbError>;
    async fn get(&self, id: Uuid) -> Result<Option<MediaRequest>, DbError>;
    async fn find_by_title_key(&self, title_key: &str) -> Result<Option<MediaRequest>, DbError>;
    /// A row for the same title: any shared TMDB/TVDB/IMDb id of the same kind.
    async fn find_match(
        &self,
        kind: DiscoveryKind,
        tmdb_id: Option<i64>,
        tvdb_id: Option<i64>,
        imdb_id: Option<&str>,
    ) -> Result<Option<MediaRequest>, DbError>;
    async fn find_by_external(
        &self,
        kind: IntegrationKind,
        external_id: &str,
    ) -> Result<Option<MediaRequest>, DbError>;
    /// Insert or replace by id.
    async fn upsert(&self, request: &MediaRequest) -> Result<(), DbError>;
    async fn delete(&self, id: Uuid) -> Result<bool, DbError>;
}

#[async_trait]
pub trait RequestIntegrationRepo: Send + Sync {
    async fn list(&self) -> Result<Vec<RequestIntegration>, DbError>;
    async fn get(&self, id: Uuid) -> Result<Option<RequestIntegration>, DbError>;
    async fn upsert(&self, integration: &RequestIntegration) -> Result<(), DbError>;
    async fn delete(&self, id: Uuid) -> Result<bool, DbError>;
    async fn record_sync(
        &self,
        id: Uuid,
        at: DateTime<Utc>,
        error: Option<&str>,
    ) -> Result<(), DbError>;
    async fn get_setting(&self, key: &str) -> Result<Option<String>, DbError>;
    async fn set_setting(&self, key: &str, value: &str) -> Result<(), DbError>;
}

pub struct SqlxMediaRequestRepo {
    pool: DbPool,
}

impl SqlxMediaRequestRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    fn q(&self, text: &str) -> String {
        text.to_string()
    }

    async fn fetch(
        &self,
        text: &str,
        binds: &[Option<String>],
    ) -> Result<Vec<MediaRequest>, DbError> {
        let text = self.q(text);
        let mut query = sqlx::query(&text);
        for b in binds {
            query = query.bind(b.clone());
        }
        let rows = query.fetch_all(&self.pool).await?;
        rows.iter().map(request_from_row).collect()
    }
}

const COLS: &str = "id, title_key, kind, title, year, tmdb_id, tvdb_id, imdb_id, poster_url, \
    seasons, requester_user_id, requester_label, status, origin, ombi_request_id, \
    seerr_request_id, direct_instance_id, status_note, created_at, updated_at";

fn kind_from_str(raw: &str) -> Result<DiscoveryKind, DbError> {
    serde_json::from_value(serde_json::Value::String(raw.to_string()))
        .map_err(|_| decode_err(format!("unknown discovery kind {raw}")))
}

fn request_from_row(row: &AnyRow) -> Result<MediaRequest, DbError> {
    let id: String = row.try_get("id")?;
    let kind: String = row.try_get("kind")?;
    let seasons: String = row.try_get("seasons")?;
    let user: Option<String> = row.try_get("requester_user_id")?;
    let status: String = row.try_get("status")?;
    let origin: String = row.try_get("origin")?;
    let direct: Option<String> = row.try_get("direct_instance_id")?;
    let created: String = row.try_get("created_at")?;
    let updated: String = row.try_get("updated_at")?;
    Ok(MediaRequest {
        id: parse_uuid(&id)?,
        title_key: row.try_get("title_key")?,
        kind: kind_from_str(&kind)?,
        title: row.try_get("title")?,
        year: row.try_get("year")?,
        tmdb_id: row.try_get("tmdb_id")?,
        tvdb_id: row.try_get("tvdb_id")?,
        imdb_id: row.try_get("imdb_id")?,
        poster_url: row.try_get("poster_url")?,
        seasons: serde_json::from_str(&seasons)?,
        requester_user_id: user.as_deref().map(parse_uuid).transpose()?,
        requester_label: row.try_get("requester_label")?,
        status: RequestStatus::parse(&status)
            .ok_or_else(|| decode_err(format!("unknown request status {status}")))?,
        origin: RequestOrigin::parse(&origin)
            .ok_or_else(|| decode_err(format!("unknown request origin {origin}")))?,
        ombi_request_id: row.try_get("ombi_request_id")?,
        seerr_request_id: row.try_get("seerr_request_id")?,
        direct_instance_id: direct.as_deref().map(parse_uuid).transpose()?,
        status_note: row.try_get("status_note")?,
        created_at: parse_datetime(&created)?,
        updated_at: parse_datetime(&updated)?,
    })
}

#[async_trait]
impl MediaRequestRepo for SqlxMediaRequestRepo {
    async fn list(&self) -> Result<Vec<MediaRequest>, DbError> {
        self.fetch(
            &format!("SELECT {COLS} FROM media_requests ORDER BY created_at DESC, id"),
            &[],
        )
        .await
    }

    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<MediaRequest>, DbError> {
        self.fetch(
            &format!(
                "SELECT {COLS} FROM media_requests WHERE requester_user_id = ? \
                 ORDER BY created_at DESC, id"
            ),
            &[Some(user_id.to_string())],
        )
        .await
    }

    async fn get(&self, id: Uuid) -> Result<Option<MediaRequest>, DbError> {
        Ok(self
            .fetch(
                &format!("SELECT {COLS} FROM media_requests WHERE id = ?"),
                &[Some(id.to_string())],
            )
            .await?
            .into_iter()
            .next())
    }

    async fn find_by_title_key(&self, title_key: &str) -> Result<Option<MediaRequest>, DbError> {
        Ok(self
            .fetch(
                &format!("SELECT {COLS} FROM media_requests WHERE title_key = ?"),
                &[Some(title_key.to_string())],
            )
            .await?
            .into_iter()
            .next())
    }

    async fn find_match(
        &self,
        kind: DiscoveryKind,
        tmdb_id: Option<i64>,
        tvdb_id: Option<i64>,
        imdb_id: Option<&str>,
    ) -> Result<Option<MediaRequest>, DbError> {
        // Few rows (one per requested title): filter the kind in SQL, the id
        // overlap in Rust, which keeps the query backend-neutral.
        let rows = self
            .fetch(
                &format!(
                    "SELECT {COLS} FROM media_requests WHERE kind = ? ORDER BY created_at, id"
                ),
                &[Some(kind.as_str().to_string())],
            )
            .await?;
        Ok(rows.into_iter().find(|r| {
            (tmdb_id.is_some() && r.tmdb_id == tmdb_id)
                || (tvdb_id.is_some() && r.tvdb_id == tvdb_id)
                || imdb_id.is_some_and(|i| {
                    r.imdb_id
                        .as_deref()
                        .is_some_and(|x| x.eq_ignore_ascii_case(i))
                })
        }))
    }

    async fn find_by_external(
        &self,
        kind: IntegrationKind,
        external_id: &str,
    ) -> Result<Option<MediaRequest>, DbError> {
        let col = match kind {
            IntegrationKind::Ombi => "ombi_request_id",
            IntegrationKind::Seerr => "seerr_request_id",
        };
        Ok(self
            .fetch(
                &format!("SELECT {COLS} FROM media_requests WHERE {col} = ?"),
                &[Some(external_id.to_string())],
            )
            .await?
            .into_iter()
            .next())
    }

    async fn upsert(&self, r: &MediaRequest) -> Result<(), DbError> {
        let text = self.q(&format!(
            "INSERT INTO media_requests ({COLS}) VALUES \
             (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT (id) DO UPDATE SET title_key = excluded.title_key, kind = excluded.kind, \
             title = excluded.title, year = excluded.year, tmdb_id = excluded.tmdb_id, \
             tvdb_id = excluded.tvdb_id, imdb_id = excluded.imdb_id, poster_url = excluded.poster_url, \
             seasons = excluded.seasons, requester_user_id = excluded.requester_user_id, \
             requester_label = excluded.requester_label, status = excluded.status, \
             origin = excluded.origin, ombi_request_id = excluded.ombi_request_id, \
             seerr_request_id = excluded.seerr_request_id, \
             direct_instance_id = excluded.direct_instance_id, status_note = excluded.status_note, \
             updated_at = excluded.updated_at"
        ));
        sqlx::query(&text)
            .bind(r.id.to_string())
            .bind(&r.title_key)
            .bind(r.kind.as_str())
            .bind(&r.title)
            .bind(r.year)
            .bind(r.tmdb_id)
            .bind(r.tvdb_id)
            .bind(r.imdb_id.clone())
            .bind(r.poster_url.clone())
            .bind(serde_json::to_string(&r.seasons)?)
            .bind(r.requester_user_id.map(|u| u.to_string()))
            .bind(r.requester_label.clone())
            .bind(r.status.as_str())
            .bind(r.origin.as_str())
            .bind(r.ombi_request_id.clone())
            .bind(r.seerr_request_id.clone())
            .bind(r.direct_instance_id.map(|u| u.to_string()))
            .bind(r.status_note.clone())
            .bind(format_datetime(r.created_at))
            .bind(format_datetime(r.updated_at))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> Result<bool, DbError> {
        let done = sqlx::query(&self.q("DELETE FROM media_requests WHERE id = ?"))
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(done.rows_affected() > 0)
    }
}

pub struct SqlxRequestIntegrationRepo {
    pool: DbPool,
}

impl SqlxRequestIntegrationRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    fn q(&self, text: &str) -> String {
        text.to_string()
    }
}

const ICOLS: &str = "id, kind, name, base_url, api_key, api_key_env, enabled, poll_interval_secs, \
    mapping, user_map, webhook_secret, last_sync_at, last_error";

fn integration_from_row(row: &AnyRow) -> Result<RequestIntegration, DbError> {
    let id: String = row.try_get("id")?;
    let kind: String = row.try_get("kind")?;
    let enabled: i64 = row.try_get("enabled")?;
    let poll: i64 = row.try_get("poll_interval_secs")?;
    let mapping: String = row.try_get("mapping")?;
    let user_map: String = row.try_get("user_map")?;
    let key: String = row.try_get("api_key")?;
    let secret: String = row.try_get("webhook_secret")?;
    let last: Option<String> = row.try_get("last_sync_at")?;
    Ok(RequestIntegration {
        id: parse_uuid(&id)?,
        kind: IntegrationKind::parse(&kind)
            .ok_or_else(|| decode_err(format!("unknown integration kind {kind}")))?,
        name: row.try_get("name")?,
        base_url: row.try_get("base_url")?,
        api_key: Sensitive::new(key),
        api_key_env: row.try_get("api_key_env")?,
        enabled: bool_from_i64(enabled),
        poll_interval_secs: poll.max(0) as u32,
        mapping: UserMappingStrategy::parse(&mapping)
            .ok_or_else(|| decode_err(format!("unknown mapping {mapping}")))?,
        user_map: serde_json::from_str::<BTreeMap<String, String>>(&user_map)?,
        webhook_secret: Sensitive::new(secret),
        last_sync_at: last.as_deref().map(parse_datetime).transpose()?,
        last_error: row.try_get("last_error")?,
    })
}

#[async_trait]
impl RequestIntegrationRepo for SqlxRequestIntegrationRepo {
    async fn list(&self) -> Result<Vec<RequestIntegration>, DbError> {
        let text = format!("SELECT {ICOLS} FROM request_integrations ORDER BY name, id");
        let rows = sqlx::query(&text).fetch_all(&self.pool).await?;
        rows.iter().map(integration_from_row).collect()
    }

    async fn get(&self, id: Uuid) -> Result<Option<RequestIntegration>, DbError> {
        let text = self.q(&format!(
            "SELECT {ICOLS} FROM request_integrations WHERE id = ?"
        ));
        let row = sqlx::query(&text)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(integration_from_row).transpose()
    }

    async fn upsert(&self, i: &RequestIntegration) -> Result<(), DbError> {
        let text = self.q(&format!(
            "INSERT INTO request_integrations ({ICOLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, name = excluded.name, \
             base_url = excluded.base_url, api_key = excluded.api_key, \
             api_key_env = excluded.api_key_env, enabled = excluded.enabled, \
             poll_interval_secs = excluded.poll_interval_secs, mapping = excluded.mapping, \
             user_map = excluded.user_map, webhook_secret = excluded.webhook_secret"
        ));
        sqlx::query(&text)
            .bind(i.id.to_string())
            .bind(i.kind.as_str())
            .bind(&i.name)
            .bind(&i.base_url)
            .bind(i.api_key.expose_secret().clone())
            .bind(i.api_key_env.clone())
            .bind(bool_to_i64(i.enabled))
            .bind(i64::from(i.poll_interval_secs))
            .bind(i.mapping.as_str())
            .bind(serde_json::to_string(&i.user_map)?)
            .bind(i.webhook_secret.expose_secret().clone())
            .bind(i.last_sync_at.map(format_datetime))
            .bind(i.last_error.clone())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> Result<bool, DbError> {
        let done = sqlx::query(&self.q("DELETE FROM request_integrations WHERE id = ?"))
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(done.rows_affected() > 0)
    }

    async fn record_sync(
        &self,
        id: Uuid,
        at: DateTime<Utc>,
        error: Option<&str>,
    ) -> Result<(), DbError> {
        sqlx::query(
            &self
                .q("UPDATE request_integrations SET last_sync_at = ?, last_error = ? WHERE id = ?"),
        )
        .bind(format_datetime(at))
        .bind(error.map(str::to_string))
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn get_setting(&self, key: &str) -> Result<Option<String>, DbError> {
        let row = sqlx::query(&self.q("SELECT value FROM request_settings WHERE key = ?"))
            .bind(key.to_string())
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|r| r.get("value")))
    }

    async fn set_setting(&self, key: &str, value: &str) -> Result<(), DbError> {
        sqlx::query(
            &self.q("INSERT INTO request_settings (key, value) VALUES (?, ?) \
             ON CONFLICT (key) DO UPDATE SET value = excluded.value"),
        )
        .bind(key.to_string())
        .bind(value.to_string())
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pool::test_sqlite_pool;

    fn sample(key: &str, tmdb: Option<i64>) -> MediaRequest {
        let now = Utc::now();
        MediaRequest {
            id: Uuid::new_v4(),
            title_key: key.into(),
            kind: DiscoveryKind::Movie,
            title: "A Sample Person".into(),
            year: Some(2023),
            tmdb_id: tmdb,
            tvdb_id: None,
            imdb_id: Some("tt14153080".into()),
            poster_url: None,
            seasons: vec![],
            requester_user_id: Some(Uuid::new_v4()),
            requester_label: Some("finlay".into()),
            status: RequestStatus::Pending,
            origin: RequestOrigin::Ombi,
            ombi_request_id: Some("7".into()),
            seerr_request_id: None,
            direct_instance_id: None,
            status_note: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn requests_round_trip_and_match_by_any_id() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxMediaRequestRepo::new(pool);
        let mut r = sample("tmdb:movie:800787", Some(800787));
        repo.upsert(&r).await.unwrap();
        assert_eq!(repo.list().await.unwrap().len(), 1);
        let by_user = repo
            .list_for_user(r.requester_user_id.unwrap())
            .await
            .unwrap();
        assert_eq!(by_user[0].id, r.id);
        assert!(repo
            .find_by_external(IntegrationKind::Ombi, "7")
            .await
            .unwrap()
            .is_some());
        assert!(repo
            .find_by_external(IntegrationKind::Seerr, "7")
            .await
            .unwrap()
            .is_none());
        assert!(repo
            .find_match(DiscoveryKind::Movie, Some(800787), None, None)
            .await
            .unwrap()
            .is_some());
        assert!(repo
            .find_match(DiscoveryKind::Movie, None, None, Some("TT14153080"))
            .await
            .unwrap()
            .is_some());
        assert!(repo
            .find_match(DiscoveryKind::Series, Some(800787), None, None)
            .await
            .unwrap()
            .is_none());
        r.status = RequestStatus::Available;
        r.seasons = vec![1, 2];
        repo.upsert(&r).await.unwrap();
        let got = repo.get(r.id).await.unwrap().unwrap();
        assert_eq!(got.status, RequestStatus::Available);
        assert_eq!(got.seasons, vec![1, 2]);
        assert!(repo.delete(r.id).await.unwrap());
        assert!(!repo.delete(r.id).await.unwrap());
    }

    #[tokio::test]
    async fn integrations_and_settings_round_trip() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxRequestIntegrationRepo::new(pool);
        let mut map = BTreeMap::new();
        map.insert("u1".to_string(), "e1".to_string());
        let i = RequestIntegration {
            id: Uuid::new_v4(),
            kind: IntegrationKind::Seerr,
            name: "Seerr".into(),
            base_url: "http://seerr:5055".into(),
            api_key: Sensitive::new("k".into()),
            api_key_env: Some("SEERR_KEY".into()),
            enabled: true,
            poll_interval_secs: 120,
            mapping: UserMappingStrategy::Map,
            user_map: map,
            webhook_secret: Sensitive::new("s".into()),
            last_sync_at: None,
            last_error: None,
        };
        repo.upsert(&i).await.unwrap();
        let got = repo.get(i.id).await.unwrap().unwrap();
        assert_eq!(got.kind, IntegrationKind::Seerr);
        assert_eq!(got.user_map.get("u1").map(String::as_str), Some("e1"));
        assert_eq!(got.api_key_env.as_deref(), Some("SEERR_KEY"));
        repo.record_sync(i.id, Utc::now(), Some("boom"))
            .await
            .unwrap();
        let got = repo.get(i.id).await.unwrap().unwrap();
        assert_eq!(got.last_error.as_deref(), Some("boom"));
        assert!(got.last_sync_at.is_some());
        assert_eq!(repo.get_setting("backend").await.unwrap(), None);
        repo.set_setting("backend", "ombi").await.unwrap();
        repo.set_setting("backend", "direct").await.unwrap();
        assert_eq!(
            repo.get_setting("backend").await.unwrap().as_deref(),
            Some("direct")
        );
        assert!(repo.delete(i.id).await.unwrap());
    }
}
