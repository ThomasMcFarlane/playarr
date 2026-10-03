//! ACME DNS-01 for `v4-A-B-C-D.relay.playarr.app` using the Playarr Worker as
//! the DNS provider (`relay::Dns01Provider`), so a relay node needs neither
//! port 80 nor a DNS server of its own.
//!
//! `rustls-acme` (used for HTTP-01) cannot do DNS-01, so this module drives
//! `instant-acme` directly and shares the same private on-disk cache
//! (`SecureDirCache`): the certificate file uses the same "private key PEM
//! followed by certificate chain PEM" layout, so switching between HTTP-01 and
//! DNS-01 reuses a still-valid certificate.

use std::{sync::Arc, time::Duration};

use anyhow::{anyhow, bail, Context};
use instant_acme::{
    Account, AccountCredentials, AuthorizationStatus, ChallengeType, Identifier, LetsEncrypt,
    NewAccount, NewOrder, OrderStatus, RetryPolicy,
};
use rustls_acme::{AccountCache, CertCache};

use crate::{acme_cache::SecureDirCache, relay::Dns01Provider};

/// A certificate plus the validity window needed to decide when to renew it.
#[derive(Debug, Clone)]
pub struct IssuedCertificate {
    /// Private key PEM followed by the certificate chain PEM.
    pub pem: Vec<u8>,
    pub not_before: i64,
    pub not_after: i64,
}

impl IssuedCertificate {
    pub fn parse(pem: Vec<u8>) -> Option<Self> {
        let certificate = x509_parser::pem::Pem::iter_from_buffer(&pem)
            .filter_map(Result::ok)
            .find(|block| block.label == "CERTIFICATE")?;
        let (_, parsed) = x509_parser::parse_x509_certificate(&certificate.contents).ok()?;
        let validity = parsed.validity();
        Some(Self {
            not_before: validity.not_before.timestamp(),
            not_after: validity.not_after.timestamp(),
            pem,
        })
    }

    pub fn is_expired(&self, now: i64) -> bool {
        now >= self.not_after
    }

    /// Renew once less than a third of the lifetime remains, as Let's Encrypt
    /// recommends, so the same rule works for 90, 64 or 6 day certificates.
    pub fn needs_renewal(&self, now: i64) -> bool {
        let lifetime = (self.not_after - self.not_before).max(1);
        self.not_after - now < lifetime / 3
    }
}

pub struct CertificateManager {
    domain: String,
    production: bool,
    contact: Vec<String>,
    cache: SecureDirCache,
    provider: Arc<dyn Dns01Provider>,
    propagation_delay: Duration,
}

impl CertificateManager {
    pub fn new(
        domain: String,
        production: bool,
        contact: Option<String>,
        cache: SecureDirCache,
        provider: Arc<dyn Dns01Provider>,
    ) -> Self {
        Self {
            domain,
            production,
            contact: contact.into_iter().collect(),
            cache,
            provider,
            propagation_delay: Duration::from_secs(5),
        }
    }

    fn directory_url(&self) -> &'static str {
        if self.production {
            LetsEncrypt::Production.url()
        } else {
            LetsEncrypt::Staging.url()
        }
    }

    /// Account credentials live under a key distinct from `rustls-acme`'s, as
    /// the two libraries serialise accounts differently.
    fn account_key(&self) -> String {
        format!("{}#instant-acme", self.directory_url())
    }

    pub async fn load_cached(&self) -> Option<IssuedCertificate> {
        let domains = [self.domain.clone()];
        let pem = self
            .cache
            .load_cert(&domains, self.directory_url())
            .await
            .ok()??;
        IssuedCertificate::parse(pem)
    }

    async fn account(&self) -> anyhow::Result<Account> {
        let key = self.account_key();
        if let Some(bytes) = self.cache.load_account(&self.contact, &key).await? {
            if let Ok(credentials) = serde_json::from_slice::<AccountCredentials>(&bytes) {
                return Ok(Account::builder()?.from_credentials(credentials).await?);
            }
            tracing::warn!("cached ACME account is unreadable; registering a new one");
        }
        let contacts: Vec<&str> = self.contact.iter().map(String::as_str).collect();
        let (account, credentials) = Account::builder()?
            .create(
                &NewAccount {
                    contact: &contacts,
                    terms_of_service_agreed: true,
                    only_return_existing: false,
                },
                self.directory_url().to_owned(),
                None,
            )
            .await?;
        self.cache
            .store_account(&self.contact, &key, &serde_json::to_vec(&credentials)?)
            .await?;
        Ok(account)
    }

    /// Issues a certificate for the relay name and stores it in the cache.
    pub async fn issue(&self) -> anyhow::Result<IssuedCertificate> {
        let account = self.account().await?;
        let mut order = account
            .new_order(&NewOrder::new(&[Identifier::Dns(self.domain.clone())]))
            .await?;
        let mut published: Vec<(String, String)> = Vec::new();
        let outcome = self.complete_order(&mut order, &mut published).await;
        // Always tidy the TXT records, whether or not the order succeeded.
        for (name, value) in &published {
            if let Err(error) = self.provider.clear_txt(name, value).await {
                tracing::warn!(error = %error, "could not remove DNS-01 TXT record; the daily cleanup will");
            }
        }
        let (key_pem, chain_pem) = outcome?;
        let pem = format!("{key_pem}\n{chain_pem}").into_bytes();
        let issued = IssuedCertificate::parse(pem.clone())
            .ok_or_else(|| anyhow!("ACME returned a certificate that could not be parsed"))?;
        self.cache
            .store_cert(
                std::slice::from_ref(&self.domain),
                self.directory_url(),
                &pem,
            )
            .await?;
        Ok(issued)
    }

    async fn complete_order(
        &self,
        order: &mut instant_acme::Order,
        published: &mut Vec<(String, String)>,
    ) -> anyhow::Result<(String, String)> {
        let mut authorizations = order.authorizations();
        while let Some(result) = authorizations.next().await {
            let mut authorization = result?;
            match authorization.status {
                AuthorizationStatus::Pending => {}
                AuthorizationStatus::Valid => continue,
                other => bail!("ACME authorisation is {other:?}"),
            }
            let mut challenge = authorization
                .challenge(ChallengeType::Dns01)
                .ok_or_else(|| anyhow!("the ACME server offered no DNS-01 challenge"))?;
            let name = format!("_acme-challenge.{}", challenge.identifier());
            let value = challenge.key_authorization().dns_value();
            self.provider
                .set_txt(&name, &value)
                .await
                .context("publishing the DNS-01 TXT record through the relay")?;
            published.push((name, value));
            tokio::time::sleep(self.propagation_delay).await;
            challenge.set_ready().await?;
        }

        let status = order.poll_ready(&RetryPolicy::default()).await?;
        if status != OrderStatus::Ready {
            bail!("ACME order ended as {status:?}");
        }
        let key_pem = order.finalize().await?;
        let chain_pem = order.poll_certificate(&RetryPolicy::default()).await?;
        Ok((key_pem, chain_pem))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn certificate(not_before: i64, not_after: i64) -> Vec<u8> {
        let key = rcgen::KeyPair::generate().unwrap();
        let mut params =
            rcgen::CertificateParams::new(vec!["v4-203-0-113-10.relay.playarr.app".to_string()])
                .unwrap();
        params.not_before = time_from(not_before);
        params.not_after = time_from(not_after);
        let certificate = params.self_signed(&key).unwrap();
        format!("{}\n{}", key.serialize_pem(), certificate.pem()).into_bytes()
    }

    fn time_from(timestamp: i64) -> time::OffsetDateTime {
        time::OffsetDateTime::from_unix_timestamp(timestamp).unwrap()
    }

    #[test]
    fn parses_validity_and_decides_renewal_at_one_third_remaining() {
        let day = 86_400;
        let start = 1_800_000_000;
        let issued = IssuedCertificate::parse(certificate(start, start + 90 * day)).unwrap();
        assert!((issued.not_after - issued.not_before - 90 * day).abs() <= 1);
        assert!(!issued.needs_renewal(start + 59 * day));
        assert!(issued.needs_renewal(start + 61 * day));
        assert!(!issued.is_expired(start + 89 * day));
        assert!(issued.is_expired(start + 91 * day));
    }

    #[test]
    fn rejects_garbage_cache_entries() {
        assert!(IssuedCertificate::parse(b"not a certificate".to_vec()).is_none());
    }

    #[tokio::test]
    async fn the_cached_key_and_chain_load_into_the_rustls_config() {
        let day = 86_400;
        let start = 1_800_000_000;
        let pem = certificate(start, start + 90 * day);
        // The combined buffer is passed as both arguments, exactly as the
        // serving code does.
        axum_server::tls_rustls::RustlsConfig::from_pem(pem.clone(), pem)
            .await
            .expect("combined key and chain PEM must load");
    }
}
