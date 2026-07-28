//! [`RepoBackedUserDirectory`] -- the real, `playarr_db::UserRepo`-backed
//! [`playarr_auth::UserDirectory`] implementation `playarr-bin`'s
//! `boot_api` wires into production, replacing
//! `playarr_auth::login::InMemoryUserDirectory`'s in-memory stand-in now
//! that real `User` persistence exists. Mirrors
//! [`crate::playback::RepoBackedMediaFileLookup`]'s "thin adapter over a
//! `playarr-db` repo trait" pattern in this same crate -- unlike that
//! adapter, though, `UserDirectory::find_by_username`/`find_by_id` both
//! return `Result<Option<User>, LoginError>` rather than collapsing a
//! backend error into `None`, so a lookup miss and a real database failure
//! stay distinguishable to `evaluate_login`'s callers.

use std::sync::Arc;

use async_trait::async_trait;
use playarr_auth::{LoginError, UserDirectory};
use playarr_model::User;
use uuid::Uuid;

/// Delegates both [`UserDirectory`] lookups straight to the wrapped
/// [`playarr_db::UserRepo`], mapping any backend failure
/// (`playarr_db::DbError`) to `LoginError::Directory` -- that's
/// `evaluate_login`'s only room for a repo-level error; a lookup *miss* is
/// `Ok(None)` on both traits, not an error, and passes straight through
/// unchanged.
pub struct RepoBackedUserDirectory {
    repo: Arc<dyn playarr_db::UserRepo>,
}

impl RepoBackedUserDirectory {
    pub fn new(repo: Arc<dyn playarr_db::UserRepo>) -> Self {
        Self { repo }
    }
}

#[async_trait]
impl UserDirectory for RepoBackedUserDirectory {
    async fn find_by_username(&self, username: &str) -> Result<Option<User>, LoginError> {
        self.repo
            .find_by_username(username)
            .await
            .map_err(|err| LoginError::Directory(err.to_string()))
    }

    async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, LoginError> {
        self.repo
            .find_by_id(id)
            .await
            .map_err(|err| LoginError::Directory(err.to_string()))
    }
}
