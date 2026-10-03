//! Recovery-key handling. Backups are encrypted to age X25519 public keys, so
//! the server holds no secret that could decrypt them; the matching identity
//! is generated offline and kept by the administrator.

use std::io::{Read, Write};
use std::path::Path;

use age::secrecy::ExposeSecret;
pub use age::x25519::Identity;
use age::x25519::Recipient;
use sha2::{Digest, Sha256};

use crate::error::{BackupError, Result};

/// A freshly generated key pair. `secret` is the only copy that can decrypt
/// backups; callers must write it to a protected file and never log it.
pub struct GeneratedKey {
    pub secret: String,
    pub public: String,
}

pub fn generate_key() -> GeneratedKey {
    let identity = Identity::generate();
    GeneratedKey {
        secret: identity.to_string().expose_secret().to_string(),
        public: identity.to_public().to_string(),
    }
}

pub fn parse_recipients<S: AsRef<str>>(raw: &[S]) -> Result<Vec<Recipient>> {
    let mut recipients = Vec::new();
    for item in raw {
        let item = item.as_ref().trim();
        if item.is_empty() {
            continue;
        }
        let recipient: Recipient = item.parse().map_err(|_| {
            BackupError::Config(
                "PLAYARR_BACKUP_RECIPIENTS must hold age public keys (age1...)".to_string(),
            )
        })?;
        recipients.push(recipient);
    }
    if recipients.is_empty() {
        return Err(BackupError::Config(
            "at least one backup recipient (age public key) is required".to_string(),
        ));
    }
    Ok(recipients)
}

/// Short, non-secret identifier shown in the Admin UI so an administrator can
/// confirm which recovery key a backup was made for.
pub fn fingerprint(recipient: &Recipient) -> String {
    let digest = Sha256::digest(recipient.to_string().as_bytes());
    hex::encode(&digest[..6])
}

/// Reads `AGE-SECRET-KEY-1...` lines from an identity file, ignoring comments.
pub fn read_identity_file(path: &Path) -> Result<Vec<Identity>> {
    let text = std::fs::read_to_string(path)?;
    let mut identities = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let identity: Identity = line.parse().map_err(|_| {
            BackupError::Config("identity file does not contain an age secret key".to_string())
        })?;
        identities.push(identity);
    }
    if identities.is_empty() {
        return Err(BackupError::Config(
            "identity file contains no secret key".to_string(),
        ));
    }
    Ok(identities)
}

pub fn encrypt_to<W: Write>(
    recipients: &[Recipient],
    out: W,
) -> Result<age::stream::StreamWriter<W>> {
    let encryptor = age::Encryptor::with_recipients(
        recipients
            .iter()
            .map(|recipient| recipient as &dyn age::Recipient),
    )
    .map_err(|error| BackupError::Crypto(error.to_string()))?;
    encryptor
        .wrap_output(out)
        .map_err(|error| BackupError::Crypto(error.to_string()))
}

pub fn decrypt_from<R: Read>(
    identities: &[Identity],
    input: R,
) -> Result<age::stream::StreamReader<R>> {
    let decryptor =
        age::Decryptor::new(input).map_err(|error| BackupError::Corrupt(error.to_string()))?;
    decryptor
        .decrypt(
            identities
                .iter()
                .map(|identity| identity as &dyn age::Identity),
        )
        .map_err(|error| match error {
            age::DecryptError::NoMatchingKeys | age::DecryptError::InvalidHeader => {
                BackupError::WrongKey
            }
            other => BackupError::Corrupt(other.to_string()),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_wrong_key() {
        let key = generate_key();
        let other = generate_key();
        let recipients = parse_recipients(std::slice::from_ref(&key.public)).unwrap();
        let mut buffer = Vec::new();
        let mut writer = encrypt_to(&recipients, &mut buffer).unwrap();
        writer.write_all(b"secret payload").unwrap();
        writer.finish().unwrap();
        assert!(!buffer.windows(6).any(|window| window == b"secret"));

        let identity: Identity = key.secret.parse().unwrap();
        let mut plain = String::new();
        decrypt_from(&[identity], buffer.as_slice())
            .unwrap()
            .read_to_string(&mut plain)
            .unwrap();
        assert_eq!(plain, "secret payload");

        let wrong: Identity = other.secret.parse().unwrap();
        assert!(matches!(
            decrypt_from(&[wrong], buffer.as_slice()),
            Err(BackupError::WrongKey)
        ));
    }

    #[test]
    fn rejects_empty_and_malformed_recipients() {
        assert!(parse_recipients::<&str>(&[]).is_err());
        assert!(parse_recipients(&["not-a-key"]).is_err());
    }
}
