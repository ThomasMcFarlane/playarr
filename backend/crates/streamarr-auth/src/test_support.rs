//! In-memory test doubles shared by this crate's unit tests. Not part of
//! the public API -- compiled only under `#[cfg(test)]` (see `lib.rs`).

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use streamarr_db::{DbError, DeviceRepo};
use streamarr_model::{Device, User};
use uuid::Uuid;

use crate::login::{LoginError, UserDirectory};

/// In-memory [`DeviceRepo`] double: real `async_trait` semantics, no
/// database.
#[derive(Default)]
pub(crate) struct FakeDeviceRepo {
    devices: DashMap<Uuid, Device>,
}

#[async_trait]
impl DeviceRepo for FakeDeviceRepo {
    async fn get(&self, id: Uuid) -> Result<Device, DbError> {
        self.devices
            .get(&id)
            .map(|entry| entry.clone())
            .ok_or(DbError::NotFound)
    }

    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<Device>, DbError> {
        Ok(self
            .devices
            .iter()
            .filter(|entry| entry.user_id == user_id)
            .map(|entry| entry.clone())
            .collect())
    }

    async fn upsert(&self, device: &Device) -> Result<(), DbError> {
        self.devices.insert(device.id, device.clone());
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        self.devices.remove(&id);
        Ok(())
    }

    async fn touch_last_seen(&self, id: Uuid, at: DateTime<Utc>) -> Result<(), DbError> {
        match self.devices.get_mut(&id) {
            Some(mut entry) => {
                entry.last_seen_at = Some(at);
                Ok(())
            }
            None => Err(DbError::NotFound),
        }
    }
}

/// In-memory [`UserDirectory`] double, keyed by both id and username.
#[derive(Default)]
pub(crate) struct FakeUserDirectory {
    users: DashMap<Uuid, User>,
    by_username: DashMap<String, Uuid>,
}

impl FakeUserDirectory {
    pub(crate) fn insert(&self, user: User) {
        self.by_username.insert(user.username.clone(), user.id);
        self.users.insert(user.id, user);
    }
}

#[async_trait]
impl UserDirectory for FakeUserDirectory {
    async fn find_by_username(&self, username: &str) -> Result<Option<User>, LoginError> {
        Ok(self
            .by_username
            .get(username)
            .and_then(|id| self.users.get(&id).map(|entry| entry.clone())))
    }

    async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, LoginError> {
        Ok(self.users.get(&id).map(|entry| entry.clone()))
    }
}
