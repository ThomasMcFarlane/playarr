use std::path::PathBuf;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::any::AnyRow;
use sqlx::Row;
use playarr_model::{DownloadStatus, DownloadTicket};
use uuid::Uuid;

use crate::codec::{
    download_status_from_str, download_status_to_str, format_datetime, parse_datetime, parse_uuid,
};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

#[async_trait]
pub trait DownloadTicketRepo: Send + Sync {
    async fn get(&self, id: Uuid) -> Result<Option<DownloadTicket>, DbError>;

    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<DownloadTicket>, DbError>;

    /// Most recent still-usable (`Queued`/`Processing`/`Ready`) ticket for
    /// this exact `(user_id, media_file_id, quality_id)` triple, if any --
    /// lets the create handler stay idempotent instead of piling up
    /// duplicate tickets for repeated requests of the same quality.
    async fn find_active(
        &self,
        user_id: Uuid,
        media_file_id: Uuid,
        quality_id: &str,
    ) -> Result<Option<DownloadTicket>, DbError>;

    async fn insert(&self, ticket: &DownloadTicket) -> Result<(), DbError>;

    async fn mark_status(
        &self,
        id: Uuid,
        status: DownloadStatus,
        error_message: Option<&str>,
    ) -> Result<(), DbError>;

    async fn mark_ready(
        &self,
        id: Uuid,
        output_path: Option<&std::path::Path>,
        size_bytes: Option<u64>,
        ready_at: DateTime<Utc>,
        expires_at: Option<DateTime<Utc>>,
    ) -> Result<(), DbError>;

    async fn delete(&self, id: Uuid) -> Result<(), DbError>;

    /// Every non-terminal-already ticket (i.e. not already `Expired`/
    /// `Canceled`) whose `expires_at` has passed `now` -- the sweep query a
    /// future retention job runs. Not called anywhere yet in this pass; the
    /// method exists so that job has a real, tested query to call rather
    /// than inventing one later.
    async fn list_expired(&self, now: DateTime<Utc>) -> Result<Vec<DownloadTicket>, DbError>;
}

pub struct SqlxDownloadTicketRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxDownloadTicketRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn from_row(row: &AnyRow) -> Result<DownloadTicket, DbError> {
        let id: String = row.try_get("id")?;
        let user_id: String = row.try_get("user_id")?;
        let media_file_id: String = row.try_get("media_file_id")?;
        let quality_id: String = row.try_get("quality_id")?;
        let profile: Option<String> = row.try_get("profile")?;
        let container: String = row.try_get("container")?;
        let status: String = row.try_get("status")?;
        let output_path: Option<String> = row.try_get("output_path")?;
        let size_bytes: Option<i64> = row.try_get("size_bytes")?;
        let error_message: Option<String> = row.try_get("error_message")?;
        let requested_at: String = row.try_get("requested_at")?;
        let ready_at: Option<String> = row.try_get("ready_at")?;
        let expires_at: Option<String> = row.try_get("expires_at")?;

        Ok(DownloadTicket {
            id: parse_uuid(&id)?,
            user_id: parse_uuid(&user_id)?,
            media_file_id: parse_uuid(&media_file_id)?,
            quality_id,
            profile,
            container,
            status: download_status_from_str(&status)?,
            output_path: output_path.map(PathBuf::from),
            size_bytes: size_bytes.map(|value| value.max(0) as u64),
            error_message,
            requested_at: parse_datetime(&requested_at)?,
            ready_at: ready_at.as_deref().map(parse_datetime).transpose()?,
            expires_at: expires_at.as_deref().map(parse_datetime).transpose()?,
        })
    }
}

#[async_trait]
impl DownloadTicketRepo for SqlxDownloadTicketRepo {
    async fn get(&self, id: Uuid) -> Result<Option<DownloadTicket>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, user_id, media_file_id, quality_id, profile, container, status, \
                 output_path, size_bytes, error_message, requested_at, ready_at, expires_at \
                 FROM download_tickets WHERE id = ?"
            }
            Backend::Postgres => {
                "SELECT id, user_id, media_file_id, quality_id, profile, container, status, \
                 output_path, size_bytes, error_message, requested_at, ready_at, expires_at \
                 FROM download_tickets WHERE id = $1"
            }
        };
        let row = sqlx::query(sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::from_row).transpose()
    }

    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<DownloadTicket>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, user_id, media_file_id, quality_id, profile, container, status, \
                 output_path, size_bytes, error_message, requested_at, ready_at, expires_at \
                 FROM download_tickets WHERE user_id = ? ORDER BY requested_at DESC"
            }
            Backend::Postgres => {
                "SELECT id, user_id, media_file_id, quality_id, profile, container, status, \
                 output_path, size_bytes, error_message, requested_at, ready_at, expires_at \
                 FROM download_tickets WHERE user_id = $1 ORDER BY requested_at DESC"
            }
        };
        let rows = sqlx::query(sql)
            .bind(user_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(Self::from_row).collect()
    }

    async fn find_active(
        &self,
        user_id: Uuid,
        media_file_id: Uuid,
        quality_id: &str,
    ) -> Result<Option<DownloadTicket>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, user_id, media_file_id, quality_id, profile, container, status, \
                 output_path, size_bytes, error_message, requested_at, ready_at, expires_at \
                 FROM download_tickets \
                 WHERE user_id = ? AND media_file_id = ? AND quality_id = ? \
                 AND status IN ('queued', 'processing', 'ready') \
                 ORDER BY requested_at DESC LIMIT 1"
            }
            Backend::Postgres => {
                "SELECT id, user_id, media_file_id, quality_id, profile, container, status, \
                 output_path, size_bytes, error_message, requested_at, ready_at, expires_at \
                 FROM download_tickets \
                 WHERE user_id = $1 AND media_file_id = $2 AND quality_id = $3 \
                 AND status IN ('queued', 'processing', 'ready') \
                 ORDER BY requested_at DESC LIMIT 1"
            }
        };
        let row = sqlx::query(sql)
            .bind(user_id.to_string())
            .bind(media_file_id.to_string())
            .bind(quality_id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::from_row).transpose()
    }

    async fn insert(&self, ticket: &DownloadTicket) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO download_tickets \
                 (id, user_id, media_file_id, quality_id, profile, container, status, \
                  output_path, size_bytes, error_message, requested_at, ready_at, expires_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            }
            Backend::Postgres => {
                "INSERT INTO download_tickets \
                 (id, user_id, media_file_id, quality_id, profile, container, status, \
                  output_path, size_bytes, error_message, requested_at, ready_at, expires_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)"
            }
        };
        sqlx::query(sql)
            .bind(ticket.id.to_string())
            .bind(ticket.user_id.to_string())
            .bind(ticket.media_file_id.to_string())
            .bind(ticket.quality_id.clone())
            .bind(ticket.profile.clone())
            .bind(ticket.container.clone())
            .bind(download_status_to_str(ticket.status))
            .bind(
                ticket
                    .output_path
                    .as_ref()
                    .map(|path| path.to_string_lossy().to_string()),
            )
            .bind(ticket.size_bytes.map(|value| value as i64))
            .bind(ticket.error_message.clone())
            .bind(format_datetime(ticket.requested_at))
            .bind(ticket.ready_at.map(format_datetime))
            .bind(ticket.expires_at.map(format_datetime))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn mark_status(
        &self,
        id: Uuid,
        status: DownloadStatus,
        error_message: Option<&str>,
    ) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE download_tickets SET status = ?, error_message = ? WHERE id = ?"
            }
            Backend::Postgres => {
                "UPDATE download_tickets SET status = $1, error_message = $2 WHERE id = $3"
            }
        };
        sqlx::query(sql)
            .bind(download_status_to_str(status))
            .bind(error_message.map(str::to_string))
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn mark_ready(
        &self,
        id: Uuid,
        output_path: Option<&std::path::Path>,
        size_bytes: Option<u64>,
        ready_at: DateTime<Utc>,
        expires_at: Option<DateTime<Utc>>,
    ) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE download_tickets SET status = ?, output_path = ?, size_bytes = ?, \
                 error_message = NULL, ready_at = ?, expires_at = ? WHERE id = ?"
            }
            Backend::Postgres => {
                "UPDATE download_tickets SET status = $1, output_path = $2, size_bytes = $3, \
                 error_message = NULL, ready_at = $4, expires_at = $5 WHERE id = $6"
            }
        };
        sqlx::query(sql)
            .bind(download_status_to_str(DownloadStatus::Ready))
            .bind(output_path.map(|path| path.to_string_lossy().to_string()))
            .bind(size_bytes.map(|value| value as i64))
            .bind(format_datetime(ready_at))
            .bind(expires_at.map(format_datetime))
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "DELETE FROM download_tickets WHERE id = ?",
            Backend::Postgres => "DELETE FROM download_tickets WHERE id = $1",
        };
        sqlx::query(sql)
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_expired(&self, now: DateTime<Utc>) -> Result<Vec<DownloadTicket>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, user_id, media_file_id, quality_id, profile, container, status, \
                 output_path, size_bytes, error_message, requested_at, ready_at, expires_at \
                 FROM download_tickets \
                 WHERE status NOT IN ('expired', 'canceled') \
                 AND expires_at IS NOT NULL AND expires_at <= ?"
            }
            Backend::Postgres => {
                "SELECT id, user_id, media_file_id, quality_id, profile, container, status, \
                 output_path, size_bytes, error_message, requested_at, ready_at, expires_at \
                 FROM download_tickets \
                 WHERE status NOT IN ('expired', 'canceled') \
                 AND expires_at IS NOT NULL AND expires_at <= $1"
            }
        };
        let rows = sqlx::query(sql)
            .bind(format_datetime(now))
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(Self::from_row).collect()
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, SubsecRound, Utc};

    use super::*;
    use crate::pool::test_sqlite_pool;

    /// `download_tickets.user_id`/`media_file_id` are real `REFERENCES`
    /// foreign keys (see `0030_download_tickets.sql`), and sqlx-sqlite
    /// enables `PRAGMA foreign_keys = ON` by default -- so every test needs
    /// real parent rows before it can insert a ticket pointing at them.
    /// Bypasses `UserRepo`/`MediaFileRepo`/`PolicyRepo`/`WorkRepo` (out of
    /// scope for this module) with minimal direct inserts, mirroring
    /// `media_file::tests::insert_work`'s own pattern.
    async fn seed_user(pool: &DbPool) -> Uuid {
        let policy_id = Uuid::new_v4();
        sqlx::query("INSERT INTO policies (id, name) VALUES (?, 'Test Policy')")
            .bind(policy_id.to_string())
            .execute(pool)
            .await
            .expect("insert parent policy row");

        let user_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO users (id, username, display_name, password_hash, policy_id, created_at) \
             VALUES (?, ?, 'Test User', 'fakehash', ?, '2024-01-01T00:00:00.000Z')",
        )
        .bind(user_id.to_string())
        .bind(format!("test-{user_id}"))
        .bind(policy_id.to_string())
        .execute(pool)
        .await
        .expect("insert parent user row");
        user_id
    }

    async fn seed_media_file(pool: &DbPool) -> Uuid {
        let work_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO works (id, kind, title, sort_title, added_at, availability) \
             VALUES (?, 'movie', 'Test Work', 'Test Work', '2024-01-01T00:00:00.000Z', 'available')",
        )
        .bind(work_id.to_string())
        .execute(pool)
        .await
        .expect("insert parent work row");

        let media_file_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO media_files \
             (id, work_id, leaf_ref, path, container, codec, bitrate, size_bytes, source_instance_id, source_file_id) \
             VALUES (?, ?, 'work', '/data/media/movie.mkv', 'mkv', 'h264', 8000000, 4000000000, ?, NULL)",
        )
        .bind(media_file_id.to_string())
        .bind(work_id.to_string())
        .bind(Uuid::new_v4().to_string())
        .execute(pool)
        .await
        .expect("insert parent media_file row");
        media_file_id
    }

    fn sample_ticket(user_id: Uuid, media_file_id: Uuid, status: DownloadStatus) -> DownloadTicket {
        DownloadTicket {
            id: Uuid::new_v4(),
            user_id,
            media_file_id,
            quality_id: "original".to_string(),
            profile: None,
            container: "mkv".to_string(),
            status,
            output_path: None,
            size_bytes: Some(4_000_000_000),
            error_message: None,
            // Storage round-trips through millisecond precision (see
            // `codec::format_datetime`); truncate here so the fixture
            // matches what `get()` hands back.
            requested_at: Utc::now().trunc_subsecs(3),
            ready_at: None,
            expires_at: None,
        }
    }

    #[tokio::test]
    async fn insert_then_get_round_trips() {
        let pool = test_sqlite_pool().await;
        let user_id = seed_user(&pool).await;
        let media_file_id = seed_media_file(&pool).await;
        let repo = SqlxDownloadTicketRepo::new(pool);
        let ticket = sample_ticket(user_id, media_file_id, DownloadStatus::Ready);

        repo.insert(&ticket).await.expect("insert");
        let fetched = repo.get(ticket.id).await.expect("get").expect("present");
        assert_eq!(fetched, ticket);
    }

    #[tokio::test]
    async fn get_missing_returns_none() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxDownloadTicketRepo::new(pool);
        assert!(repo.get(Uuid::new_v4()).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn list_for_user_orders_newest_first_and_excludes_other_users() {
        let pool = test_sqlite_pool().await;
        let user_id = seed_user(&pool).await;
        let other_user_id = seed_user(&pool).await;
        let older_media_file_id = seed_media_file(&pool).await;
        let newer_media_file_id = seed_media_file(&pool).await;
        let other_user_media_file_id = seed_media_file(&pool).await;
        let repo = SqlxDownloadTicketRepo::new(pool);

        let mut older = sample_ticket(user_id, older_media_file_id, DownloadStatus::Ready);
        older.requested_at = Utc::now().trunc_subsecs(3) - Duration::hours(1);
        let newer = sample_ticket(user_id, newer_media_file_id, DownloadStatus::Queued);
        let other_user = sample_ticket(
            other_user_id,
            other_user_media_file_id,
            DownloadStatus::Ready,
        );

        for ticket in [&older, &newer, &other_user] {
            repo.insert(ticket).await.unwrap();
        }

        let tickets = repo.list_for_user(user_id).await.unwrap();
        assert_eq!(tickets.len(), 2);
        assert_eq!(tickets[0].id, newer.id);
        assert_eq!(tickets[1].id, older.id);
    }

    #[tokio::test]
    async fn find_active_only_matches_the_exact_triple_and_active_statuses() {
        let pool = test_sqlite_pool().await;
        let user_id = seed_user(&pool).await;
        let other_user_id = seed_user(&pool).await;
        let media_file_id = seed_media_file(&pool).await;
        let repo = SqlxDownloadTicketRepo::new(pool);

        let canceled = sample_ticket(user_id, media_file_id, DownloadStatus::Canceled);
        repo.insert(&canceled).await.unwrap();
        assert!(repo
            .find_active(user_id, media_file_id, "original")
            .await
            .unwrap()
            .is_none());

        let queued = sample_ticket(user_id, media_file_id, DownloadStatus::Queued);
        repo.insert(&queued).await.unwrap();
        let found = repo
            .find_active(user_id, media_file_id, "original")
            .await
            .unwrap();
        assert_eq!(found.map(|t| t.id), Some(queued.id));

        assert!(repo
            .find_active(user_id, media_file_id, "h264-1080p-8mbps")
            .await
            .unwrap()
            .is_none());
        assert!(repo
            .find_active(other_user_id, media_file_id, "original")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn mark_status_updates_status_and_error_message() {
        let pool = test_sqlite_pool().await;
        let user_id = seed_user(&pool).await;
        let media_file_id = seed_media_file(&pool).await;
        let repo = SqlxDownloadTicketRepo::new(pool);
        let ticket = sample_ticket(user_id, media_file_id, DownloadStatus::Queued);
        repo.insert(&ticket).await.unwrap();

        repo.mark_status(ticket.id, DownloadStatus::Failed, Some("ffmpeg exited 1"))
            .await
            .unwrap();

        let fetched = repo.get(ticket.id).await.unwrap().unwrap();
        assert_eq!(fetched.status, DownloadStatus::Failed);
        assert_eq!(fetched.error_message.as_deref(), Some("ffmpeg exited 1"));
    }

    #[tokio::test]
    async fn mark_ready_sets_output_and_clears_any_prior_error() {
        let pool = test_sqlite_pool().await;
        let user_id = seed_user(&pool).await;
        let media_file_id = seed_media_file(&pool).await;
        let repo = SqlxDownloadTicketRepo::new(pool);
        let mut ticket = sample_ticket(user_id, media_file_id, DownloadStatus::Queued);
        ticket.error_message = Some("transient failure".to_string());
        repo.insert(&ticket).await.unwrap();

        let ready_at = Utc::now().trunc_subsecs(3);
        let expires_at = ready_at + Duration::days(7);
        repo.mark_ready(
            ticket.id,
            Some(std::path::Path::new("/data/downloads/out.mp4")),
            Some(123_456),
            ready_at,
            Some(expires_at),
        )
        .await
        .unwrap();

        let fetched = repo.get(ticket.id).await.unwrap().unwrap();
        assert_eq!(fetched.status, DownloadStatus::Ready);
        assert_eq!(
            fetched.output_path,
            Some(PathBuf::from("/data/downloads/out.mp4"))
        );
        assert_eq!(fetched.size_bytes, Some(123_456));
        assert_eq!(fetched.ready_at, Some(ready_at));
        assert_eq!(fetched.expires_at, Some(expires_at));
        assert_eq!(fetched.error_message, None);
    }

    #[tokio::test]
    async fn delete_removes_row() {
        let pool = test_sqlite_pool().await;
        let user_id = seed_user(&pool).await;
        let media_file_id = seed_media_file(&pool).await;
        let repo = SqlxDownloadTicketRepo::new(pool);
        let ticket = sample_ticket(user_id, media_file_id, DownloadStatus::Ready);
        repo.insert(&ticket).await.unwrap();

        repo.delete(ticket.id).await.unwrap();
        assert!(repo.get(ticket.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn list_expired_only_returns_past_non_terminal_tickets() {
        let pool = test_sqlite_pool().await;
        let user_id = seed_user(&pool).await;
        let media_file_id_1 = seed_media_file(&pool).await;
        let media_file_id_2 = seed_media_file(&pool).await;
        let media_file_id_3 = seed_media_file(&pool).await;
        let media_file_id_4 = seed_media_file(&pool).await;
        let repo = SqlxDownloadTicketRepo::new(pool);
        let now = Utc::now().trunc_subsecs(3);

        let mut expired_ready = sample_ticket(user_id, media_file_id_1, DownloadStatus::Ready);
        expired_ready.expires_at = Some(now - Duration::hours(1));
        let mut not_yet_expired = sample_ticket(user_id, media_file_id_2, DownloadStatus::Ready);
        not_yet_expired.expires_at = Some(now + Duration::hours(1));
        let mut already_expired_status =
            sample_ticket(user_id, media_file_id_3, DownloadStatus::Expired);
        already_expired_status.expires_at = Some(now - Duration::hours(1));
        let no_expiry = sample_ticket(user_id, media_file_id_4, DownloadStatus::Ready);

        for ticket in [
            &expired_ready,
            &not_yet_expired,
            &already_expired_status,
            &no_expiry,
        ] {
            repo.insert(ticket).await.unwrap();
        }

        let expired = repo.list_expired(now).await.unwrap();
        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].id, expired_ready.id);
    }
}
