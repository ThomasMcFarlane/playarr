use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::any::AnyRow;
use sqlx::Row;
use streamarr_model::{UserInvite, UserInviteRequest, UserInviteRequestStatus};
use uuid::Uuid;

use crate::codec::{decode_err, format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

fn status_to_str(status: UserInviteRequestStatus) -> &'static str {
    match status {
        UserInviteRequestStatus::Pending => "pending",
        UserInviteRequestStatus::Approved => "approved",
        UserInviteRequestStatus::Denied => "denied",
        UserInviteRequestStatus::Generated => "generated",
    }
}

fn status_from_str(value: &str) -> Result<UserInviteRequestStatus, DbError> {
    match value {
        "pending" => Ok(UserInviteRequestStatus::Pending),
        "approved" => Ok(UserInviteRequestStatus::Approved),
        "denied" => Ok(UserInviteRequestStatus::Denied),
        "generated" => Ok(UserInviteRequestStatus::Generated),
        _ => Err(decode_err(format!(
            "unknown invite request status {value:?}"
        ))),
    }
}

fn from_row(row: &AnyRow) -> Result<UserInviteRequest, DbError> {
    let id: String = row.try_get("id")?;
    let user_id: String = row.try_get("user_id")?;
    let status: String = row.try_get("status")?;
    let requested_at: String = row.try_get("requested_at")?;
    let reviewed_by: Option<String> = row.try_get("reviewed_by")?;
    let reviewed_at: Option<String> = row.try_get("reviewed_at")?;
    let generated_at: Option<String> = row.try_get("generated_at")?;
    Ok(UserInviteRequest {
        id: parse_uuid(&id)?,
        user_id: parse_uuid(&user_id)?,
        status: status_from_str(&status)?,
        requested_at: parse_datetime(&requested_at)?,
        reviewed_by: reviewed_by.map(|value| parse_uuid(&value)).transpose()?,
        reviewed_at: reviewed_at
            .map(|value| parse_datetime(&value))
            .transpose()?,
        generated_at: generated_at
            .map(|value| parse_datetime(&value))
            .transpose()?,
    })
}

const COLUMNS: &str = "id, user_id, status, requested_at, reviewed_by, reviewed_at, generated_at";

#[async_trait]
pub trait UserInviteRequestRepo: Send + Sync {
    async fn create(&self, request: &UserInviteRequest) -> Result<(), DbError>;
    async fn find_by_id(&self, id: Uuid) -> Result<Option<UserInviteRequest>, DbError>;
    async fn find_latest_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Option<UserInviteRequest>, DbError>;
    async fn list_all(&self) -> Result<Vec<UserInviteRequest>, DbError>;
    async fn review(
        &self,
        id: Uuid,
        reviewer_id: Uuid,
        status: UserInviteRequestStatus,
        reviewed_at: DateTime<Utc>,
    ) -> Result<bool, DbError>;
    /// Atomically consumes an approved request and persists its final bearer
    /// invitation, so concurrent Generate clicks cannot mint two QR codes.
    async fn generate_invite(
        &self,
        id: Uuid,
        user_id: Uuid,
        generated_at: DateTime<Utc>,
        invite: &UserInvite,
    ) -> Result<bool, DbError>;
}

pub struct SqlxUserInviteRequestRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxUserInviteRequestRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }
}

#[async_trait]
impl UserInviteRequestRepo for SqlxUserInviteRequestRepo {
    async fn create(&self, request: &UserInviteRequest) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                format!("INSERT INTO user_invite_requests ({COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)")
            }
            Backend::Postgres => format!(
                "INSERT INTO user_invite_requests ({COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7)"
            ),
        };
        sqlx::query(&sql)
            .bind(request.id.to_string())
            .bind(request.user_id.to_string())
            .bind(status_to_str(request.status))
            .bind(format_datetime(request.requested_at))
            .bind(request.reviewed_by.map(|id| id.to_string()))
            .bind(request.reviewed_at.map(format_datetime))
            .bind(request.generated_at.map(format_datetime))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn find_by_id(&self, id: Uuid) -> Result<Option<UserInviteRequest>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!("SELECT {COLUMNS} FROM user_invite_requests WHERE id = ?"),
            Backend::Postgres => {
                format!("SELECT {COLUMNS} FROM user_invite_requests WHERE id = $1")
            }
        };
        let row = sqlx::query(&sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(from_row).transpose()
    }

    async fn find_latest_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Option<UserInviteRequest>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {COLUMNS} FROM user_invite_requests WHERE user_id = ? ORDER BY requested_at DESC LIMIT 1"
            ),
            Backend::Postgres => format!(
                "SELECT {COLUMNS} FROM user_invite_requests WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 1"
            ),
        };
        let row = sqlx::query(&sql)
            .bind(user_id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(from_row).transpose()
    }

    async fn list_all(&self) -> Result<Vec<UserInviteRequest>, DbError> {
        let sql = format!("SELECT {COLUMNS} FROM user_invite_requests ORDER BY requested_at DESC");
        let rows = sqlx::query(&sql).fetch_all(&self.pool).await?;
        rows.iter().map(from_row).collect()
    }

    async fn review(
        &self,
        id: Uuid,
        reviewer_id: Uuid,
        status: UserInviteRequestStatus,
        reviewed_at: DateTime<Utc>,
    ) -> Result<bool, DbError> {
        debug_assert!(matches!(
            status,
            UserInviteRequestStatus::Approved | UserInviteRequestStatus::Denied
        ));
        let sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE user_invite_requests SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'"
            }
            Backend::Postgres => {
                "UPDATE user_invite_requests SET status = $1, reviewed_by = $2, reviewed_at = $3 WHERE id = $4 AND status = 'pending'"
            }
        };
        let result = sqlx::query(sql)
            .bind(status_to_str(status))
            .bind(reviewer_id.to_string())
            .bind(format_datetime(reviewed_at))
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn generate_invite(
        &self,
        id: Uuid,
        user_id: Uuid,
        generated_at: DateTime<Utc>,
        invite: &UserInvite,
    ) -> Result<bool, DbError> {
        let mut transaction = self.pool.begin().await?;
        let update_sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE user_invite_requests SET status = 'generated', generated_at = ? WHERE id = ? AND user_id = ? AND status = 'approved'"
            }
            Backend::Postgres => {
                "UPDATE user_invite_requests SET status = 'generated', generated_at = $1 WHERE id = $2 AND user_id = $3 AND status = 'approved'"
            }
        };
        let result = sqlx::query(update_sql)
            .bind(format_datetime(generated_at))
            .bind(id.to_string())
            .bind(user_id.to_string())
            .execute(&mut *transaction)
            .await?;
        if result.rows_affected() != 1 {
            transaction.rollback().await?;
            return Ok(false);
        }

        let insert_sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO user_invites (token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)"
            }
            Backend::Postgres => {
                "INSERT INTO user_invites (token_hash, created_by, created_at, expires_at) VALUES ($1, $2, $3, $4)"
            }
        };
        sqlx::query(insert_sql)
            .bind(&invite.token_hash)
            .bind(invite.created_by.to_string())
            .bind(format_datetime(invite.created_at))
            .bind(format_datetime(invite.expires_at))
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(true)
    }
}
