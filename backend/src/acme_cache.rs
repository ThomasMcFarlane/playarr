//! Private, atomic filesystem cache for ACME account and certificate keys.

use std::{
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
};

use async_trait::async_trait;
use rustls_acme::{AccountCache, CertCache};
use sha2::{Digest, Sha256};

/// ACME cache that never relies on the process umask to protect private keys.
pub struct SecureDirCache {
    directory: PathBuf,
}

impl SecureDirCache {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    fn cache_path(&self, kind: &str, values: impl IntoIterator<Item = impl AsRef<str>>) -> PathBuf {
        let mut digest = Sha256::new();
        digest.update(kind.as_bytes());
        for value in values {
            let bytes = value.as_ref().as_bytes();
            digest.update((bytes.len() as u64).to_be_bytes());
            digest.update(bytes);
        }
        self.directory
            .join(format!("{kind}-{}", hex::encode(digest.finalize())))
    }

    async fn read(&self, path: PathBuf) -> io::Result<Option<Vec<u8>>> {
        tokio::task::spawn_blocking(move || match fs::read(path) {
            Ok(contents) => Ok(Some(contents)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        })
        .await
        .map_err(io::Error::other)?
    }

    async fn write(&self, path: PathBuf, contents: Vec<u8>) -> io::Result<()> {
        let directory = self.directory.clone();
        tokio::task::spawn_blocking(move || secure_atomic_write(&directory, &path, &contents))
            .await
            .map_err(io::Error::other)?
    }
}

#[async_trait]
impl CertCache for SecureDirCache {
    type EC = io::Error;

    async fn load_cert(
        &self,
        domains: &[String],
        directory_url: &str,
    ) -> Result<Option<Vec<u8>>, Self::EC> {
        let values = domains
            .iter()
            .map(String::as_str)
            .chain(std::iter::once(directory_url));
        self.read(self.cache_path("certificate", values)).await
    }

    async fn store_cert(
        &self,
        domains: &[String],
        directory_url: &str,
        certificate: &[u8],
    ) -> Result<(), Self::EC> {
        let values = domains
            .iter()
            .map(String::as_str)
            .chain(std::iter::once(directory_url));
        self.write(self.cache_path("certificate", values), certificate.to_vec())
            .await
    }
}

#[async_trait]
impl AccountCache for SecureDirCache {
    type EA = io::Error;

    async fn load_account(
        &self,
        contact: &[String],
        directory_url: &str,
    ) -> Result<Option<Vec<u8>>, Self::EA> {
        let values = contact
            .iter()
            .map(String::as_str)
            .chain(std::iter::once(directory_url));
        self.read(self.cache_path("account", values)).await
    }

    async fn store_account(
        &self,
        contact: &[String],
        directory_url: &str,
        account: &[u8],
    ) -> Result<(), Self::EA> {
        let values = contact
            .iter()
            .map(String::as_str)
            .chain(std::iter::once(directory_url));
        self.write(self.cache_path("account", values), account.to_vec())
            .await
    }
}

fn secure_atomic_write(directory: &Path, destination: &Path, contents: &[u8]) -> io::Result<()> {
    fs::create_dir_all(directory)?;
    set_private_directory_permissions(directory)?;

    let mut temporary = tempfile::Builder::new()
        .prefix(".acme-")
        .tempfile_in(directory)?;
    temporary.write_all(contents)?;
    temporary.as_file().sync_all()?;
    set_private_file_permissions(temporary.path())?;
    temporary
        .persist(destination)
        .map_err(|error| error.error)?;
    set_private_file_permissions(destination)?;
    sync_directory(directory)
}

#[cfg(unix)]
fn set_private_directory_permissions(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn set_private_directory_permissions(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn account_and_certificate_cache_round_trip() {
        let directory = tempfile::tempdir().unwrap();
        let cache = SecureDirCache::new(directory.path().join("acme"));
        let contacts = vec!["mailto:admin@example.com".to_string()];
        let domains = vec!["streamarr.example.com".to_string()];

        cache
            .store_account(&contacts, "https://acme.example/directory", b"account-key")
            .await
            .unwrap();
        cache
            .store_cert(
                &domains,
                "https://acme.example/directory",
                b"certificate-key",
            )
            .await
            .unwrap();

        assert_eq!(
            cache
                .load_account(&contacts, "https://acme.example/directory")
                .await
                .unwrap(),
            Some(b"account-key".to_vec())
        );
        assert_eq!(
            cache
                .load_cert(&domains, "https://acme.example/directory")
                .await
                .unwrap(),
            Some(b"certificate-key".to_vec())
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cache_forces_private_permissions_and_leaves_no_temporary_files() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let cache_directory = directory.path().join("acme");
        let cache = SecureDirCache::new(cache_directory.clone());
        let domains = vec!["streamarr.example.com".to_string()];

        cache
            .store_cert(&domains, "https://acme.example/directory", b"first")
            .await
            .unwrap();
        cache
            .store_cert(&domains, "https://acme.example/directory", b"second")
            .await
            .unwrap();

        assert_eq!(
            fs::metadata(&cache_directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        let files = fs::read_dir(&cache_directory)
            .unwrap()
            .map(|entry| entry.unwrap())
            .collect::<Vec<_>>();
        assert_eq!(files.len(), 1);
        assert_eq!(
            files[0].metadata().unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(fs::read(files[0].path()).unwrap(), b"second");
    }
}
