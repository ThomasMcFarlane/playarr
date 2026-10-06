use async_trait::async_trait;
use playarr_model::{ClientPlatform, PushRegistration};
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{decode_err, format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::DbPool;

#[async_trait]
pub trait PushRegistrationRepo: Send + Sync {
    async fn upsert(&self, registration: &PushRegistration) -> Result<(), DbError>;
    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<PushRegistration>, DbError>;
    async fn delete(&self, token: &str) -> Result<(), DbError>;
}

pub struct SqlxPushRegistrationRepo {
    pool: DbPool,
}

impl SqlxPushRegistrationRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }
}

fn parse_platform(value: &str) -> Result<ClientPlatform, DbError> {
    ClientPlatform::from_wire_name(value)
        .ok_or_else(|| decode_err(format!("unknown push platform {value:?}")))
}

#[async_trait]
impl PushRegistrationRepo for SqlxPushRegistrationRepo {
    async fn upsert(&self, registration: &PushRegistration) -> Result<(), DbError> {
        let sql = "INSERT INTO push_registrations (token, user_id, platform, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, updated_at = excluded.updated_at";
        sqlx::query(sql)
            .bind(&registration.token)
            .bind(registration.user_id.to_string())
            .bind(registration.platform.wire_name())
            .bind(format_datetime(registration.updated_at))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<PushRegistration>, DbError> {
        let sql =
            "SELECT token, user_id, platform, updated_at FROM push_registrations WHERE user_id = ?";
        let rows = sqlx::query(sql)
            .bind(user_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter()
            .map(|row| {
                let token: String = row.try_get("token")?;
                let user_id: String = row.try_get("user_id")?;
                let platform: String = row.try_get("platform")?;
                let updated_at: String = row.try_get("updated_at")?;
                Ok(PushRegistration {
                    token,
                    user_id: parse_uuid(&user_id)?,
                    platform: parse_platform(&platform)?,
                    updated_at: parse_datetime(&updated_at)?,
                })
            })
            .collect()
    }

    async fn delete(&self, token: &str) -> Result<(), DbError> {
        let sql = "DELETE FROM push_registrations WHERE token = ?";
        sqlx::query(sql).bind(token).execute(&self.pool).await?;
        Ok(())
    }
}
