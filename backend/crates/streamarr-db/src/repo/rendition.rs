use async_trait::async_trait;
use streamarr_model::{Rendition, RenditionStatus};
use uuid::Uuid;

use crate::error::DbError;
use crate::pool::DbPool;

/// CRUD surface over [`streamarr_model::Rendition`] — the derived,
/// playback-ready encodes of a [`streamarr_model::MediaFile`]. This is the
/// table both the Tdarr background pipeline (`streamarr-transcode`'s
/// `TdarrDispatcher`) and the on-demand transcode path write into, so the
/// direct-play decision (`TranscodeOrchestrator::find_existing_rendition`)
/// can find a ready rendition regardless of which path produced it.
#[async_trait]
pub trait RenditionRepo: Send + Sync {
    async fn get(&self, id: Uuid) -> Result<Rendition, DbError>;

    async fn list_for_media_file(&self, media_file_id: Uuid) -> Result<Vec<Rendition>, DbError>;

    /// Finds a `Ready` rendition for `media_file_id` matching `profile`, if
    /// one exists — the query `find_existing_rendition` in
    /// `streamarr-transcode` is built around.
    async fn find_ready(
        &self,
        media_file_id: Uuid,
        profile: &str,
    ) -> Result<Option<Rendition>, DbError>;

    async fn upsert(&self, rendition: &Rendition) -> Result<(), DbError>;

    async fn delete(&self, id: Uuid) -> Result<(), DbError>;

    async fn mark_status(&self, id: Uuid, status: RenditionStatus) -> Result<(), DbError>;
}

pub struct SqlxRenditionRepo {
    pool: DbPool,
}

impl SqlxRenditionRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl RenditionRepo for SqlxRenditionRepo {
    async fn get(&self, _id: Uuid) -> Result<Rendition, DbError> {
        // SELECT * FROM renditions WHERE id = $1
        let _ = &self.pool;
        unimplemented!("SqlxRenditionRepo::get")
    }

    async fn list_for_media_file(&self, _media_file_id: Uuid) -> Result<Vec<Rendition>, DbError> {
        // SELECT * FROM renditions WHERE media_file_id = $1 ORDER BY produced_at DESC
        unimplemented!("SqlxRenditionRepo::list_for_media_file")
    }

    async fn find_ready(
        &self,
        _media_file_id: Uuid,
        _profile: &str,
    ) -> Result<Option<Rendition>, DbError> {
        // SELECT * FROM renditions
        // WHERE media_file_id = $1 AND profile = $2 AND status = 'ready'
        // ORDER BY produced_at DESC LIMIT 1
        unimplemented!("SqlxRenditionRepo::find_ready")
    }

    async fn upsert(&self, _rendition: &Rendition) -> Result<(), DbError> {
        // INSERT INTO renditions (...) VALUES (...) ON CONFLICT (id) DO UPDATE SET ...
        unimplemented!("SqlxRenditionRepo::upsert")
    }

    async fn delete(&self, _id: Uuid) -> Result<(), DbError> {
        // DELETE FROM renditions WHERE id = $1
        unimplemented!("SqlxRenditionRepo::delete")
    }

    async fn mark_status(&self, _id: Uuid, _status: RenditionStatus) -> Result<(), DbError> {
        // UPDATE renditions SET status = $2 WHERE id = $1
        unimplemented!("SqlxRenditionRepo::mark_status")
    }
}
