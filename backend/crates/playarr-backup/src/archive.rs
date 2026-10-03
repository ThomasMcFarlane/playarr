//! Writing, verifying and extracting the encrypted archive.
//!
//! Layout: age( gzip( tar( manifest.json, files... ) ) ). The manifest is the
//! first entry so a reader knows every expected path, size and checksum before
//! it extracts anything.

use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use age::x25519::{Identity, Recipient};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use sha2::{Digest, Sha256};

use crate::crypto::{decrypt_from, encrypt_to};
use crate::error::{BackupError, Result};
use crate::manifest::{is_safe_relative_path, Manifest, FORMAT_VERSION, MANIFEST_NAME};
use crate::snapshot::HashingWriter;

const MAX_MANIFEST_BYTES: u64 = 32 * 1024 * 1024;

pub struct WrittenArchive {
    pub size: u64,
    pub sha256: String,
}

/// Writes the archive for `manifest`, taking each file listed in it from
/// `stage`. Returns the size and SHA-256 of the bytes that reached `out`.
pub fn write_archive(
    manifest: &Manifest,
    stage: &Path,
    recipients: &[Recipient],
    out: &Path,
) -> Result<WrittenArchive> {
    let file = std::fs::File::create(out)?;
    let hashing = HashingWriter::new(BufWriter::with_capacity(1 << 20, file));
    let encrypted = encrypt_to(recipients, hashing)?;
    let gzip = GzEncoder::new(encrypted, Compression::new(3));
    let mut tar = tar::Builder::new(gzip);

    let manifest_bytes = serde_json::to_vec_pretty(manifest)?;
    append_bytes(&mut tar, MANIFEST_NAME, &manifest_bytes)?;
    for entry in &manifest.files {
        if !is_safe_relative_path(&entry.path) {
            return Err(BackupError::Corrupt(format!(
                "unsafe path in manifest: {}",
                entry.path
            )));
        }
        let mut source = std::fs::File::open(stage.join(&entry.path))?;
        let mut header = tar::Header::new_gnu();
        header.set_size(entry.size);
        header.set_mode(0o600);
        header.set_mtime(0);
        header.set_cksum();
        // Fail if the staged file changed after it was hashed.
        let mut checked = ChecksumReader::new(&mut source, entry.size);
        tar.append_data(&mut header, &entry.path, &mut checked)?;
        checked.verify(&entry.sha256, &entry.path)?;
    }
    let gzip = tar.into_inner()?;
    let encrypted = gzip.finish()?;
    let hashing = encrypted
        .finish()
        .map_err(|error| BackupError::Crypto(error.to_string()))?;
    let (size, sha256, writer) = hashing.finish();
    let file = writer.into_inner().map_err(|e| e.into_error())?;
    file.sync_all()?;
    Ok(WrittenArchive { size, sha256 })
}

fn append_bytes<W: Write>(tar: &mut tar::Builder<W>, name: &str, bytes: &[u8]) -> Result<()> {
    let mut header = tar::Header::new_gnu();
    header.set_size(bytes.len() as u64);
    header.set_mode(0o600);
    header.set_mtime(0);
    header.set_cksum();
    tar.append_data(&mut header, name, bytes)?;
    Ok(())
}

struct ChecksumReader<'a, R: Read> {
    inner: &'a mut R,
    hasher: Sha256,
    read: u64,
    expected: u64,
}

impl<'a, R: Read> ChecksumReader<'a, R> {
    fn new(inner: &'a mut R, expected: u64) -> Self {
        Self {
            inner,
            hasher: Sha256::new(),
            read: 0,
            expected,
        }
    }

    fn verify(self, sha256: &str, name: &str) -> Result<()> {
        if self.read != self.expected || hex::encode(self.hasher.finalize()) != sha256 {
            return Err(BackupError::Corrupt(format!(
                "{name} changed while the archive was being written"
            )));
        }
        Ok(())
    }
}

impl<R: Read> Read for ChecksumReader<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let count = self.inner.read(buf)?;
        self.hasher.update(&buf[..count]);
        self.read += count as u64;
        Ok(count)
    }
}

/// SHA-256 of an existing archive file, for read-back verification.
pub fn sha256_of(path: &Path) -> Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(hex::encode(hasher.finalize()))
}

/// Reads the manifest only (fast path for `inspect`).
pub fn read_manifest(archive: &Path, identities: &[Identity]) -> Result<Manifest> {
    let mut tar = open(archive, identities)?;
    let mut entries = tar.entries().map_err(corrupt)?;
    read_manifest_entry(&mut entries)
}

fn open(
    archive: &Path,
    identities: &[Identity],
) -> Result<tar::Archive<GzDecoder<age::stream::StreamReader<BufReader<std::fs::File>>>>> {
    let file = BufReader::with_capacity(1 << 20, std::fs::File::open(archive)?);
    let decrypted = decrypt_from(identities, file)?;
    Ok(tar::Archive::new(GzDecoder::new(decrypted)))
}

fn corrupt(error: std::io::Error) -> BackupError {
    BackupError::Corrupt(error.to_string())
}

fn read_manifest_entry<R: Read>(entries: &mut tar::Entries<'_, R>) -> Result<Manifest> {
    let mut first = entries
        .next()
        .ok_or_else(|| BackupError::Corrupt("archive is empty".to_string()))?
        .map_err(corrupt)?;
    let path = first.path().map_err(corrupt)?.to_string_lossy().to_string();
    if path != MANIFEST_NAME {
        return Err(BackupError::Corrupt(
            "first archive entry is not the manifest".to_string(),
        ));
    }
    if first.size() > MAX_MANIFEST_BYTES {
        return Err(BackupError::Corrupt(
            "manifest is implausibly large".to_string(),
        ));
    }
    let mut bytes = Vec::new();
    first.read_to_end(&mut bytes).map_err(corrupt)?;
    let manifest: Manifest = serde_json::from_slice(&bytes)?;
    if manifest.format_version != FORMAT_VERSION {
        return Err(BackupError::Incompatible(format!(
            "archive format version {} is not supported (this server reads version {FORMAT_VERSION})",
            manifest.format_version
        )));
    }
    for entry in &manifest.files {
        if !is_safe_relative_path(&entry.path) {
            return Err(BackupError::Corrupt(format!(
                "unsafe path in manifest: {}",
                entry.path
            )));
        }
    }
    Ok(manifest)
}

/// Decrypts and fully validates the archive. When `extract_to` is set every
/// file is written beneath it as it is verified.
pub fn verify_and_extract(
    archive: &Path,
    identities: &[Identity],
    extract_to: Option<&Path>,
) -> Result<Manifest> {
    let mut tar = open(archive, identities)?;
    let mut entries = tar.entries().map_err(corrupt)?;
    let manifest = read_manifest_entry(&mut entries)?;

    let mut seen = std::collections::BTreeSet::new();
    for entry in entries {
        let mut entry = entry.map_err(corrupt)?;
        let path = entry.path().map_err(corrupt)?.to_string_lossy().to_string();
        let expected = manifest
            .files
            .iter()
            .find(|file| file.path == path)
            .ok_or_else(|| BackupError::Corrupt(format!("unexpected archive entry {path}")))?;
        if !seen.insert(path.clone()) {
            return Err(BackupError::Corrupt(format!(
                "duplicate archive entry {path}"
            )));
        }
        if entry.size() != expected.size {
            return Err(BackupError::Corrupt(format!("{path} has the wrong size")));
        }
        let mut sink: Box<dyn Write> = match extract_to {
            Some(root) => {
                let target: PathBuf = root.join(&path);
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                Box::new(BufWriter::new(std::fs::File::create(target)?))
            }
            None => Box::new(std::io::sink()),
        };
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; 256 * 1024];
        let mut total = 0u64;
        loop {
            let count = entry.read(&mut buffer).map_err(corrupt)?;
            if count == 0 {
                break;
            }
            total += count as u64;
            if total > expected.size {
                return Err(BackupError::Corrupt(format!(
                    "{path} is larger than declared"
                )));
            }
            hasher.update(&buffer[..count]);
            sink.write_all(&buffer[..count])?;
        }
        sink.flush()?;
        drop(sink);
        if total != expected.size || hex::encode(hasher.finalize()) != expected.sha256 {
            return Err(BackupError::Corrupt(format!(
                "checksum mismatch for {path}"
            )));
        }
    }
    if let Some(missing) = manifest
        .files
        .iter()
        .find(|file| !seen.contains(&file.path))
    {
        return Err(BackupError::Corrupt(format!(
            "archive is missing {}",
            missing.path
        )));
    }
    Ok(manifest)
}
