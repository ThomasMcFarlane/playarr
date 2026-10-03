//! Persistence for household controls: per-day usage, guardian approvals and
//! PIN-attempt lockout state (`docs/architecture/household-controls.md`).

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use playarr_model::{Approval, ApprovalKind, ApprovalStatus};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// Watch seconds served per profile per local day.
#[async_trait]
pub trait HouseholdUsageRepo: Send + Sync {
    async fn seconds_for_day(&self, user_id: Uuid, day: &str) -> Result<i64, DbError>;
    async fn add_seconds(&self, user_id: Uuid, day: &str, seconds: i64) -> Result<(), DbError>;
}

/// Guardian approval requests and grants.
#[async_trait]
pub trait ApprovalRepo: Send + Sync {
    async fn insert(&self, approval: &Approval) -> Result<(), DbError>;
    async fn get(&self, id: Uuid) -> Result<Option<Approval>, DbError>;
    /// Newest first.
    async fn list_for_profiles(
        &self,
        profile_user_ids: &[Uuid],
        limit: i64,
    ) -> Result<Vec<Approval>, DbError>;
    /// Atomically moves a still-pending, unexpired request to `status`.
    /// Returns whether a row changed (false = not pending, expired or
    /// unknown), so two concurrent decisions cannot both win.
    #[allow(clippy::too_many_arguments)]
    async fn decide(
        &self,
        id: Uuid,
        status: ApprovalStatus,
        decided_by: Uuid,
        now: DateTime<Utc>,
        grant_expires_at: Option<DateTime<Utc>>,
        max_uses: Option<u32>,
        bonus_seconds: i64,
    ) -> Result<bool, DbError>;
    /// Atomically uses one grant of `id` for `profile_user_id`. False when
    /// the approval is not approved, belongs to another profile, is expired
    /// or has no uses left.
    async fn consume(
        &self,
        id: Uuid,
        profile_user_id: Uuid,
        now: DateTime<Utc>,
    ) -> Result<bool, DbError>;
    /// Approved, unexpired, not-exhausted grants of `kind` for a profile.
    async fn active_grants(
        &self,
        profile_user_id: Uuid,
        kind: ApprovalKind,
        now: DateTime<Utc>,
    ) -> Result<Vec<Approval>, DbError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PinAttemptState {
    pub failures: u32,
    pub locked_until: Option<DateTime<Utc>>,
}

/// Failed PIN attempt counters. `caller_user_id` is [`Uuid::nil`] for the
/// per-target aggregate row.
#[async_trait]
pub trait PinAttemptRepo: Send + Sync {
    async fn find(&self, caller: Uuid, target: Uuid) -> Result<Option<PinAttemptState>, DbError>;
    /// Increments the counter and stores `locked_until` computed by
    /// `lock_after`, which receives the new failure count. Returns the new
    /// state.
    async fn record_failure(
        &self,
        caller: Uuid,
        target: Uuid,
        now: DateTime<Utc>,
        locked_until: &(dyn Fn(u32) -> Option<DateTime<Utc>> + Sync),
    ) -> Result<PinAttemptState, DbError>;
    async fn reset(&self, caller: Uuid, target: Uuid) -> Result<(), DbError>;
}

pub struct SqlxHouseholdRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxHouseholdRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn q(&self, sqlite: &'static str, postgres: &'static str) -> &'static str {
        match self.backend {
            Backend::Sqlite => sqlite,
            Backend::Postgres => postgres,
        }
    }
}

const APPROVAL_COLUMNS: &str = "id, profile_user_id, kind, subject, note, status, requested_at, \
     request_expires_at, decided_by, decided_at, grant_expires_at, max_uses, uses, bonus_seconds";

fn approval_from_row(row: &AnyRow) -> Result<Approval, DbError> {
    let kind: String = row.try_get("kind")?;
    let status: String = row.try_get("status")?;
    let decided_by: Option<String> = row.try_get("decided_by")?;
    let decided_at: Option<String> = row.try_get("decided_at")?;
    let grant_expires_at: Option<String> = row.try_get("grant_expires_at")?;
    let max_uses: Option<i64> = row.try_get("max_uses")?;
    let uses: i64 = row.try_get("uses")?;
    let id: String = row.try_get("id")?;
    let profile: String = row.try_get("profile_user_id")?;
    let requested_at: String = row.try_get("requested_at")?;
    let request_expires_at: String = row.try_get("request_expires_at")?;
    Ok(Approval {
        id: parse_uuid(&id)?,
        profile_user_id: parse_uuid(&profile)?,
        kind: ApprovalKind::parse(&kind)
            .ok_or_else(|| DbError::Conflict(format!("unknown approval kind {kind:?}")))?,
        subject: row.try_get("subject")?,
        note: row.try_get("note")?,
        status: ApprovalStatus::parse(&status)
            .ok_or_else(|| DbError::Conflict(format!("unknown approval status {status:?}")))?,
        requested_at: parse_datetime(&requested_at)?,
        request_expires_at: parse_datetime(&request_expires_at)?,
        decided_by: decided_by.as_deref().map(parse_uuid).transpose()?,
        decided_at: decided_at.as_deref().map(parse_datetime).transpose()?,
        grant_expires_at: grant_expires_at
            .as_deref()
            .map(parse_datetime)
            .transpose()?,
        max_uses: max_uses.map(|n| n as u32),
        uses: uses as u32,
        bonus_seconds: row.try_get("bonus_seconds")?,
    })
}

#[async_trait]
impl HouseholdUsageRepo for SqlxHouseholdRepo {
    async fn seconds_for_day(&self, user_id: Uuid, day: &str) -> Result<i64, DbError> {
        let sql = self.q(
            "SELECT seconds FROM household_usage WHERE user_id = ? AND day = ?",
            "SELECT seconds FROM household_usage WHERE user_id = $1 AND day = $2",
        );
        let row = sqlx::query(sql)
            .bind(user_id.to_string())
            .bind(day)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|r| r.try_get("seconds")).transpose()?.unwrap_or(0))
    }

    async fn add_seconds(&self, user_id: Uuid, day: &str, seconds: i64) -> Result<(), DbError> {
        let sql = self.q(
            "INSERT INTO household_usage (user_id, day, seconds, updated_at) VALUES (?, ?, ?, ?) \
             ON CONFLICT (user_id, day) DO UPDATE SET \
             seconds = household_usage.seconds + excluded.seconds, updated_at = excluded.updated_at",
            "INSERT INTO household_usage (user_id, day, seconds, updated_at) VALUES ($1, $2, $3, $4) \
             ON CONFLICT (user_id, day) DO UPDATE SET \
             seconds = household_usage.seconds + excluded.seconds, updated_at = excluded.updated_at",
        );
        sqlx::query(sql)
            .bind(user_id.to_string())
            .bind(day)
            .bind(seconds)
            .bind(format_datetime(Utc::now()))
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[async_trait]
impl ApprovalRepo for SqlxHouseholdRepo {
    async fn insert(&self, a: &Approval) -> Result<(), DbError> {
        let sql = self.q(
            "INSERT INTO household_approvals (id, profile_user_id, kind, subject, note, status, \
             requested_at, request_expires_at, decided_by, decided_at, grant_expires_at, \
             max_uses, uses, bonus_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            "INSERT INTO household_approvals (id, profile_user_id, kind, subject, note, status, \
             requested_at, request_expires_at, decided_by, decided_at, grant_expires_at, \
             max_uses, uses, bonus_seconds) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, \
             $11, $12, $13, $14)",
        );
        sqlx::query(sql)
            .bind(a.id.to_string())
            .bind(a.profile_user_id.to_string())
            .bind(a.kind.as_str())
            .bind(a.subject.as_str())
            .bind(a.note.as_deref())
            .bind(a.status.as_str())
            .bind(format_datetime(a.requested_at))
            .bind(format_datetime(a.request_expires_at))
            .bind(a.decided_by.map(|u| u.to_string()))
            .bind(a.decided_at.map(format_datetime))
            .bind(a.grant_expires_at.map(format_datetime))
            .bind(a.max_uses.map(i64::from))
            .bind(i64::from(a.uses))
            .bind(a.bonus_seconds)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get(&self, id: Uuid) -> Result<Option<Approval>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                format!("SELECT {APPROVAL_COLUMNS} FROM household_approvals WHERE id = ?")
            }
            Backend::Postgres => {
                format!("SELECT {APPROVAL_COLUMNS} FROM household_approvals WHERE id = $1")
            }
        };
        let row = sqlx::query(&sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(approval_from_row).transpose()
    }

    async fn list_for_profiles(
        &self,
        profile_user_ids: &[Uuid],
        limit: i64,
    ) -> Result<Vec<Approval>, DbError> {
        // Few profiles per household: one query each, merged.
        let mut all = Vec::new();
        for id in profile_user_ids {
            let sql = match self.backend {
                Backend::Sqlite => format!(
                    "SELECT {APPROVAL_COLUMNS} FROM household_approvals WHERE profile_user_id = ? \
                     ORDER BY requested_at DESC LIMIT ?"
                ),
                Backend::Postgres => format!(
                    "SELECT {APPROVAL_COLUMNS} FROM household_approvals WHERE profile_user_id = $1 \
                     ORDER BY requested_at DESC LIMIT $2"
                ),
            };
            let rows = sqlx::query(&sql)
                .bind(id.to_string())
                .bind(limit)
                .fetch_all(&self.pool)
                .await?;
            for row in &rows {
                all.push(approval_from_row(row)?);
            }
        }
        all.sort_by_key(|a| std::cmp::Reverse(a.requested_at));
        all.truncate(limit.max(0) as usize);
        Ok(all)
    }

    async fn decide(
        &self,
        id: Uuid,
        status: ApprovalStatus,
        decided_by: Uuid,
        now: DateTime<Utc>,
        grant_expires_at: Option<DateTime<Utc>>,
        max_uses: Option<u32>,
        bonus_seconds: i64,
    ) -> Result<bool, DbError> {
        let sql = self.q(
            "UPDATE household_approvals SET status = ?, decided_by = ?, decided_at = ?, \
             grant_expires_at = ?, max_uses = ?, bonus_seconds = ? \
             WHERE id = ? AND status = 'pending' AND request_expires_at > ?",
            "UPDATE household_approvals SET status = $1, decided_by = $2, decided_at = $3, \
             grant_expires_at = $4, max_uses = $5, bonus_seconds = $6 \
             WHERE id = $7 AND status = 'pending' AND request_expires_at > $8",
        );
        let result = sqlx::query(sql)
            .bind(status.as_str())
            .bind(decided_by.to_string())
            .bind(format_datetime(now))
            .bind(grant_expires_at.map(format_datetime))
            .bind(max_uses.map(i64::from))
            .bind(bonus_seconds)
            .bind(id.to_string())
            .bind(format_datetime(now))
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn consume(
        &self,
        id: Uuid,
        profile_user_id: Uuid,
        now: DateTime<Utc>,
    ) -> Result<bool, DbError> {
        let sql = self.q(
            "UPDATE household_approvals SET uses = uses + 1 \
             WHERE id = ? AND profile_user_id = ? AND status = 'approved' \
             AND grant_expires_at > ? AND (max_uses IS NULL OR uses < max_uses)",
            "UPDATE household_approvals SET uses = uses + 1 \
             WHERE id = $1 AND profile_user_id = $2 AND status = 'approved' \
             AND grant_expires_at > $3 AND (max_uses IS NULL OR uses < max_uses)",
        );
        let result = sqlx::query(sql)
            .bind(id.to_string())
            .bind(profile_user_id.to_string())
            .bind(format_datetime(now))
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn active_grants(
        &self,
        profile_user_id: Uuid,
        kind: ApprovalKind,
        now: DateTime<Utc>,
    ) -> Result<Vec<Approval>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {APPROVAL_COLUMNS} FROM household_approvals WHERE profile_user_id = ? \
                 AND kind = ? AND status = 'approved' AND grant_expires_at > ? \
                 AND (max_uses IS NULL OR uses < max_uses)"
            ),
            Backend::Postgres => format!(
                "SELECT {APPROVAL_COLUMNS} FROM household_approvals WHERE profile_user_id = $1 \
                 AND kind = $2 AND status = 'approved' AND grant_expires_at > $3 \
                 AND (max_uses IS NULL OR uses < max_uses)"
            ),
        };
        let rows = sqlx::query(&sql)
            .bind(profile_user_id.to_string())
            .bind(kind.as_str())
            .bind(format_datetime(now))
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(approval_from_row).collect()
    }
}

#[async_trait]
impl PinAttemptRepo for SqlxHouseholdRepo {
    async fn find(&self, caller: Uuid, target: Uuid) -> Result<Option<PinAttemptState>, DbError> {
        let sql = self.q(
            "SELECT failures, locked_until FROM pin_attempts WHERE caller_user_id = ? AND target_user_id = ?",
            "SELECT failures, locked_until FROM pin_attempts WHERE caller_user_id = $1 AND target_user_id = $2",
        );
        let row = sqlx::query(sql)
            .bind(caller.to_string())
            .bind(target.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.map(|row| {
            let failures: i64 = row.try_get("failures")?;
            let locked: Option<String> = row.try_get("locked_until")?;
            Ok(PinAttemptState {
                failures: failures as u32,
                locked_until: locked.as_deref().map(parse_datetime).transpose()?,
            })
        })
        .transpose()
    }

    async fn record_failure(
        &self,
        caller: Uuid,
        target: Uuid,
        now: DateTime<Utc>,
        locked_until: &(dyn Fn(u32) -> Option<DateTime<Utc>> + Sync),
    ) -> Result<PinAttemptState, DbError> {
        // Increment atomically first, then derive the lock from the count
        // this call produced.
        let bump = self.q(
            "INSERT INTO pin_attempts (caller_user_id, target_user_id, failures, updated_at) \
             VALUES (?, ?, 1, ?) ON CONFLICT (caller_user_id, target_user_id) DO UPDATE SET \
             failures = pin_attempts.failures + 1, updated_at = excluded.updated_at",
            "INSERT INTO pin_attempts (caller_user_id, target_user_id, failures, updated_at) \
             VALUES ($1, $2, 1, $3) ON CONFLICT (caller_user_id, target_user_id) DO UPDATE SET \
             failures = pin_attempts.failures + 1, updated_at = excluded.updated_at",
        );
        sqlx::query(bump)
            .bind(caller.to_string())
            .bind(target.to_string())
            .bind(format_datetime(now))
            .execute(&self.pool)
            .await?;
        let state = PinAttemptRepo::find(self, caller, target)
            .await?
            .unwrap_or(PinAttemptState {
                failures: 1,
                locked_until: None,
            });
        let lock = locked_until(state.failures);
        if lock.is_some() {
            let set = self.q(
                "UPDATE pin_attempts SET locked_until = ? WHERE caller_user_id = ? AND target_user_id = ?",
                "UPDATE pin_attempts SET locked_until = $1 WHERE caller_user_id = $2 AND target_user_id = $3",
            );
            sqlx::query(set)
                .bind(lock.map(format_datetime))
                .bind(caller.to_string())
                .bind(target.to_string())
                .execute(&self.pool)
                .await?;
        }
        Ok(PinAttemptState {
            failures: state.failures,
            locked_until: lock.or(state.locked_until),
        })
    }

    async fn reset(&self, caller: Uuid, target: Uuid) -> Result<(), DbError> {
        let sql = self.q(
            "DELETE FROM pin_attempts WHERE caller_user_id = ? AND target_user_id = ?",
            "DELETE FROM pin_attempts WHERE caller_user_id = $1 AND target_user_id = $2",
        );
        sqlx::query(sql)
            .bind(caller.to_string())
            .bind(target.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use chrono::Duration;

    use super::*;
    use crate::pool::test_sqlite_pool;

    fn approval(kind: ApprovalKind) -> Approval {
        let now = Utc::now();
        Approval {
            id: Uuid::new_v4(),
            profile_user_id: Uuid::new_v4(),
            kind,
            subject: "subject".into(),
            note: None,
            status: ApprovalStatus::Pending,
            requested_at: now,
            request_expires_at: now + Duration::minutes(15),
            decided_by: None,
            decided_at: None,
            grant_expires_at: None,
            max_uses: None,
            uses: 0,
            bonus_seconds: 0,
        }
    }

    #[tokio::test]
    async fn usage_accumulates_per_day() {
        let repo = SqlxHouseholdRepo::new(test_sqlite_pool().await);
        let user = Uuid::new_v4();
        assert_eq!(repo.seconds_for_day(user, "2026-10-03").await.unwrap(), 0);
        repo.add_seconds(user, "2026-10-03", 10).await.unwrap();
        repo.add_seconds(user, "2026-10-03", 5).await.unwrap();
        repo.add_seconds(user, "2026-10-04", 7).await.unwrap();
        assert_eq!(repo.seconds_for_day(user, "2026-10-03").await.unwrap(), 15);
        assert_eq!(repo.seconds_for_day(user, "2026-10-04").await.unwrap(), 7);
    }

    #[tokio::test]
    async fn approval_decides_once_and_expired_requests_cannot_be_decided() {
        let repo = SqlxHouseholdRepo::new(test_sqlite_pool().await);
        let a = approval(ApprovalKind::Content);
        repo.insert(&a).await.unwrap();
        let now = Utc::now();
        let grant = Some(now + Duration::hours(1));
        let guardian = Uuid::new_v4();
        assert!(repo
            .decide(
                a.id,
                ApprovalStatus::Approved,
                guardian,
                now,
                grant,
                None,
                0
            )
            .await
            .unwrap());
        // A second decision loses.
        assert!(!repo
            .decide(a.id, ApprovalStatus::Denied, guardian, now, None, None, 0)
            .await
            .unwrap());
        let stored = repo.get(a.id).await.unwrap().unwrap();
        assert_eq!(stored.status, ApprovalStatus::Approved);
        assert_eq!(stored.decided_by, Some(guardian));

        let mut late = approval(ApprovalKind::Content);
        late.request_expires_at = now - Duration::minutes(1);
        repo.insert(&late).await.unwrap();
        assert!(!repo
            .decide(
                late.id,
                ApprovalStatus::Approved,
                guardian,
                now,
                grant,
                None,
                0
            )
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn consume_is_single_use_scoped_and_expiring() {
        let repo = SqlxHouseholdRepo::new(test_sqlite_pool().await);
        let a = approval(ApprovalKind::Purchase);
        repo.insert(&a).await.unwrap();
        let now = Utc::now();
        // Not approved yet.
        assert!(!repo.consume(a.id, a.profile_user_id, now).await.unwrap());
        repo.decide(
            a.id,
            ApprovalStatus::Approved,
            Uuid::new_v4(),
            now,
            Some(now + Duration::minutes(10)),
            Some(1),
            0,
        )
        .await
        .unwrap();
        // Another profile cannot use it.
        assert!(!repo.consume(a.id, Uuid::new_v4(), now).await.unwrap());
        assert!(repo.consume(a.id, a.profile_user_id, now).await.unwrap());
        // Second use is refused.
        assert!(!repo.consume(a.id, a.profile_user_id, now).await.unwrap());

        let b = approval(ApprovalKind::Install);
        repo.insert(&b).await.unwrap();
        repo.decide(
            b.id,
            ApprovalStatus::Approved,
            Uuid::new_v4(),
            now,
            Some(now + Duration::minutes(10)),
            Some(1),
            0,
        )
        .await
        .unwrap();
        // After expiry.
        assert!(!repo
            .consume(b.id, b.profile_user_id, now + Duration::minutes(11))
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn active_grants_filters_by_kind_status_and_expiry() {
        let repo = SqlxHouseholdRepo::new(test_sqlite_pool().await);
        let now = Utc::now();
        let profile = Uuid::new_v4();
        for (kind, expires) in [
            (ApprovalKind::Content, now + Duration::hours(1)),
            (ApprovalKind::Content, now - Duration::hours(1)),
            (ApprovalKind::Time, now + Duration::hours(1)),
        ] {
            let mut a = approval(kind);
            a.profile_user_id = profile;
            repo.insert(&a).await.unwrap();
            repo.decide(
                a.id,
                ApprovalStatus::Approved,
                Uuid::new_v4(),
                now - Duration::hours(2),
                Some(expires),
                None,
                0,
            )
            .await
            .unwrap();
        }
        let grants = repo
            .active_grants(profile, ApprovalKind::Content, now)
            .await
            .unwrap();
        assert_eq!(grants.len(), 1);
    }

    #[tokio::test]
    async fn pin_failures_count_lock_and_reset() {
        let repo = SqlxHouseholdRepo::new(test_sqlite_pool().await);
        let (caller, target) = (Uuid::new_v4(), Uuid::new_v4());
        let now = Utc::now();
        let lock = |n: u32| (n >= 3).then(|| now + Duration::minutes(1));
        for expected in 1..=2 {
            let s = repo
                .record_failure(caller, target, now, &lock)
                .await
                .unwrap();
            assert_eq!((s.failures, s.locked_until), (expected, None));
        }
        let s = repo
            .record_failure(caller, target, now, &lock)
            .await
            .unwrap();
        assert_eq!(s.failures, 3);
        assert!(s.locked_until.is_some());
        assert!(PinAttemptRepo::find(&repo, caller, target)
            .await
            .unwrap()
            .unwrap()
            .locked_until
            .is_some());
        repo.reset(caller, target).await.unwrap();
        assert!(PinAttemptRepo::find(&repo, caller, target)
            .await
            .unwrap()
            .is_none());
    }
}
