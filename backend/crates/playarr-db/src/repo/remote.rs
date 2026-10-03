//! Durable storage for the phone-remote and playback-handoff feature
//! (`docs/architecture/remote-control.md`): registered remote targets,
//! pairings, the per-target event queue and handoff records.
//!
//! Every query is written once with `?` placeholders and rewritten to `$n`
//! for Postgres. Times are Unix epoch milliseconds. Status columns are plain
//! strings; the API layer owns the vocabulary and the transition rules, this
//! layer only offers compare-and-set updates so concurrent callers cannot
//! both win a transition.
//!
//! Event `payload` can hold keyboard input; it is never logged here and is
//! cleared on acknowledgement and purge.

use async_trait::async_trait;
use serde_json::Value;
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{decode_err, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

#[derive(Debug, Clone, PartialEq)]
pub struct RemoteTarget {
    pub device_id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub platform: String,
    pub capabilities: Vec<String>,
    pub state: Option<Value>,
    pub state_at_ms: Option<i64>,
    pub last_seen_ms: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RemotePairing {
    pub id: Uuid,
    pub user_id: Uuid,
    pub controller_device_id: Uuid,
    pub controller_name: String,
    pub target_device_id: Uuid,
    pub status: String,
    pub scopes: Vec<String>,
    pub verification_code: String,
    pub created_ms: i64,
    pub expires_ms: i64,
    pub approved_ms: Option<i64>,
    pub revoked_ms: Option<i64>,
    pub revoked_by: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RemoteEvent {
    pub id: Uuid,
    pub target_device_id: Uuid,
    pub seq: i64,
    pub kind: String,
    pub pairing_id: Option<Uuid>,
    pub user_id: Uuid,
    pub controller_device_id: Option<Uuid>,
    pub payload: Option<Value>,
    pub status: String,
    pub result: Option<Value>,
    pub created_ms: i64,
    pub expires_ms: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RemoteHandoff {
    pub id: Uuid,
    pub user_id: Uuid,
    pub initiator_device_id: Uuid,
    pub request_key: String,
    pub source_device_id: Uuid,
    pub destination_device_id: Uuid,
    pub media_file_id: Uuid,
    pub work_id: Uuid,
    pub snapshot: Value,
    pub status: String,
    pub created_ms: i64,
    pub expires_ms: i64,
    pub completed_ms: Option<i64>,
    pub acked_position_ms: Option<i64>,
    pub failure_reason: Option<String>,
}

#[async_trait]
pub trait RemoteRepo: Send + Sync {
    async fn upsert_target(&self, target: &RemoteTarget) -> Result<(), DbError>;
    async fn get_target(&self, device_id: Uuid) -> Result<Option<RemoteTarget>, DbError>;
    async fn list_targets_for_user(&self, user_id: Uuid) -> Result<Vec<RemoteTarget>, DbError>;
    async fn touch_target(&self, device_id: Uuid, now_ms: i64) -> Result<(), DbError>;
    async fn set_target_state(
        &self,
        device_id: Uuid,
        state: &Value,
        now_ms: i64,
    ) -> Result<(), DbError>;
    async fn delete_target(&self, device_id: Uuid) -> Result<(), DbError>;

    async fn insert_pairing(&self, pairing: &RemotePairing) -> Result<(), DbError>;
    async fn get_pairing(&self, id: Uuid) -> Result<Option<RemotePairing>, DbError>;
    async fn list_pairings_for_user(&self, user_id: Uuid) -> Result<Vec<RemotePairing>, DbError>;
    /// Newest `active` pairing for the exact controller/target device pair.
    async fn find_pairing(
        &self,
        controller_device_id: Uuid,
        target_device_id: Uuid,
        status: &str,
    ) -> Result<Option<RemotePairing>, DbError>;
    /// Compare-and-set: moves the pairing from any status in `from` to `to`.
    /// `Ok(false)` means the precondition no longer held.
    async fn transition_pairing(
        &self,
        id: Uuid,
        from: &[&str],
        to: &str,
        now_ms: i64,
        active_expires_ms: Option<i64>,
        revoked_by: Option<Uuid>,
    ) -> Result<bool, DbError>;

    /// Narrows the scopes of a still-pending pairing.
    async fn set_pairing_scopes(&self, id: Uuid, scopes: &[String]) -> Result<bool, DbError>;

    async fn enqueue_event(&self, event: RemoteEvent) -> Result<RemoteEvent, DbError>;
    async fn get_event(&self, id: Uuid) -> Result<Option<RemoteEvent>, DbError>;
    /// Unexpired events for the target with `seq > after`, oldest first.
    /// Events reaching the target move `queued -> delivered`.
    async fn deliver_events(
        &self,
        target_device_id: Uuid,
        after: i64,
        now_ms: i64,
        limit: i64,
    ) -> Result<Vec<RemoteEvent>, DbError>;
    /// Compare-and-set `queued|delivered -> status`, clearing the payload.
    async fn ack_event(
        &self,
        id: Uuid,
        target_device_id: Uuid,
        status: &str,
        result: Option<&Value>,
    ) -> Result<bool, DbError>;
    /// Clears payloads of expired events and deletes events long past expiry.
    async fn purge_events(&self, now_ms: i64) -> Result<u64, DbError>;

    async fn insert_handoff(&self, handoff: &RemoteHandoff) -> Result<(), DbError>;
    async fn get_handoff(&self, id: Uuid) -> Result<Option<RemoteHandoff>, DbError>;
    async fn find_handoff_by_key(
        &self,
        initiator_device_id: Uuid,
        request_key: &str,
    ) -> Result<Option<RemoteHandoff>, DbError>;
    /// `pending -> committed` iff still pending and unexpired.
    async fn commit_handoff(
        &self,
        id: Uuid,
        acked_position_ms: i64,
        now_ms: i64,
    ) -> Result<bool, DbError>;
    /// `pending -> to` (`failed`, `cancelled` or `expired`).
    async fn close_handoff(
        &self,
        id: Uuid,
        to: &str,
        reason: Option<&str>,
        now_ms: i64,
    ) -> Result<bool, DbError>;
}

pub struct SqlxRemoteRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxRemoteRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn sql(&self, q: &str) -> String {
        match self.backend {
            Backend::Sqlite => q.to_string(),
            Backend::Postgres => {
                let mut out = String::with_capacity(q.len() + 8);
                let mut n = 0;
                for c in q.chars() {
                    if c == '?' {
                        n += 1;
                        out.push('$');
                        out.push_str(&n.to_string());
                    } else {
                        out.push(c);
                    }
                }
                out
            }
        }
    }
}

fn opt_json(raw: Option<String>) -> Result<Option<Value>, DbError> {
    raw.map(|s| serde_json::from_str(&s).map_err(DbError::from))
        .transpose()
}

fn json_str(value: &Option<Value>) -> Option<String> {
    value.as_ref().map(|v| v.to_string())
}

fn opt_uuid(raw: Option<String>) -> Result<Option<Uuid>, DbError> {
    raw.map(|s| parse_uuid(&s)).transpose()
}

fn strings(raw: &str) -> Result<Vec<String>, DbError> {
    serde_json::from_str(raw).map_err(|e| decode_err(e.to_string()))
}

const TARGET_COLS: &str =
    "device_id, user_id, name, platform, capabilities, state, state_at_ms, last_seen_ms";
const PAIRING_COLS: &str = "id, user_id, controller_device_id, controller_name, target_device_id, \
     status, scopes, verification_code, created_ms, expires_ms, approved_ms, revoked_ms, revoked_by";
const EVENT_COLS: &str = "id, target_device_id, seq, kind, pairing_id, user_id, \
     controller_device_id, payload, status, result, created_ms, expires_ms";
const HANDOFF_COLS: &str = "id, user_id, initiator_device_id, request_key, source_device_id, \
     destination_device_id, media_file_id, work_id, snapshot, status, created_ms, expires_ms, \
     completed_ms, acked_position_ms, failure_reason";

fn target_from(row: &AnyRow) -> Result<RemoteTarget, DbError> {
    Ok(RemoteTarget {
        device_id: parse_uuid(&row.try_get::<String, _>("device_id")?)?,
        user_id: parse_uuid(&row.try_get::<String, _>("user_id")?)?,
        name: row.try_get("name")?,
        platform: row.try_get("platform")?,
        capabilities: strings(&row.try_get::<String, _>("capabilities")?)?,
        state: opt_json(row.try_get("state")?)?,
        state_at_ms: row.try_get("state_at_ms")?,
        last_seen_ms: row.try_get("last_seen_ms")?,
    })
}

fn pairing_from(row: &AnyRow) -> Result<RemotePairing, DbError> {
    Ok(RemotePairing {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        user_id: parse_uuid(&row.try_get::<String, _>("user_id")?)?,
        controller_device_id: parse_uuid(&row.try_get::<String, _>("controller_device_id")?)?,
        controller_name: row.try_get("controller_name")?,
        target_device_id: parse_uuid(&row.try_get::<String, _>("target_device_id")?)?,
        status: row.try_get("status")?,
        scopes: strings(&row.try_get::<String, _>("scopes")?)?,
        verification_code: row.try_get("verification_code")?,
        created_ms: row.try_get("created_ms")?,
        expires_ms: row.try_get("expires_ms")?,
        approved_ms: row.try_get("approved_ms")?,
        revoked_ms: row.try_get("revoked_ms")?,
        revoked_by: opt_uuid(row.try_get("revoked_by")?)?,
    })
}

fn event_from(row: &AnyRow) -> Result<RemoteEvent, DbError> {
    Ok(RemoteEvent {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        target_device_id: parse_uuid(&row.try_get::<String, _>("target_device_id")?)?,
        seq: row.try_get("seq")?,
        kind: row.try_get("kind")?,
        pairing_id: opt_uuid(row.try_get("pairing_id")?)?,
        user_id: parse_uuid(&row.try_get::<String, _>("user_id")?)?,
        controller_device_id: opt_uuid(row.try_get("controller_device_id")?)?,
        payload: opt_json(row.try_get("payload")?)?,
        status: row.try_get("status")?,
        result: opt_json(row.try_get("result")?)?,
        created_ms: row.try_get("created_ms")?,
        expires_ms: row.try_get("expires_ms")?,
    })
}

fn handoff_from(row: &AnyRow) -> Result<RemoteHandoff, DbError> {
    Ok(RemoteHandoff {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        user_id: parse_uuid(&row.try_get::<String, _>("user_id")?)?,
        initiator_device_id: parse_uuid(&row.try_get::<String, _>("initiator_device_id")?)?,
        request_key: row.try_get("request_key")?,
        source_device_id: parse_uuid(&row.try_get::<String, _>("source_device_id")?)?,
        destination_device_id: parse_uuid(&row.try_get::<String, _>("destination_device_id")?)?,
        media_file_id: parse_uuid(&row.try_get::<String, _>("media_file_id")?)?,
        work_id: parse_uuid(&row.try_get::<String, _>("work_id")?)?,
        snapshot: serde_json::from_str(&row.try_get::<String, _>("snapshot")?)?,
        status: row.try_get("status")?,
        created_ms: row.try_get("created_ms")?,
        expires_ms: row.try_get("expires_ms")?,
        completed_ms: row.try_get("completed_ms")?,
        acked_position_ms: row.try_get("acked_position_ms")?,
        failure_reason: row.try_get("failure_reason")?,
    })
}

#[async_trait]
impl RemoteRepo for SqlxRemoteRepo {
    async fn upsert_target(&self, t: &RemoteTarget) -> Result<(), DbError> {
        let sql = self.sql(&format!(
            "INSERT INTO remote_targets ({TARGET_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT (device_id) DO UPDATE SET user_id = excluded.user_id, \
             name = excluded.name, platform = excluded.platform, \
             capabilities = excluded.capabilities, last_seen_ms = excluded.last_seen_ms"
        ));
        sqlx::query(&sql)
            .bind(t.device_id.to_string())
            .bind(t.user_id.to_string())
            .bind(t.name.clone())
            .bind(t.platform.clone())
            .bind(serde_json::to_string(&t.capabilities)?)
            .bind(json_str(&t.state))
            .bind(t.state_at_ms)
            .bind(t.last_seen_ms)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get_target(&self, device_id: Uuid) -> Result<Option<RemoteTarget>, DbError> {
        let sql = self.sql(&format!(
            "SELECT {TARGET_COLS} FROM remote_targets WHERE device_id = ?"
        ));
        let row = sqlx::query(&sql)
            .bind(device_id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(target_from).transpose()
    }

    async fn list_targets_for_user(&self, user_id: Uuid) -> Result<Vec<RemoteTarget>, DbError> {
        let sql = self.sql(&format!(
            "SELECT {TARGET_COLS} FROM remote_targets WHERE user_id = ? ORDER BY name"
        ));
        let rows = sqlx::query(&sql)
            .bind(user_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(target_from).collect()
    }

    async fn touch_target(&self, device_id: Uuid, now_ms: i64) -> Result<(), DbError> {
        let sql = self.sql("UPDATE remote_targets SET last_seen_ms = ? WHERE device_id = ?");
        sqlx::query(&sql)
            .bind(now_ms)
            .bind(device_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn set_target_state(
        &self,
        device_id: Uuid,
        state: &Value,
        now_ms: i64,
    ) -> Result<(), DbError> {
        let sql = self.sql(
            "UPDATE remote_targets SET state = ?, state_at_ms = ?, last_seen_ms = ? \
             WHERE device_id = ?",
        );
        sqlx::query(&sql)
            .bind(state.to_string())
            .bind(now_ms)
            .bind(now_ms)
            .bind(device_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_target(&self, device_id: Uuid) -> Result<(), DbError> {
        let sql = self.sql("DELETE FROM remote_targets WHERE device_id = ?");
        sqlx::query(&sql)
            .bind(device_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn insert_pairing(&self, p: &RemotePairing) -> Result<(), DbError> {
        let sql = self.sql(&format!(
            "INSERT INTO remote_pairings ({PAIRING_COLS}) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ));
        sqlx::query(&sql)
            .bind(p.id.to_string())
            .bind(p.user_id.to_string())
            .bind(p.controller_device_id.to_string())
            .bind(p.controller_name.clone())
            .bind(p.target_device_id.to_string())
            .bind(p.status.clone())
            .bind(serde_json::to_string(&p.scopes)?)
            .bind(p.verification_code.clone())
            .bind(p.created_ms)
            .bind(p.expires_ms)
            .bind(p.approved_ms)
            .bind(p.revoked_ms)
            .bind(p.revoked_by.map(|u| u.to_string()))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get_pairing(&self, id: Uuid) -> Result<Option<RemotePairing>, DbError> {
        let sql = self.sql(&format!(
            "SELECT {PAIRING_COLS} FROM remote_pairings WHERE id = ?"
        ));
        let row = sqlx::query(&sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(pairing_from).transpose()
    }

    async fn list_pairings_for_user(&self, user_id: Uuid) -> Result<Vec<RemotePairing>, DbError> {
        let sql = self.sql(&format!(
            "SELECT {PAIRING_COLS} FROM remote_pairings WHERE user_id = ? \
             ORDER BY created_ms DESC LIMIT 200"
        ));
        let rows = sqlx::query(&sql)
            .bind(user_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(pairing_from).collect()
    }

    async fn find_pairing(
        &self,
        controller_device_id: Uuid,
        target_device_id: Uuid,
        status: &str,
    ) -> Result<Option<RemotePairing>, DbError> {
        let sql = self.sql(&format!(
            "SELECT {PAIRING_COLS} FROM remote_pairings WHERE controller_device_id = ? \
             AND target_device_id = ? AND status = ? ORDER BY created_ms DESC LIMIT 1"
        ));
        let row = sqlx::query(&sql)
            .bind(controller_device_id.to_string())
            .bind(target_device_id.to_string())
            .bind(status.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(pairing_from).transpose()
    }

    async fn transition_pairing(
        &self,
        id: Uuid,
        from: &[&str],
        to: &str,
        now_ms: i64,
        active_expires_ms: Option<i64>,
        revoked_by: Option<Uuid>,
    ) -> Result<bool, DbError> {
        let placeholders = vec!["?"; from.len()].join(", ");
        let sql = self.sql(&format!(
            "UPDATE remote_pairings SET status = ?, \
             approved_ms = CASE WHEN ? = 'active' THEN ? ELSE approved_ms END, \
             expires_ms = COALESCE(?, expires_ms), \
             revoked_ms = CASE WHEN ? = 'revoked' THEN ? ELSE revoked_ms END, \
             revoked_by = CASE WHEN ? = 'revoked' THEN ? ELSE revoked_by END \
             WHERE id = ? AND status IN ({placeholders})"
        ));
        let mut query = sqlx::query(&sql)
            .bind(to.to_string())
            .bind(to.to_string())
            .bind(now_ms)
            .bind(active_expires_ms)
            .bind(to.to_string())
            .bind(now_ms)
            .bind(to.to_string())
            .bind(revoked_by.map(|u| u.to_string()))
            .bind(id.to_string());
        for status in from {
            query = query.bind((*status).to_string());
        }
        Ok(query.execute(&self.pool).await?.rows_affected() == 1)
    }

    async fn set_pairing_scopes(&self, id: Uuid, scopes: &[String]) -> Result<bool, DbError> {
        let sql =
            self.sql("UPDATE remote_pairings SET scopes = ? WHERE id = ? AND status = 'pending'");
        let done = sqlx::query(&sql)
            .bind(serde_json::to_string(scopes)?)
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(done.rows_affected() == 1)
    }

    async fn enqueue_event(&self, mut event: RemoteEvent) -> Result<RemoteEvent, DbError> {
        let sql = self.sql(&format!(
            "INSERT INTO remote_events ({EVENT_COLS}) \
             SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ? \
             FROM remote_events WHERE target_device_id = ?"
        ));
        let mut last_err = None;
        for _ in 0..8 {
            let result = sqlx::query(&sql)
                .bind(event.id.to_string())
                .bind(event.target_device_id.to_string())
                .bind(event.kind.clone())
                .bind(event.pairing_id.map(|u| u.to_string()))
                .bind(event.user_id.to_string())
                .bind(event.controller_device_id.map(|u| u.to_string()))
                .bind(json_str(&event.payload))
                .bind(event.status.clone())
                .bind(json_str(&event.result))
                .bind(event.created_ms)
                .bind(event.expires_ms)
                .bind(event.target_device_id.to_string())
                .execute(&self.pool)
                .await;
            match result {
                Ok(_) => {
                    let fetched = self.get_event(event.id).await?.ok_or(DbError::NotFound)?;
                    event.seq = fetched.seq;
                    return Ok(event);
                }
                Err(err) => last_err = Some(err),
            }
        }
        Err(last_err.map(DbError::from).unwrap_or(DbError::NotFound))
    }

    async fn get_event(&self, id: Uuid) -> Result<Option<RemoteEvent>, DbError> {
        let sql = self.sql(&format!(
            "SELECT {EVENT_COLS} FROM remote_events WHERE id = ?"
        ));
        let row = sqlx::query(&sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(event_from).transpose()
    }

    async fn deliver_events(
        &self,
        target_device_id: Uuid,
        after: i64,
        now_ms: i64,
        limit: i64,
    ) -> Result<Vec<RemoteEvent>, DbError> {
        let sql = self.sql(&format!(
            "SELECT {EVENT_COLS} FROM remote_events WHERE target_device_id = ? AND seq > ? \
             AND expires_ms > ? AND status IN ('queued', 'delivered') ORDER BY seq LIMIT ?"
        ));
        let rows = sqlx::query(&sql)
            .bind(target_device_id.to_string())
            .bind(after)
            .bind(now_ms)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?;
        let events = rows.iter().map(event_from).collect::<Result<Vec<_>, _>>()?;
        if events.iter().any(|e| e.status == "queued") {
            let mark = self.sql(
                "UPDATE remote_events SET status = 'delivered' \
                 WHERE target_device_id = ? AND seq > ? AND status = 'queued' AND expires_ms > ?",
            );
            sqlx::query(&mark)
                .bind(target_device_id.to_string())
                .bind(after)
                .bind(now_ms)
                .execute(&self.pool)
                .await?;
        }
        Ok(events)
    }

    async fn ack_event(
        &self,
        id: Uuid,
        target_device_id: Uuid,
        status: &str,
        result: Option<&Value>,
    ) -> Result<bool, DbError> {
        let sql = self.sql(
            "UPDATE remote_events SET status = ?, result = ?, payload = NULL \
             WHERE id = ? AND target_device_id = ? AND status IN ('queued', 'delivered')",
        );
        let done = sqlx::query(&sql)
            .bind(status.to_string())
            .bind(result.map(|v| v.to_string()))
            .bind(id.to_string())
            .bind(target_device_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(done.rows_affected() == 1)
    }

    async fn purge_events(&self, now_ms: i64) -> Result<u64, DbError> {
        let clear = self.sql(
            "UPDATE remote_events SET payload = NULL WHERE expires_ms <= ? AND payload IS NOT NULL",
        );
        sqlx::query(&clear).bind(now_ms).execute(&self.pool).await?;
        let del = self.sql("DELETE FROM remote_events WHERE expires_ms <= ?");
        let done = sqlx::query(&del)
            .bind(now_ms - 600_000)
            .execute(&self.pool)
            .await?;
        Ok(done.rows_affected())
    }

    async fn insert_handoff(&self, h: &RemoteHandoff) -> Result<(), DbError> {
        let sql = self.sql(&format!(
            "INSERT INTO remote_handoffs ({HANDOFF_COLS}) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ));
        sqlx::query(&sql)
            .bind(h.id.to_string())
            .bind(h.user_id.to_string())
            .bind(h.initiator_device_id.to_string())
            .bind(h.request_key.clone())
            .bind(h.source_device_id.to_string())
            .bind(h.destination_device_id.to_string())
            .bind(h.media_file_id.to_string())
            .bind(h.work_id.to_string())
            .bind(h.snapshot.to_string())
            .bind(h.status.clone())
            .bind(h.created_ms)
            .bind(h.expires_ms)
            .bind(h.completed_ms)
            .bind(h.acked_position_ms)
            .bind(h.failure_reason.clone())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get_handoff(&self, id: Uuid) -> Result<Option<RemoteHandoff>, DbError> {
        let sql = self.sql(&format!(
            "SELECT {HANDOFF_COLS} FROM remote_handoffs WHERE id = ?"
        ));
        let row = sqlx::query(&sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(handoff_from).transpose()
    }

    async fn find_handoff_by_key(
        &self,
        initiator_device_id: Uuid,
        request_key: &str,
    ) -> Result<Option<RemoteHandoff>, DbError> {
        let sql = self.sql(&format!(
            "SELECT {HANDOFF_COLS} FROM remote_handoffs \
             WHERE initiator_device_id = ? AND request_key = ?"
        ));
        let row = sqlx::query(&sql)
            .bind(initiator_device_id.to_string())
            .bind(request_key.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(handoff_from).transpose()
    }

    async fn commit_handoff(
        &self,
        id: Uuid,
        acked_position_ms: i64,
        now_ms: i64,
    ) -> Result<bool, DbError> {
        let sql = self.sql(
            "UPDATE remote_handoffs SET status = 'committed', acked_position_ms = ?, \
             completed_ms = ? WHERE id = ? AND status = 'pending' AND expires_ms > ?",
        );
        let done = sqlx::query(&sql)
            .bind(acked_position_ms)
            .bind(now_ms)
            .bind(id.to_string())
            .bind(now_ms)
            .execute(&self.pool)
            .await?;
        Ok(done.rows_affected() == 1)
    }

    async fn close_handoff(
        &self,
        id: Uuid,
        to: &str,
        reason: Option<&str>,
        now_ms: i64,
    ) -> Result<bool, DbError> {
        let sql = self.sql(
            "UPDATE remote_handoffs SET status = ?, failure_reason = ?, completed_ms = ? \
             WHERE id = ? AND status = 'pending'",
        );
        let done = sqlx::query(&sql)
            .bind(to.to_string())
            .bind(reason.map(str::to_string))
            .bind(now_ms)
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(done.rows_affected() == 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pool::test_sqlite_pool;
    use serde_json::json;

    fn pairing(user: Uuid, controller: Uuid, target: Uuid) -> RemotePairing {
        RemotePairing {
            id: Uuid::new_v4(),
            user_id: user,
            controller_device_id: controller,
            controller_name: "Phone".into(),
            target_device_id: target,
            status: "pending".into(),
            scopes: vec!["navigate".into()],
            verification_code: "123456".into(),
            created_ms: 1,
            expires_ms: 1000,
            approved_ms: None,
            revoked_ms: None,
            revoked_by: None,
        }
    }

    fn event(target: Uuid, payload: Value) -> RemoteEvent {
        RemoteEvent {
            id: Uuid::new_v4(),
            target_device_id: target,
            seq: 0,
            kind: "command".into(),
            pairing_id: None,
            user_id: Uuid::new_v4(),
            controller_device_id: None,
            payload: Some(payload),
            status: "queued".into(),
            result: None,
            created_ms: 10,
            expires_ms: 10_000,
        }
    }

    /// Runs the same scenarios against a real Postgres when
    /// `PLAYARR_TEST_POSTGRES_URL` points at an empty database.
    #[tokio::test]
    async fn repo_behaves_the_same_on_postgres() {
        let Ok(url) = std::env::var("PLAYARR_TEST_POSTGRES_URL") else {
            return;
        };
        sqlx::any::install_default_drivers();
        let pool = crate::pool::connect(&url).await.unwrap();
        crate::pool::run_migrations(&pool, true).await.unwrap();
        let repo = SqlxRemoteRepo::new(pool);
        let target = Uuid::new_v4();
        let a = repo
            .enqueue_event(event(target, json!({"text": "a"})))
            .await
            .unwrap();
        let b = repo
            .enqueue_event(event(target, json!({"text": "b"})))
            .await
            .unwrap();
        assert_eq!((a.seq, b.seq), (1, 2));
        let got = repo.deliver_events(target, 0, 100, 10).await.unwrap();
        assert_eq!(got.len(), 2);
        assert!(repo
            .ack_event(a.id, target, "ok", Some(&json!({"detail": "x"})))
            .await
            .unwrap());
        assert!(repo
            .get_event(a.id)
            .await
            .unwrap()
            .unwrap()
            .payload
            .is_none());
        let p = pairing(Uuid::new_v4(), Uuid::new_v4(), target);
        repo.insert_pairing(&p).await.unwrap();
        assert!(repo
            .set_pairing_scopes(p.id, &["text".to_string()])
            .await
            .unwrap());
        assert!(repo
            .transition_pairing(p.id, &["pending"], "active", 5, Some(9000), None)
            .await
            .unwrap());
        let who = Uuid::new_v4();
        assert!(repo
            .transition_pairing(p.id, &["pending", "active"], "revoked", 7, None, Some(who))
            .await
            .unwrap());
        let got = repo.get_pairing(p.id).await.unwrap().unwrap();
        assert_eq!(
            (got.status.as_str(), got.revoked_by, got.scopes),
            ("revoked", Some(who), vec!["text".to_string()])
        );
        let t = RemoteTarget {
            device_id: target,
            user_id: Uuid::new_v4(),
            name: "TV".into(),
            platform: "android-tv".into(),
            capabilities: vec!["navigate".into()],
            state: None,
            state_at_ms: None,
            last_seen_ms: 1,
        };
        repo.upsert_target(&t).await.unwrap();
        repo.set_target_state(target, &json!({"position_ms": 5}), 9)
            .await
            .unwrap();
        assert_eq!(
            repo.get_target(target).await.unwrap().unwrap().state_at_ms,
            Some(9)
        );
        let h = RemoteHandoff {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            initiator_device_id: Uuid::new_v4(),
            request_key: "k".into(),
            source_device_id: Uuid::new_v4(),
            destination_device_id: Uuid::new_v4(),
            media_file_id: Uuid::new_v4(),
            work_id: Uuid::new_v4(),
            snapshot: json!({"position_ms": 1}),
            status: "pending".into(),
            created_ms: 1,
            expires_ms: 100,
            completed_ms: None,
            acked_position_ms: None,
            failure_reason: None,
        };
        repo.insert_handoff(&h).await.unwrap();
        assert!(repo.commit_handoff(h.id, 3, 50).await.unwrap());
        assert!(!repo.commit_handoff(h.id, 3, 51).await.unwrap());
        repo.purge_events(1_000_000).await.unwrap();
    }

    #[tokio::test]
    async fn pairing_transitions_are_compare_and_set() {
        let repo = SqlxRemoteRepo::new(test_sqlite_pool().await);
        let p = pairing(Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        repo.insert_pairing(&p).await.unwrap();
        assert!(repo
            .transition_pairing(p.id, &["pending"], "active", 5, Some(9000), None)
            .await
            .unwrap());
        // A second approve loses.
        assert!(!repo
            .transition_pairing(p.id, &["pending"], "active", 6, Some(9500), None)
            .await
            .unwrap());
        let active = repo.get_pairing(p.id).await.unwrap().unwrap();
        assert_eq!(active.status, "active");
        assert_eq!(active.expires_ms, 9000);
        assert_eq!(active.approved_ms, Some(5));
        let who = Uuid::new_v4();
        assert!(repo
            .transition_pairing(p.id, &["pending", "active"], "revoked", 7, None, Some(who))
            .await
            .unwrap());
        let revoked = repo.get_pairing(p.id).await.unwrap().unwrap();
        assert_eq!(revoked.revoked_by, Some(who));
        assert_eq!(revoked.expires_ms, 9000);
        assert!(repo
            .find_pairing(p.controller_device_id, p.target_device_id, "active")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn events_get_monotonic_seq_deliver_in_order_and_clear_payload_on_ack() {
        let repo = SqlxRemoteRepo::new(test_sqlite_pool().await);
        let target = Uuid::new_v4();
        let a = repo
            .enqueue_event(event(target, json!({"text": "a"})))
            .await
            .unwrap();
        let b = repo
            .enqueue_event(event(target, json!({"text": "b"})))
            .await
            .unwrap();
        let other = repo
            .enqueue_event(event(Uuid::new_v4(), json!({"text": "x"})))
            .await
            .unwrap();
        assert_eq!((a.seq, b.seq, other.seq), (1, 2, 1));

        let got = repo.deliver_events(target, 0, 100, 10).await.unwrap();
        assert_eq!(got.iter().map(|e| e.seq).collect::<Vec<_>>(), vec![1, 2]);
        let after = repo.deliver_events(target, 1, 100, 10).await.unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].status, "delivered");

        assert!(repo.ack_event(a.id, target, "acked", None).await.unwrap());
        assert!(!repo.ack_event(a.id, target, "acked", None).await.unwrap());
        assert!(!repo
            .ack_event(b.id, Uuid::new_v4(), "acked", None)
            .await
            .unwrap());
        assert!(repo
            .get_event(a.id)
            .await
            .unwrap()
            .unwrap()
            .payload
            .is_none());
        // Expired events are neither delivered nor retain payloads.
        assert!(repo
            .deliver_events(target, 0, 20_000, 10)
            .await
            .unwrap()
            .is_empty());
        repo.purge_events(20_000).await.unwrap();
        assert!(repo
            .get_event(b.id)
            .await
            .unwrap()
            .unwrap()
            .payload
            .is_none());
    }

    #[tokio::test]
    async fn handoff_commits_once_and_keys_are_unique() {
        let repo = SqlxRemoteRepo::new(test_sqlite_pool().await);
        let h = RemoteHandoff {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            initiator_device_id: Uuid::new_v4(),
            request_key: "k1".into(),
            source_device_id: Uuid::new_v4(),
            destination_device_id: Uuid::new_v4(),
            media_file_id: Uuid::new_v4(),
            work_id: Uuid::new_v4(),
            snapshot: json!({"position_ms": 1000}),
            status: "pending".into(),
            created_ms: 1,
            expires_ms: 100,
            completed_ms: None,
            acked_position_ms: None,
            failure_reason: None,
        };
        repo.insert_handoff(&h).await.unwrap();
        let mut dup = h.clone();
        dup.id = Uuid::new_v4();
        assert!(repo.insert_handoff(&dup).await.is_err());
        assert!(repo
            .find_handoff_by_key(h.initiator_device_id, "k1")
            .await
            .unwrap()
            .is_some());
        assert!(repo.commit_handoff(h.id, 1200, 50).await.unwrap());
        assert!(!repo.commit_handoff(h.id, 1200, 51).await.unwrap());
        assert!(!repo
            .close_handoff(h.id, "failed", Some("x"), 52)
            .await
            .unwrap());
        let got = repo.get_handoff(h.id).await.unwrap().unwrap();
        assert_eq!(
            (got.status.as_str(), got.acked_position_ms),
            ("committed", Some(1200))
        );
    }

    #[tokio::test]
    async fn expired_handoff_cannot_commit() {
        let repo = SqlxRemoteRepo::new(test_sqlite_pool().await);
        let id = Uuid::new_v4();
        let h = RemoteHandoff {
            id,
            user_id: Uuid::new_v4(),
            initiator_device_id: Uuid::new_v4(),
            request_key: "k".into(),
            source_device_id: Uuid::new_v4(),
            destination_device_id: Uuid::new_v4(),
            media_file_id: Uuid::new_v4(),
            work_id: Uuid::new_v4(),
            snapshot: json!({}),
            status: "pending".into(),
            created_ms: 1,
            expires_ms: 100,
            completed_ms: None,
            acked_position_ms: None,
            failure_reason: None,
        };
        repo.insert_handoff(&h).await.unwrap();
        assert!(!repo.commit_handoff(id, 5, 100).await.unwrap());
    }
}
