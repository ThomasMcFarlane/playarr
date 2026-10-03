//! Serves two certificates on one TLS listener: the static (cert-manager)
//! certificate for the regular public names and the relay certificate for the
//! `v4-A-B-C-D.relay.playarr.app` name, selected by the TLS SNI server name.
//! Both can be replaced at runtime (renewals) without restarting the server.

use std::sync::{Arc, RwLock};

use anyhow::{anyhow, Context};
use rustls::{
    crypto::ring::sign::any_supported_type,
    server::{ClientHello, ResolvesServerCert},
    sign::CertifiedKey,
};
use rustls_pki_types::{pem::PemObject, CertificateDer, PrivateKeyDer};

/// Builds a [`CertifiedKey`] from PEM data. `key_pem` may be the same buffer as
/// `cert_pem` (the relay cache stores the key followed by the chain).
pub fn certified_key_from_pem(cert_pem: &[u8], key_pem: &[u8]) -> anyhow::Result<CertifiedKey> {
    let chain = CertificateDer::pem_slice_iter(cert_pem)
        .collect::<Result<Vec<_>, _>>()
        .context("invalid certificate PEM")?;
    if chain.is_empty() {
        return Err(anyhow!("no certificate found in PEM data"));
    }
    let key = PrivateKeyDer::from_pem_slice(key_pem).context("invalid private key PEM")?;
    let signing_key = any_supported_type(&key).context("unsupported private key type")?;
    Ok(CertifiedKey::new(chain, signing_key))
}

#[derive(Debug)]
pub struct SniCertResolver {
    relay_name: String,
    default: RwLock<Option<Arc<CertifiedKey>>>,
    relay: RwLock<Option<Arc<CertifiedKey>>>,
}

impl SniCertResolver {
    pub fn new(relay_name: String) -> Self {
        Self {
            relay_name,
            default: RwLock::new(None),
            relay: RwLock::new(None),
        }
    }

    pub fn set_default(&self, key: CertifiedKey) {
        *self.default.write().expect("cert lock") = Some(Arc::new(key));
    }

    pub fn set_relay(&self, key: CertifiedKey) {
        *self.relay.write().expect("cert lock") = Some(Arc::new(key));
    }

    /// The relay certificate answers only its own name; every other name, and a
    /// client that sends no SNI, gets the static certificate. Until a
    /// certificate for a name exists the other one is served rather than
    /// failing the handshake.
    pub fn select(&self, server_name: Option<&str>) -> Option<Arc<CertifiedKey>> {
        let relay = self.relay.read().expect("cert lock").clone();
        let default = self.default.read().expect("cert lock").clone();
        let wants_relay =
            server_name.is_some_and(|name| name.eq_ignore_ascii_case(&self.relay_name));
        if wants_relay {
            relay.or(default)
        } else {
            default.or(relay)
        }
    }
}

impl ResolvesServerCert for SniCertResolver {
    fn resolve(&self, client_hello: ClientHello<'_>) -> Option<Arc<CertifiedKey>> {
        self.select(client_hello.server_name())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pems(name: &str) -> (String, String) {
        let key = rcgen::generate_simple_self_signed(vec![name.to_string()]).unwrap();
        (key.cert.pem(), key.signing_key.serialize_pem())
    }

    #[test]
    fn parses_separate_and_combined_pem() {
        let (cert, key) = pems("a.example");
        assert!(certified_key_from_pem(cert.as_bytes(), key.as_bytes()).is_ok());
        let combined = format!("{key}{cert}");
        assert!(certified_key_from_pem(combined.as_bytes(), combined.as_bytes()).is_ok());
        assert!(certified_key_from_pem(b"nope", key.as_bytes()).is_err());
        assert!(certified_key_from_pem(cert.as_bytes(), b"nope").is_err());
    }

    #[test]
    fn selects_by_sni_and_falls_back_to_whichever_exists() {
        let relay_name = "v4-203-0-113-10.relay.playarr.app";
        let resolver = SniCertResolver::new(relay_name.to_string());
        assert!(resolver.select(Some(relay_name)).is_none());

        let (c, k) = pems("playarr-a.example.com");
        resolver.set_default(certified_key_from_pem(c.as_bytes(), k.as_bytes()).unwrap());
        let static_key = resolver.select(None).unwrap();
        // Relay name without a relay certificate yet: static one, not a failure.
        assert!(Arc::ptr_eq(
            &static_key,
            &resolver.select(Some(relay_name)).unwrap()
        ));

        let (c, k) = pems(relay_name);
        resolver.set_relay(certified_key_from_pem(c.as_bytes(), k.as_bytes()).unwrap());
        let relay_key = resolver
            .select(Some("V4-203-0-113-10.relay.playarr.app"))
            .unwrap();
        assert!(!Arc::ptr_eq(&static_key, &relay_key));
        assert!(Arc::ptr_eq(
            &static_key,
            &resolver.select(Some("playarr-a.example.com")).unwrap()
        ));
        assert!(Arc::ptr_eq(&static_key, &resolver.select(None).unwrap()));
    }
}
