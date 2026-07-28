//! Login-time resolution of Playarr Server's three trust tiers into a resolved
//! `User`/`Session`, given the operator's configured [`AuthMode`] and the
//! specifics of one inbound login attempt ([`LoginContext`]).
//!
//! This is a different concern from [`crate::policy`]: that module judges
//! *authorization* (can an already-identified user do X); this module
//! judges *authentication* (who, if anyone, does this request get to
//! become). Like `crate::policy::AccessContext`, `LoginContext` is
//! gathered by the caller (an HTTP handler in `playarr-api`) -- this
//! module only judges it, plus mints the resulting session.

use std::net::IpAddr;

use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use dashmap::DashMap;
use ipnet::IpNet;
use playarr_model::{Device, Session, User};
use uuid::Uuid;

use crate::refresh::{RefreshError, RefreshTokenService};

/// One CIDR range that qualifies for tier-1 (trusted-network) auto-login,
/// and the single account any connection from it resolves to.
#[derive(Debug, Clone)]
pub struct TrustedNetwork {
    pub network: IpNet,
    pub auto_login_user_id: Uuid,
}

/// The operator's server-wide login mode. A Playarr Server instance runs in
/// exactly one of these at a time (set at deployment/config time, not
/// per-request) -- e.g. `FullAccount` for an internet-facing deployment,
/// or `TrustedNetwork` for a home LAN box nothing outside the house can
/// reach.
#[derive(Debug, Clone)]
pub enum AuthMode {
    /// Tier 1: any connection whose source IP falls inside one of
    /// `allowlist`'s ranges is auto-logged-in as that range's bound user,
    /// no credentials required. A source IP outside every range is denied
    /// outright -- this mode does not fall back to a password prompt.
    TrustedNetwork { allowlist: Vec<TrustedNetwork> },
    /// Tier 2: a fixed set of "managed" profiles, switched between with a
    /// short PIN rather than a password (a "who's watching" style flow).
    /// `User` has no separate PIN field -- a managed profile's PIN *is*
    /// its `password_hash`, just deliberately short; provisioning such
    /// users with a short numeric secret is an admin-tool concern outside
    /// this crate.
    ManagedProfiles,
    /// Tier 3: ordinary username + password login.
    FullAccount,
}

#[derive(Debug, Clone, Copy)]
pub struct Credentials<'a> {
    pub username: &'a str,
    pub password: &'a str,
}

#[derive(Debug, Clone, Copy)]
pub struct PinAttempt<'a> {
    pub profile_user_id: Uuid,
    pub pin: &'a str,
}

/// Everything one login attempt needs.
pub struct LoginContext<'a> {
    pub source_ip: IpAddr,
    pub credentials: Option<Credentials<'a>>,
    pub pin: Option<PinAttempt<'a>>,
    /// The device attempting to establish a session. `user_id` is
    /// overwritten by [`evaluate_login`] on success; the caller only needs
    /// to fill in `id`/`platform`/`name`/`client_version` (and can leave
    /// `trusted`/`last_seen_at` at their defaults -- `RefreshTokenService`
    /// sets them).
    pub device: Device,
    pub now: DateTime<Utc>,
}

pub struct LoginOutcome {
    pub user: User,
    pub session: Session,
    pub access_token: String,
}

#[derive(Debug, thiserror::Error)]
pub enum LoginError {
    #[error("credentials required for full-account login")]
    CredentialsRequired,
    #[error("a pin is required for managed-profile login")]
    PinRequired,
    #[error("source ip is not within any trusted network")]
    UntrustedNetwork,
    #[error("invalid username or password")]
    InvalidCredentials,
    #[error("invalid pin")]
    InvalidPin,
    #[error("account is disabled")]
    AccountDisabled,
    #[error("user directory lookup failed: {0}")]
    Directory(String),
    #[error(transparent)]
    Session(#[from] RefreshError),
}

/// Looks up the `User`s that participate in login. Owned by this crate
/// (rather than `playarr-db`, which has no `UserRepo` yet) so
/// `evaluate_login` stays testable behind an in-memory double without
/// pulling in a real database; a real deployment backs this with a
/// `UserRepo`-shaped implementation once one exists.
#[async_trait]
pub trait UserDirectory: Send + Sync {
    async fn find_by_username(&self, username: &str) -> Result<Option<User>, LoginError>;
    async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, LoginError>;
}

/// Verifies a plaintext secret (a password, or a managed-profile PIN)
/// against a stored hash. A trait so tests aren't forced to pay Argon2's
/// deliberately-slow cost and so the hashing algorithm can evolve without
/// touching `evaluate_login`.
pub trait PasswordVerifier: Send + Sync {
    fn verify(&self, candidate: &str, phc_hash: &str) -> bool;
}

/// The real verifier: `password_hash`/PIN values are Argon2id PHC strings.
pub struct Argon2PasswordVerifier;

impl PasswordVerifier for Argon2PasswordVerifier {
    fn verify(&self, candidate: &str, phc_hash: &str) -> bool {
        use argon2::password_hash::PasswordHash;
        use argon2::{Argon2, PasswordVerifier as _};

        let Ok(parsed) = PasswordHash::new(phc_hash) else {
            return false;
        };
        Argon2::default()
            .verify_password(candidate.as_bytes(), &parsed)
            .is_ok()
    }
}

/// Real (not a mock), thread-safe, in-process [`UserDirectory`] -- the same
/// "in-memory is a legitimate choice pending real persistence" idiom as
/// [`crate::refresh::InMemoryRefreshTokenStore`] and
/// [`crate::device_flow::InMemoryDeviceAuthorizationStore`]. There is no
/// `UserRepo`/`users` table anywhere in this workspace yet (see this
/// module's doc comment); the composition root (`playarr-bin`'s
/// `boot_api`) seeds one of these with whatever `User`s a fresh
/// single-node deployment needs (today: exactly one, the default/admin
/// user backing `AuthMode::TrustedNetwork`'s auto-login) rather than
/// leaving [`evaluate_login`] with no `UserDirectory` to resolve a `User`
/// against at all.
///
/// TODO(persistence): once a real `UserRepo`/`users` table exists, replace
/// this with a repo-backed `UserDirectory` implementation; `evaluate_login`
/// itself doesn't need to change, it only depends on the trait.
#[derive(Default)]
pub struct InMemoryUserDirectory {
    by_id: DashMap<Uuid, User>,
    by_username: DashMap<String, Uuid>,
}

impl InMemoryUserDirectory {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_users(users: impl IntoIterator<Item = User>) -> Self {
        let directory = Self::default();
        for user in users {
            directory.insert(user);
        }
        directory
    }

    pub fn insert(&self, user: User) {
        self.by_username.insert(user.username.clone(), user.id);
        self.by_id.insert(user.id, user);
    }
}

#[async_trait]
impl UserDirectory for InMemoryUserDirectory {
    async fn find_by_username(&self, username: &str) -> Result<Option<User>, LoginError> {
        Ok(self
            .by_username
            .get(username)
            .and_then(|id| self.by_id.get(&id).map(|entry| entry.clone())))
    }

    async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, LoginError> {
        Ok(self.by_id.get(&id).map(|entry| entry.clone()))
    }
}

/// Hashes a plaintext password/PIN into the Argon2id PHC string format
/// `User::password_hash` stores. Exposed for tests and for the (currently
/// out-of-scope) user-provisioning code that will eventually call it.
pub fn hash_password(password: &str) -> String {
    use argon2::password_hash::rand_core::OsRng;
    use argon2::password_hash::SaltString;
    use argon2::{Argon2, PasswordHasher};

    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .expect("argon2 hashing with a freshly generated salt does not fail")
        .to_string()
}

/// Resolves one login attempt: picks the trust tier from `mode`, verifies
/// whatever that tier requires, and -- on success -- mints a real session
/// via `sessions` (the same [`RefreshTokenService`] shared with the
/// device-authorization flow and the refresh grant, so all three paths
/// agree on how a `Session`/access token are produced and on
/// `Device::trusted` bookkeeping).
pub async fn evaluate_login(
    mode: &AuthMode,
    ctx: LoginContext<'_>,
    directory: &dyn UserDirectory,
    verifier: &dyn PasswordVerifier,
    sessions: &RefreshTokenService,
    refresh_ttl: Duration,
) -> Result<LoginOutcome, LoginError> {
    let user = match mode {
        AuthMode::TrustedNetwork { allowlist } => {
            let entry = allowlist
                .iter()
                .find(|network| network.network.contains(&ctx.source_ip))
                .ok_or_else(|| {
                    tracing::warn!(
                        source_ip = %ctx.source_ip,
                        allowlist = ?allowlist.iter().map(|n| n.network.to_string()).collect::<Vec<_>>(),
                        "login rejected: source ip is not within any trusted network"
                    );
                    LoginError::UntrustedNetwork
                })?;
            directory
                .find_by_id(entry.auto_login_user_id)
                .await?
                .ok_or_else(|| {
                    LoginError::Directory(format!(
                        "trusted network's auto-login user {} does not exist",
                        entry.auto_login_user_id
                    ))
                })?
        }
        AuthMode::ManagedProfiles => {
            let pin = ctx.pin.ok_or(LoginError::PinRequired)?;
            let user = directory
                .find_by_id(pin.profile_user_id)
                .await?
                .ok_or(LoginError::InvalidPin)?;
            if !verifier.verify(pin.pin, user.password_hash.expose_secret()) {
                return Err(LoginError::InvalidPin);
            }
            user
        }
        AuthMode::FullAccount => {
            let credentials = ctx.credentials.ok_or(LoginError::CredentialsRequired)?;
            let user = directory
                .find_by_username(credentials.username)
                .await?
                .ok_or(LoginError::InvalidCredentials)?;
            if !verifier.verify(credentials.password, user.password_hash.expose_secret()) {
                return Err(LoginError::InvalidCredentials);
            }
            user
        }
    };

    if user.disabled {
        return Err(LoginError::AccountDisabled);
    }

    let mut device = ctx.device;
    device.user_id = user.id;

    let (session, token) = sessions.issue(device, refresh_ttl).await?;

    Ok(LoginOutcome {
        user,
        session,
        access_token: token.access_token,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jwt::JwtIssuer;
    use crate::refresh::InMemoryRefreshTokenStore;
    use crate::test_support::{FakeDeviceRepo, FakeUserDirectory};
    use std::sync::Arc;
    use playarr_db::DeviceRepo;
    use playarr_model::ClientPlatform;
    use playarr_model::Sensitive;

    fn user(username: &str, password: &str, disabled: bool) -> User {
        User {
            id: Uuid::new_v4(),
            username: username.to_string(),
            display_name: username.to_string(),
            email: None,
            password_hash: Sensitive::new(hash_password(password)),
            policy_id: Uuid::new_v4(),
            created_at: Utc::now(),
            disabled,
            preferred_audio_language: playarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
        }
    }

    fn device() -> Device {
        Device {
            id: Uuid::new_v4(),
            user_id: Uuid::nil(),
            name: "test device".to_string(),
            platform: ClientPlatform::Web,
            client_version: "1.0.0".to_string(),
            last_seen_at: None,
            trusted: false,
        }
    }

    fn sessions() -> RefreshTokenService {
        let jwt = Arc::new(JwtIssuer::new(
            b"test-secret-key-at-least-32-bytes!!",
            "playarr",
            Duration::minutes(15),
        ));
        let devices: Arc<dyn DeviceRepo> = Arc::new(FakeDeviceRepo::default());
        let store = Arc::new(InMemoryRefreshTokenStore::new());
        RefreshTokenService::new(store, devices, jwt)
    }

    fn ctx(source_ip: IpAddr) -> LoginContext<'static> {
        LoginContext {
            source_ip,
            credentials: None,
            pin: None,
            device: device(),
            now: Utc::now(),
        }
    }

    #[tokio::test]
    async fn trusted_network_auto_logs_in_matching_source_ip() {
        let directory = FakeUserDirectory::default();
        let auto_user = user("household", "unused", false);
        let auto_user_id = auto_user.id;
        directory.insert(auto_user);

        let mode = AuthMode::TrustedNetwork {
            allowlist: vec![TrustedNetwork {
                network: "10.0.0.0/8".parse().unwrap(),
                auto_login_user_id: auto_user_id,
            }],
        };

        let sessions = sessions();
        let outcome = evaluate_login(
            &mode,
            ctx("10.1.2.3".parse().unwrap()),
            &directory,
            &Argon2PasswordVerifier,
            &sessions,
            Duration::days(30),
        )
        .await
        .unwrap();

        assert_eq!(outcome.user.id, auto_user_id);
        assert!(!outcome.access_token.is_empty());
    }

    #[tokio::test]
    async fn trusted_network_denies_source_ip_outside_allowlist() {
        let directory = FakeUserDirectory::default();
        let mode = AuthMode::TrustedNetwork {
            allowlist: vec![TrustedNetwork {
                network: "10.0.0.0/8".parse().unwrap(),
                auto_login_user_id: Uuid::new_v4(),
            }],
        };

        let sessions = sessions();
        let result = evaluate_login(
            &mode,
            ctx("203.0.113.5".parse().unwrap()),
            &directory,
            &Argon2PasswordVerifier,
            &sessions,
            Duration::days(30),
        )
        .await;

        assert!(matches!(result, Err(LoginError::UntrustedNetwork)));
    }

    #[tokio::test]
    async fn managed_profile_accepts_correct_pin_and_rejects_wrong_one() {
        let directory = FakeUserDirectory::default();
        let profile = user("kid-profile", "4821", false);
        let profile_id = profile.id;
        directory.insert(profile);
        let sessions = sessions();

        let mut good_ctx = ctx("127.0.0.1".parse().unwrap());
        good_ctx.pin = Some(PinAttempt {
            profile_user_id: profile_id,
            pin: "4821",
        });
        let ok = evaluate_login(
            &AuthMode::ManagedProfiles,
            good_ctx,
            &directory,
            &Argon2PasswordVerifier,
            &sessions,
            Duration::days(30),
        )
        .await
        .unwrap();
        assert_eq!(ok.user.id, profile_id);

        let mut bad_ctx = ctx("127.0.0.1".parse().unwrap());
        bad_ctx.pin = Some(PinAttempt {
            profile_user_id: profile_id,
            pin: "0000",
        });
        let err = evaluate_login(
            &AuthMode::ManagedProfiles,
            bad_ctx,
            &directory,
            &Argon2PasswordVerifier,
            &sessions,
            Duration::days(30),
        )
        .await;
        assert!(matches!(err, Err(LoginError::InvalidPin)));
    }

    #[tokio::test]
    async fn managed_profile_requires_a_pin() {
        let directory = FakeUserDirectory::default();
        let sessions = sessions();
        let result = evaluate_login(
            &AuthMode::ManagedProfiles,
            ctx("127.0.0.1".parse().unwrap()),
            &directory,
            &Argon2PasswordVerifier,
            &sessions,
            Duration::days(30),
        )
        .await;
        assert!(matches!(result, Err(LoginError::PinRequired)));
    }

    #[tokio::test]
    async fn full_account_accepts_correct_password_and_rejects_wrong_one() {
        let directory = FakeUserDirectory::default();
        directory.insert(user("alice", "correct horse battery staple", false));
        let sessions = sessions();

        let mut good_ctx = ctx("198.51.100.1".parse().unwrap());
        good_ctx.credentials = Some(Credentials {
            username: "alice",
            password: "correct horse battery staple",
        });
        let ok = evaluate_login(
            &AuthMode::FullAccount,
            good_ctx,
            &directory,
            &Argon2PasswordVerifier,
            &sessions,
            Duration::days(30),
        )
        .await
        .unwrap();
        assert_eq!(ok.user.username, "alice");
        assert_eq!(ok.session.user_id, ok.user.id);
        assert_ne!(ok.session.device_id, Uuid::nil());

        let mut bad_ctx = ctx("198.51.100.1".parse().unwrap());
        bad_ctx.credentials = Some(Credentials {
            username: "alice",
            password: "wrong password",
        });
        let err = evaluate_login(
            &AuthMode::FullAccount,
            bad_ctx,
            &directory,
            &Argon2PasswordVerifier,
            &sessions,
            Duration::days(30),
        )
        .await;
        assert!(matches!(err, Err(LoginError::InvalidCredentials)));
    }

    #[tokio::test]
    async fn full_account_rejects_unknown_username_without_leaking_which_part_was_wrong() {
        let directory = FakeUserDirectory::default();
        let sessions = sessions();
        let mut c = ctx("198.51.100.1".parse().unwrap());
        c.credentials = Some(Credentials {
            username: "ghost",
            password: "whatever",
        });
        let err = evaluate_login(
            &AuthMode::FullAccount,
            c,
            &directory,
            &Argon2PasswordVerifier,
            &sessions,
            Duration::days(30),
        )
        .await;
        assert!(matches!(err, Err(LoginError::InvalidCredentials)));
    }

    #[tokio::test]
    async fn disabled_account_is_denied_even_with_correct_password() {
        let directory = FakeUserDirectory::default();
        directory.insert(user("suspended", "hunter2", true));
        let sessions = sessions();
        let mut c = ctx("198.51.100.1".parse().unwrap());
        c.credentials = Some(Credentials {
            username: "suspended",
            password: "hunter2",
        });
        let err = evaluate_login(
            &AuthMode::FullAccount,
            c,
            &directory,
            &Argon2PasswordVerifier,
            &sessions,
            Duration::days(30),
        )
        .await;
        assert!(matches!(err, Err(LoginError::AccountDisabled)));
    }

    #[tokio::test]
    async fn in_memory_user_directory_finds_by_id_and_username() {
        let directory = InMemoryUserDirectory::new();
        let alice = user("alice", "hunter2", false);
        let alice_id = alice.id;
        directory.insert(alice);

        assert_eq!(
            directory.find_by_id(alice_id).await.unwrap().map(|u| u.id),
            Some(alice_id)
        );
        assert_eq!(
            directory
                .find_by_username("alice")
                .await
                .unwrap()
                .map(|u| u.id),
            Some(alice_id)
        );
        assert!(directory
            .find_by_id(Uuid::new_v4())
            .await
            .unwrap()
            .is_none());
        assert!(directory.find_by_username("ghost").await.unwrap().is_none());
    }
}
