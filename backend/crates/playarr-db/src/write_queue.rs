//! A small shared write queue: many callers, one SQLite commit.
//!
//! SQLite with `synchronous = FULL` (kept on purpose, no data-loss trade-off)
//! syncs the disk once per commit, about 50 ms on local disk. Frequent small
//! writes (watch-progress heartbeats, poller updates) each paid that cost on
//! their own. [`WriteQueue`] runs one writer task that takes whatever is queued
//! (up to [`WriteQueueConfig::max_ops`] operations, or until
//! [`WriteQueueConfig::max_wait`] has passed) and commits it as one
//! transaction, so a burst shares a single sync.
//!
//! # Durability
//!
//! [`WriteQueue::submit`] resolves only after the transaction holding the
//! operation has committed (or after the operation failed). Nothing is
//! acknowledged early. A caller that is dropped while waiting (for example a
//! disconnected HTTP client) does not cancel its write: it still commits.
//!
//! # Error isolation
//!
//! Every operation runs inside its own savepoint, so a failing operation is
//! rolled back alone and returns its own error; its neighbours still commit
//! together. If the commit itself fails, every operation that had succeeded is
//! re-run in a fresh transaction of its own, so one bad write cannot fail the
//! others and each caller gets its own result. Operations are therefore
//! `FnMut` and must be safe to run again.
//!
//! # Coalescing
//!
//! [`WriteQueue::submit_latest`] takes a key and a rank. Operations with the
//! same key inside one batch collapse to the one with the highest rank (the
//! later submission wins a tie); the others are not run. This is only for
//! idempotent "latest value wins" upserts: a watch-progress heartbeat for the
//! same user and item overwrites the previous position, and the SQL itself
//! only accepts a row with a newer `updated_at`, so running the older
//! heartbeats first would change nothing. A superseded caller resolves with the
//! outcome of the operation that replaced it, after that one has committed.
//!
//! # Back-pressure and shutdown
//!
//! The channel is bounded. When it is full, `submit` waits for room; nothing
//! is dropped. [`WriteQueue::shutdown`] stops accepting new work, drains
//! everything already queued, commits it and then returns.
//!
//! # Metrics
//!
//! [`WriteQueue::stats`] returns counters (batches, operations, coalesced and
//! failed operations, batch size, commit time, queue depth). A batch whose
//! commit takes at least [`WriteQueueConfig::slow_commit`] logs a
//! `slow write batch` warning next to sqlx's own `slow statement` warnings, and
//! a `write queue` summary is logged at info level while there is traffic.

use std::collections::HashMap;
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures::FutureExt;
use sqlx::{Acquire, AnyConnection};
use tokio::sync::{mpsc, oneshot};

use crate::error::DbError;
use crate::pool::DbPool;

/// The future an operation returns. Borrows the transaction's connection.
pub type WriteFuture<'c, T> = Pin<Box<dyn Future<Output = Result<T, DbError>> + Send + 'c>>;

/// Tuning for a [`WriteQueue`].
#[derive(Debug, Clone)]
pub struct WriteQueueConfig {
    /// Bounded channel size; a full channel makes `submit` wait.
    pub capacity: usize,
    /// Most operations committed in one transaction.
    pub max_ops: usize,
    /// How long the writer waits for more work after the first operation of a
    /// batch arrives (it never waits when the batch is already full).
    pub max_wait: Duration,
    /// A batch commit at least this slow logs a `slow write batch` warning.
    pub slow_commit: Duration,
    /// How often the info summary is logged (only while there was traffic).
    pub summary_interval: Duration,
}

impl Default for WriteQueueConfig {
    fn default() -> Self {
        Self {
            capacity: 1024,
            max_ops: 64,
            max_wait: Duration::from_millis(5),
            slow_commit: Duration::from_secs(1),
            summary_interval: Duration::from_secs(60),
        }
    }
}

/// A snapshot of the queue's counters.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WriteQueueStats {
    /// Transactions the writer has committed (or attempted).
    pub batches: u64,
    /// Operations submitted.
    pub ops: u64,
    /// Operations that were replaced by a newer one with the same key.
    pub coalesced: u64,
    /// Operations that returned an error to their caller.
    pub failed: u64,
    /// Batches whose shared commit failed and fell back to per-operation commits.
    pub commit_fallbacks: u64,
    /// Largest number of submitted operations in one batch.
    pub max_batch: u64,
    /// Total time spent in `COMMIT`, in microseconds.
    pub commit_micros_total: u64,
    /// Slowest `COMMIT`, in microseconds.
    pub commit_micros_max: u64,
    /// Operations submitted and not yet picked up by the writer.
    pub queue_depth: usize,
}

#[derive(Default)]
struct Counters {
    batches: AtomicU64,
    ops: AtomicU64,
    coalesced: AtomicU64,
    failed: AtomicU64,
    commit_fallbacks: AtomicU64,
    max_batch: AtomicU64,
    commit_micros_total: AtomicU64,
    commit_micros_max: AtomicU64,
    depth: AtomicUsize,
}

type CoalesceKey = String;

trait ErasedOp: Send {
    fn key(&self) -> Option<&CoalesceKey>;
    fn rank(&self) -> i64;
    /// Gives a replaced operation the value it resolves with.
    fn mark_superseded(&mut self);
    fn run<'c>(&'c mut self, conn: &'c mut AnyConnection) -> WriteFuture<'c, ()>;
    fn finish(self: Box<Self>, outcome: Result<(), DbError>);
}

struct TypedOp<T, F> {
    f: F,
    key: Option<CoalesceKey>,
    rank: i64,
    out: Option<T>,
    superseded_value: Option<T>,
    reply: oneshot::Sender<Result<T, DbError>>,
}

impl<T, F> ErasedOp for TypedOp<T, F>
where
    T: Send + 'static,
    F: for<'c> FnMut(&'c mut AnyConnection) -> WriteFuture<'c, T> + Send + 'static,
{
    fn key(&self) -> Option<&CoalesceKey> {
        self.key.as_ref()
    }

    fn rank(&self) -> i64 {
        self.rank
    }

    fn mark_superseded(&mut self) {
        self.out = self.superseded_value.take();
    }

    fn run<'c>(&'c mut self, conn: &'c mut AnyConnection) -> WriteFuture<'c, ()> {
        Box::pin(async move {
            let value = (self.f)(conn).await?;
            self.out = Some(value);
            Ok(())
        })
    }

    fn finish(self: Box<Self>, outcome: Result<(), DbError>) {
        let this = *self;
        let result = match outcome {
            Ok(()) => match this.out {
                Some(value) => Ok(value),
                None => Err(derived_error("write operation produced no result")),
            },
            Err(err) => Err(err),
        };
        // The caller may have gone away; the write has still been committed.
        let _ = this.reply.send(result);
    }
}

fn derived_error(message: &str) -> DbError {
    DbError::Backend(sqlx::Error::Protocol(message.to_owned()))
}

struct Shared {
    sender: Mutex<Option<mpsc::Sender<Box<dyn ErasedOp>>>>,
    worker: Mutex<Option<tokio::task::JoinHandle<()>>>,
    counters: Arc<Counters>,
}

/// Cloneable handle to the shared write queue. See the module docs.
#[derive(Clone)]
pub struct WriteQueue {
    shared: Arc<Shared>,
}

impl WriteQueue {
    /// Starts the writer task on the current Tokio runtime.
    pub fn spawn(pool: DbPool, config: WriteQueueConfig) -> Self {
        let (tx, rx) = mpsc::channel(config.capacity.max(1));
        let counters = Arc::new(Counters::default());
        let worker = tokio::spawn(run_writer(pool, rx, config, counters.clone()));
        Self {
            shared: Arc::new(Shared {
                sender: Mutex::new(Some(tx)),
                worker: Mutex::new(Some(worker)),
                counters,
            }),
        }
    }

    /// Runs `f` inside the next batch's transaction and resolves with its
    /// result once that transaction has committed.
    pub async fn submit<T, F>(&self, f: F) -> Result<T, DbError>
    where
        T: Send + 'static,
        F: for<'c> FnMut(&'c mut AnyConnection) -> WriteFuture<'c, T> + Send + 'static,
    {
        self.enqueue(f, None, 0, None).await
    }

    /// Like [`submit`](Self::submit) for an idempotent "latest value wins"
    /// write. Operations with the same `key` in one batch collapse to the one
    /// with the highest `rank` (later submission on a tie). See the module docs.
    pub async fn submit_latest<F>(
        &self,
        key: impl Into<String>,
        rank: i64,
        f: F,
    ) -> Result<(), DbError>
    where
        F: for<'c> FnMut(&'c mut AnyConnection) -> WriteFuture<'c, ()> + Send + 'static,
    {
        self.enqueue(f, Some(key.into()), rank, Some(())).await
    }

    async fn enqueue<T, F>(
        &self,
        f: F,
        key: Option<CoalesceKey>,
        rank: i64,
        superseded_value: Option<T>,
    ) -> Result<T, DbError>
    where
        T: Send + 'static,
        F: for<'c> FnMut(&'c mut AnyConnection) -> WriteFuture<'c, T> + Send + 'static,
    {
        let sender = self
            .shared
            .sender
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .ok_or_else(|| derived_error("write queue is shut down"))?;
        let (reply, answer) = oneshot::channel();
        let op: Box<dyn ErasedOp> = Box::new(TypedOp {
            f,
            key,
            rank,
            out: None,
            superseded_value,
            reply,
        });
        let counters = &self.shared.counters;
        counters.ops.fetch_add(1, Ordering::Relaxed);
        counters.depth.fetch_add(1, Ordering::Relaxed);
        // A full channel makes this wait: back-pressure, nothing is dropped.
        if sender.send(op).await.is_err() {
            counters.depth.fetch_sub(1, Ordering::Relaxed);
            return Err(derived_error("write queue is shut down"));
        }
        answer
            .await
            .unwrap_or_else(|_| Err(derived_error("write queue stopped before answering")))
    }

    /// Current counters.
    pub fn stats(&self) -> WriteQueueStats {
        let c = &self.shared.counters;
        WriteQueueStats {
            batches: c.batches.load(Ordering::Relaxed),
            ops: c.ops.load(Ordering::Relaxed),
            coalesced: c.coalesced.load(Ordering::Relaxed),
            failed: c.failed.load(Ordering::Relaxed),
            commit_fallbacks: c.commit_fallbacks.load(Ordering::Relaxed),
            max_batch: c.max_batch.load(Ordering::Relaxed),
            commit_micros_total: c.commit_micros_total.load(Ordering::Relaxed),
            commit_micros_max: c.commit_micros_max.load(Ordering::Relaxed),
            queue_depth: c.depth.load(Ordering::Relaxed),
        }
    }

    /// Stops accepting new work, then drains and commits everything already
    /// queued before returning. Safe to call more than once and from any clone.
    pub async fn shutdown(&self) {
        self.shared
            .sender
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        let worker = self
            .shared
            .worker
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(worker) = worker {
            let _ = worker.await;
        }
    }
}

/// Runs `f` through `queue` when there is one; otherwise directly, in its own
/// transaction on `pool`. Repositories use this so they behave the same with or
/// without a queue (tests, tools and the CLI run without one).
pub async fn write<T, F>(queue: Option<&WriteQueue>, pool: &DbPool, mut f: F) -> Result<T, DbError>
where
    T: Send + 'static,
    F: for<'c> FnMut(&'c mut AnyConnection) -> WriteFuture<'c, T> + Send + 'static,
{
    match queue {
        Some(queue) => queue.submit(f).await,
        None => {
            let mut tx = pool.begin().await?;
            let value = f(&mut tx).await?;
            tx.commit().await?;
            Ok(value)
        }
    }
}

/// [`write`] for an idempotent latest-value-wins write; see
/// [`WriteQueue::submit_latest`]. Without a queue it simply runs.
pub async fn write_latest<F>(
    queue: Option<&WriteQueue>,
    pool: &DbPool,
    key: impl Into<String>,
    rank: i64,
    f: F,
) -> Result<(), DbError>
where
    F: for<'c> FnMut(&'c mut AnyConnection) -> WriteFuture<'c, ()> + Send + 'static,
{
    match queue {
        Some(queue) => queue.submit_latest(key, rank, f).await,
        None => write(None, pool, f).await,
    }
}

async fn run_writer(
    pool: DbPool,
    mut rx: mpsc::Receiver<Box<dyn ErasedOp>>,
    config: WriteQueueConfig,
    counters: Arc<Counters>,
) {
    let max_ops = config.max_ops.max(1);
    let mut summary = SummaryWindow::new();
    // `recv` yields every queued operation before it reports the channel
    // closed, so shutdown drains the queue.
    while let Some(first) = rx.recv().await {
        let mut batch = vec![first];
        let deadline = Instant::now() + config.max_wait;
        while batch.len() < max_ops {
            match rx.try_recv() {
                Ok(op) => batch.push(op),
                Err(mpsc::error::TryRecvError::Disconnected) => break,
                Err(mpsc::error::TryRecvError::Empty) => {
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        break;
                    }
                    match tokio::time::timeout(remaining, rx.recv()).await {
                        Ok(Some(op)) => batch.push(op),
                        Ok(None) | Err(_) => break,
                    }
                }
            }
        }
        counters.depth.fetch_sub(batch.len(), Ordering::Relaxed);
        let report = process_batch(&pool, batch, &counters).await;
        let depth = counters.depth.load(Ordering::Relaxed);
        if report.commit >= config.slow_commit {
            tracing::warn!(
                batch_size = report.submitted,
                executed = report.executed,
                commit_ms = report.commit.as_millis() as u64,
                queue_depth = depth,
                slow_threshold = ?config.slow_commit,
                "slow write batch: commit time exceeded alert threshold"
            );
        } else {
            tracing::debug!(
                batch_size = report.submitted,
                executed = report.executed,
                commit_ms = report.commit.as_millis() as u64,
                queue_depth = depth,
                "write batch committed"
            );
        }
        summary.record(&report);
        summary.maybe_log(config.summary_interval, depth);
    }
    summary.log(0);
}

struct BatchReport {
    submitted: usize,
    executed: usize,
    commit: Duration,
}

struct SummaryWindow {
    since: Instant,
    batches: u64,
    ops: u64,
    commit: Duration,
    max_commit: Duration,
}

impl SummaryWindow {
    fn new() -> Self {
        Self {
            since: Instant::now(),
            batches: 0,
            ops: 0,
            commit: Duration::ZERO,
            max_commit: Duration::ZERO,
        }
    }

    fn record(&mut self, report: &BatchReport) {
        self.batches += 1;
        self.ops += report.submitted as u64;
        self.commit += report.commit;
        self.max_commit = self.max_commit.max(report.commit);
    }

    fn maybe_log(&mut self, interval: Duration, depth: usize) {
        if self.since.elapsed() >= interval {
            self.log(depth);
        }
    }

    fn log(&mut self, depth: usize) {
        if self.batches > 0 {
            tracing::info!(
                window_s = self.since.elapsed().as_secs(),
                batches = self.batches,
                ops = self.ops,
                avg_batch = self.ops / self.batches,
                avg_commit_ms = (self.commit / self.batches as u32).as_millis() as u64,
                max_commit_ms = self.max_commit.as_millis() as u64,
                queue_depth = depth,
                "write queue"
            );
        }
        *self = Self::new();
    }
}

async fn process_batch(
    pool: &DbPool,
    batch: Vec<Box<dyn ErasedOp>>,
    counters: &Counters,
) -> BatchReport {
    let submitted = batch.len();

    // Coalesce: per key keep the highest rank (the later one on a tie).
    let mut winner: HashMap<&CoalesceKey, usize> = HashMap::new();
    for (index, op) in batch.iter().enumerate() {
        if let Some(key) = op.key() {
            match winner.get(key) {
                Some(&current) if batch[current].rank() > op.rank() => {}
                _ => {
                    winner.insert(key, index);
                }
            }
        }
    }
    let superseded_by: Vec<Option<usize>> = batch
        .iter()
        .enumerate()
        .map(
            |(index, op)| match op.key().and_then(|key| winner.get(key)) {
                Some(&win) if win != index => Some(win),
                _ => None,
            },
        )
        .collect();
    drop(winner);

    let mut active: Vec<(usize, Box<dyn ErasedOp>)> = Vec::new();
    let mut superseded: Vec<(Box<dyn ErasedOp>, usize)> = Vec::new();
    for (index, op) in batch.into_iter().enumerate() {
        match superseded_by[index] {
            Some(win) => superseded.push((op, win)),
            None => active.push((index, op)),
        }
    }
    counters
        .coalesced
        .fetch_add(superseded.len() as u64, Ordering::Relaxed);
    counters.batches.fetch_add(1, Ordering::Relaxed);
    counters
        .max_batch
        .fetch_max(submitted as u64, Ordering::Relaxed);

    let executed = active.len();
    let (mut outcomes, commit) = execute_batch(pool, &mut active, counters).await;

    // Resolve superseded callers from their replacement's outcome.
    let survivor_error: HashMap<usize, Option<String>> = active
        .iter()
        .zip(outcomes.iter())
        .map(|((index, _), outcome)| (*index, outcome.as_ref().err().map(|e| e.to_string())))
        .collect();
    for (mut op, win) in superseded {
        let outcome = match survivor_error.get(&win) {
            Some(Some(message)) => Err(derived_error(&format!(
                "coalesced write was replaced by one that failed: {message}"
            ))),
            _ => Ok(()),
        };
        if outcome.is_err() {
            counters.failed.fetch_add(1, Ordering::Relaxed);
        } else {
            op.mark_superseded();
        }
        op.finish(outcome);
    }
    for ((_, op), outcome) in active.into_iter().zip(outcomes.drain(..)) {
        if outcome.is_err() {
            counters.failed.fetch_add(1, Ordering::Relaxed);
        }
        op.finish(outcome);
    }

    BatchReport {
        submitted,
        executed,
        commit,
    }
}

/// Runs the active operations in one transaction (one savepoint each) and
/// commits once. Returns one outcome per operation, in order, and the time
/// the commit took.
async fn execute_batch(
    pool: &DbPool,
    active: &mut [(usize, Box<dyn ErasedOp>)],
    counters: &Counters,
) -> (Vec<Result<(), DbError>>, Duration) {
    let mut tx = match pool.begin_with("BEGIN IMMEDIATE").await {
        Ok(tx) => tx,
        Err(err) => {
            let message = format!("could not begin write transaction: {err}");
            return (
                active
                    .iter()
                    .map(|_| Err(derived_error(&message)))
                    .collect(),
                Duration::ZERO,
            );
        }
    };

    let mut outcomes: Vec<Result<(), DbError>> = Vec::with_capacity(active.len());
    for (_, op) in active.iter_mut() {
        outcomes.push(run_in_savepoint(&mut tx, op.as_mut()).await);
    }

    let started = Instant::now();
    let committed = tx.commit().await;
    let mut commit = started.elapsed();
    record_commit(counters, commit);

    if let Err(err) = committed {
        tracing::warn!(error = %err, "shared write commit failed; retrying each write in its own transaction");
        counters.commit_fallbacks.fetch_add(1, Ordering::Relaxed);
        for ((_, op), outcome) in active.iter_mut().zip(outcomes.iter_mut()) {
            if outcome.is_err() {
                continue;
            }
            let (retry, took) = run_alone(pool, op.as_mut()).await;
            *outcome = retry;
            commit += took;
        }
    }
    (outcomes, commit)
}

async fn run_in_savepoint(
    tx: &mut sqlx::Transaction<'static, sqlx::Any>,
    op: &mut dyn ErasedOp,
) -> Result<(), DbError> {
    let mut savepoint = tx.begin().await?;
    let result = AssertUnwindSafe(op.run(&mut savepoint))
        .catch_unwind()
        .await;
    match result {
        Ok(Ok(())) => {
            savepoint.commit().await?;
            Ok(())
        }
        Ok(Err(err)) => {
            let _ = savepoint.rollback().await;
            Err(err)
        }
        Err(_) => {
            let _ = savepoint.rollback().await;
            Err(derived_error("write operation panicked"))
        }
    }
}

async fn run_alone(pool: &DbPool, op: &mut dyn ErasedOp) -> (Result<(), DbError>, Duration) {
    let mut tx = match pool.begin_with("BEGIN IMMEDIATE").await {
        Ok(tx) => tx,
        Err(err) => return (Err(err.into()), Duration::ZERO),
    };
    let result = AssertUnwindSafe(op.run(&mut tx)).catch_unwind().await;
    match result {
        Ok(Ok(())) => {
            let started = Instant::now();
            let committed = tx.commit().await;
            (committed.map_err(DbError::from), started.elapsed())
        }
        Ok(Err(err)) => {
            let _ = tx.rollback().await;
            (Err(err), Duration::ZERO)
        }
        Err(_) => {
            let _ = tx.rollback().await;
            (
                Err(derived_error("write operation panicked")),
                Duration::ZERO,
            )
        }
    }
}

fn record_commit(counters: &Counters, took: Duration) {
    let micros = took.as_micros() as u64;
    counters
        .commit_micros_total
        .fetch_add(micros, Ordering::Relaxed);
    counters
        .commit_micros_max
        .fetch_max(micros, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use tokio::sync::Notify;
    use uuid::Uuid;

    struct TestDb {
        pool: DbPool,
        path: std::path::PathBuf,
    }

    impl Drop for TestDb {
        fn drop(&mut self) {
            for suffix in ["", "-wal", "-shm"] {
                let _ = std::fs::remove_file(format!("{}{suffix}", self.path.display()));
            }
        }
    }

    /// A file database with the production pragmas (WAL, synchronous FULL)
    /// and a scratch table `w`.
    async fn test_db() -> TestDb {
        let path = std::env::temp_dir().join(format!("playarr-wq-{}.db", Uuid::new_v4()));
        let pool = crate::pool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        sqlx::query("CREATE TABLE w (id INTEGER PRIMARY KEY, v TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        TestDb { pool, path }
    }

    /// Pins a closure to the higher-ranked operation signature.
    fn hr<F>(f: F) -> F
    where
        F: for<'c> FnMut(&'c mut AnyConnection) -> WriteFuture<'c, ()> + Send + 'static,
    {
        f
    }

    fn insert(
        id: i64,
        v: &'static str,
    ) -> impl for<'c> FnMut(&'c mut AnyConnection) -> WriteFuture<'c, ()> + Send + 'static {
        move |conn| {
            Box::pin(async move {
                sqlx::query("INSERT INTO w (id, v) VALUES (?, ?)")
                    .bind(id)
                    .bind(v)
                    .execute(&mut *conn)
                    .await?;
                Ok(())
            })
        }
    }

    async fn count(pool: &DbPool) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM w")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    fn slow_config() -> WriteQueueConfig {
        WriteQueueConfig {
            max_wait: Duration::from_millis(300),
            ..WriteQueueConfig::default()
        }
    }

    /// The caller resolves only after the transaction holding its write has
    /// committed: while the operation is still open, a second connection sees
    /// nothing and the caller is still waiting; once it resolves, the row is
    /// visible to everyone.
    #[tokio::test]
    async fn caller_resolves_only_after_commit() {
        let db = test_db().await;
        let queue = WriteQueue::spawn(db.pool.clone(), WriteQueueConfig::default());
        let gate = Arc::new(Notify::new());
        let held = gate.clone();
        let submit = tokio::spawn({
            let queue = queue.clone();
            async move {
                queue
                    .submit(move |conn| {
                        let held = held.clone();
                        Box::pin(async move {
                            sqlx::query("INSERT INTO w (id, v) VALUES (1, 'a')")
                                .execute(&mut *conn)
                                .await?;
                            held.notified().await;
                            Ok(())
                        })
                    })
                    .await
            }
        });
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert!(!submit.is_finished(), "must not acknowledge before commit");
        assert_eq!(count(&db.pool).await, 0, "uncommitted write is invisible");
        gate.notify_one();
        submit.await.unwrap().unwrap();
        assert_eq!(count(&db.pool).await, 1, "visible once acknowledged");
        queue.shutdown().await;
    }

    #[tokio::test]
    async fn a_failing_write_is_isolated_from_its_neighbours() {
        let db = test_db().await;
        let queue = WriteQueue::spawn(db.pool.clone(), slow_config());
        let bad = hr(|conn| {
            Box::pin(async move {
                // The first statement succeeds, the second violates the key:
                // the whole operation, including the first row, is undone.
                sqlx::query("INSERT INTO w (id, v) VALUES (50, 'half')")
                    .execute(&mut *conn)
                    .await?;
                sqlx::query("INSERT INTO w (id, v) VALUES (1, 'dup')")
                    .execute(&mut *conn)
                    .await?;
                Ok(())
            })
        });
        let (a, b, c) = tokio::join!(
            queue.submit(insert(1, "a")),
            queue.submit(bad),
            queue.submit(insert(3, "c")),
        );
        assert!(a.is_ok());
        let err = b.expect_err("the bad write returns its own error");
        assert!(err.is_constraint_violation(), "{err}");
        assert!(c.is_ok());
        assert_eq!(count(&db.pool).await, 2);
        let half: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM w WHERE id = 50")
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(half, 0, "a failed write leaves no partial rows");
        let stats = queue.stats();
        assert_eq!(stats.batches, 1, "the three shared one batch");
        assert_eq!(stats.failed, 1);
        queue.shutdown().await;
    }

    #[tokio::test]
    async fn a_panicking_write_fails_alone_and_the_queue_keeps_working() {
        let db = test_db().await;
        let queue = WriteQueue::spawn(db.pool.clone(), slow_config());
        let boom = hr(|_conn| Box::pin(async move { panic!("op panic") }));
        let (a, b) = tokio::join!(queue.submit(insert(1, "a")), queue.submit(boom));
        assert!(a.is_ok());
        assert!(b.is_err());
        queue.submit(insert(2, "b")).await.unwrap();
        assert_eq!(count(&db.pool).await, 2);
        queue.shutdown().await;
    }

    /// Heartbeats for one key in one batch collapse to the highest rank; only
    /// that write runs, and every caller is acknowledged after it commits.
    #[tokio::test]
    async fn same_key_writes_in_a_batch_coalesce_to_the_latest() {
        let db = test_db().await;
        sqlx::query("INSERT INTO w (id, v) VALUES (1, '0')")
            .execute(&db.pool)
            .await
            .unwrap();
        let queue = WriteQueue::spawn(db.pool.clone(), slow_config());
        let runs = Arc::new(AtomicUsize::new(0));
        let ranks = [3_i64, 9, 1, 7, 5];
        let calls = ranks.iter().map(|rank| {
            let runs = runs.clone();
            let rank = *rank;
            queue.submit_latest("user:item", rank, move |conn| {
                let runs = runs.clone();
                Box::pin(async move {
                    runs.fetch_add(1, Ordering::SeqCst);
                    sqlx::query("UPDATE w SET v = ? WHERE id = 1")
                        .bind(rank.to_string())
                        .execute(&mut *conn)
                        .await?;
                    Ok(())
                })
            })
        });
        for result in futures::future::join_all(calls).await {
            result.unwrap();
        }
        assert_eq!(runs.load(Ordering::SeqCst), 1);
        let v: String = sqlx::query_scalar("SELECT v FROM w WHERE id = 1")
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(v, "9");
        let stats = queue.stats();
        assert_eq!(stats.coalesced, 4);
        assert_eq!(stats.batches, 1);
        queue.shutdown().await;
    }

    #[tokio::test]
    async fn different_keys_do_not_coalesce() {
        let db = test_db().await;
        let queue = WriteQueue::spawn(db.pool.clone(), slow_config());
        let (a, b) = tokio::join!(
            queue.submit_latest("k1", 1, insert(1, "a")),
            queue.submit_latest("k2", 1, insert(2, "b")),
        );
        a.unwrap();
        b.unwrap();
        assert_eq!(count(&db.pool).await, 2);
        assert_eq!(queue.stats().coalesced, 0);
        queue.shutdown().await;
    }

    /// A full channel makes callers wait; nothing is dropped.
    #[tokio::test]
    async fn a_full_queue_applies_back_pressure_without_dropping_writes() {
        let db = test_db().await;
        let queue = WriteQueue::spawn(
            db.pool.clone(),
            WriteQueueConfig {
                capacity: 1,
                max_ops: 1,
                ..WriteQueueConfig::default()
            },
        );
        let gate = Arc::new(Notify::new());
        let held = gate.clone();
        let first = tokio::spawn({
            let queue = queue.clone();
            async move {
                queue
                    .submit(move |conn| {
                        let held = held.clone();
                        Box::pin(async move {
                            sqlx::query("INSERT INTO w (id, v) VALUES (0, 'x')")
                                .execute(&mut *conn)
                                .await?;
                            held.notified().await;
                            Ok(())
                        })
                    })
                    .await
            }
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        // One write is running; one fits in the channel; the rest must wait.
        let rest: Vec<_> = (1..=4)
            .map(|id| {
                let queue = queue.clone();
                tokio::spawn(async move { queue.submit(insert(id, "x")).await })
            })
            .collect();
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert!(rest.iter().all(|h| !h.is_finished()));
        assert!(queue.stats().queue_depth >= 4, "{:?}", queue.stats());
        gate.notify_one();
        first.await.unwrap().unwrap();
        for handle in rest {
            handle.await.unwrap().unwrap();
        }
        assert_eq!(count(&db.pool).await, 5, "every waiting write was kept");
        queue.shutdown().await;
    }

    #[tokio::test]
    async fn shutdown_drains_queued_writes_and_then_refuses_new_ones() {
        let db = test_db().await;
        let queue = WriteQueue::spawn(db.pool.clone(), slow_config());
        let pending: Vec<_> = (0..20)
            .map(|id| {
                let queue = queue.clone();
                tokio::spawn(async move { queue.submit(insert(id, "x")).await })
            })
            .collect();
        tokio::time::sleep(Duration::from_millis(20)).await;
        queue.shutdown().await;
        for handle in pending {
            handle.await.unwrap().unwrap();
        }
        assert_eq!(count(&db.pool).await, 20);
        assert!(queue.submit(insert(99, "late")).await.is_err());
    }

    /// Evidence for the batching (run with `--ignored --nocapture`): 500
    /// concurrent small writes through the queue versus one commit each, on a
    /// file database with the production pragmas.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore]
    async fn bench_queue_versus_single_commits() {
        let db = test_db().await;
        let t = Instant::now();
        for id in 0..500_i64 {
            sqlx::query("INSERT INTO w (id, v) VALUES (?, 'x')")
                .bind(id)
                .execute(&db.pool)
                .await
                .unwrap();
        }
        let single = t.elapsed();

        let queue = WriteQueue::spawn(db.pool.clone(), WriteQueueConfig::default());
        let t = Instant::now();
        let tasks: Vec<_> = (1000..1500_i64)
            .map(|id| {
                let queue = queue.clone();
                tokio::spawn(async move {
                    let started = Instant::now();
                    queue.submit(insert(id, "x")).await.unwrap();
                    started.elapsed()
                })
            })
            .collect();
        let mut latencies = Vec::new();
        for task in tasks {
            latencies.push(task.await.unwrap());
        }
        let queued = t.elapsed();
        latencies.sort();
        let stats = queue.stats();
        println!(
            "500 writes: one commit each {single:?}; queue {queued:?} in {} commits \
             (max batch {}); per-write latency p50 {:?} p99 {:?}",
            stats.batches, stats.max_batch, latencies[250], latencies[495],
        );
        queue.shutdown().await;
    }
}
