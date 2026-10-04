//! Declarative reconciliation of `source_instances.base_url` at boot.
//!
//! `PLAYARR_SOURCE_INSTANCE_URLS` maps a source kind (optionally narrowed by
//! instance name) to the base URL it must use, e.g.
//!
//! ```text
//! radarr=http://radarr.media.svc.cluster.local:7878,sonarr/Anime=http://sonarr-anime:8989
//! ```
//!
//! Entries are separated by commas or newlines. `kind=url` applies to every
//! non-deleted instance of that kind; `kind/name=url` (name matched
//! case-insensitively) applies to one instance and wins over a bare `kind`.
//! Applied idempotently before the registry hydrates, so a deployment can
//! move an *arr app (for example into the cluster) without an admin token or a
//! database edit. Only `base_url` is written: API keys and every other
//! field are carried through untouched, and logs name hosts only.
//!
//! Dubarr is the one kind that is also *created* declaratively: when a
//! `dubarr=<url>` entry and `PLAYARR_DUBARR_API_KEY` are both set, boot ensures
//! exactly one Dubarr instance exists with that URL and key (an existing one has
//! its key brought in line). Without the key variable Dubarr behaves like any
//! other kind (URL reconciliation only).

use std::sync::Arc;

use playarr_db::SourceInstanceRepo;
use playarr_model::{SourceInstance, SourceKind};

pub const ENV_VAR: &str = "PLAYARR_SOURCE_INSTANCE_URLS";
/// API key for the declaratively managed Dubarr instance (see [`ensure_dubarr`]).
pub const DUBARR_KEY_ENV_VAR: &str = "PLAYARR_DUBARR_API_KEY";
const DUBARR_DEFAULT_NAME: &str = "Dubarr";
/// Fixed id of the declaratively created Dubarr instance. Source instances
/// replicate between peers by id, so two nodes that each created their own
/// random-id row on first boot ended up listing Dubarr twice on both. With one
/// well-known id they converge on a single row instead.
pub const DUBARR_INSTANCE_ID: uuid::Uuid =
    uuid::Uuid::from_u128(0x6475_6261_7272_4000_8000_706c_6179_6172);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UrlOverride {
    pub kind: SourceKind,
    pub name: Option<String>,
    pub base_url: String,
}

fn parse_kind(raw: &str) -> Option<SourceKind> {
    Some(match raw.to_ascii_lowercase().as_str() {
        "sonarr" => SourceKind::Sonarr,
        "radarr" => SourceKind::Radarr,
        "lidarr" => SourceKind::Lidarr,
        "bazarr" => SourceKind::Bazarr,
        "prowlarr" => SourceKind::Prowlarr,
        "readarr" => SourceKind::Readarr,
        "whisparr" => SourceKind::Whisparr,
        "dubarr" => SourceKind::Dubarr,
        _ => return None,
    })
}

/// Parses the env value. Errors name the offending entry's selector only,
/// never the URL.
pub fn parse(raw: &str) -> Result<Vec<UrlOverride>, String> {
    let mut out = Vec::new();
    for entry in raw
        .split([',', '\n'])
        .map(str::trim)
        .filter(|e| !e.is_empty())
    {
        let (selector, url) = entry
            .split_once('=')
            .ok_or_else(|| "entry is missing '=' (expected kind[/name]=url)".to_string())?;
        let (kind_raw, name) = match selector.split_once('/') {
            Some((k, n)) if !n.trim().is_empty() => (k.trim(), Some(n.trim().to_string())),
            Some((k, _)) => (k.trim(), None),
            None => (selector.trim(), None),
        };
        let kind = parse_kind(kind_raw)
            .ok_or_else(|| format!("unknown source kind {kind_raw:?} in selector"))?;
        let url = url.trim().trim_end_matches('/');
        if !(url.starts_with("http://") || url.starts_with("https://")) || url.len() < 9 {
            return Err(format!(
                "selector {selector:?} needs an http(s):// base URL"
            ));
        }
        out.push(UrlOverride {
            kind,
            name,
            base_url: url.to_string(),
        });
    }
    Ok(out)
}

fn host_of(url: &str) -> &str {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let authority = rest.split('/').next().unwrap_or(rest);
    authority.rsplit('@').next().unwrap_or(authority)
}

fn wanted<'a>(instance: &SourceInstance, overrides: &'a [UrlOverride]) -> Option<&'a UrlOverride> {
    let matching = overrides.iter().filter(|o| o.kind == instance.kind);
    matching
        .clone()
        .find(|o| {
            o.name
                .as_ref()
                .is_some_and(|n| n.eq_ignore_ascii_case(&instance.name))
        })
        .or_else(|| matching.into_iter().find(|o| o.name.is_none()))
}

/// Returns how many rows were changed.
pub async fn reconcile(
    repo: &Arc<dyn SourceInstanceRepo>,
    overrides: &[UrlOverride],
) -> Result<usize, playarr_db::DbError> {
    if overrides.is_empty() {
        return Ok(0);
    }
    let mut changed = 0;
    for instance in repo.list_all().await? {
        let Some(o) = wanted(&instance, overrides) else {
            continue;
        };
        if instance.base_url.trim_end_matches('/') == o.base_url {
            continue;
        }
        tracing::info!(
            source_instance_id = %instance.id,
            source_kind = ?instance.kind,
            old_host = host_of(&instance.base_url),
            new_host = host_of(&o.base_url),
            "reconciling source instance base_url from {ENV_VAR}"
        );
        let mut updated = instance.clone();
        updated.base_url = o.base_url.clone();
        repo.upsert(&updated).await?;
        changed += 1;
    }
    Ok(changed)
}

/// Ensures the Dubarr instance named by a bare `dubarr=<url>` override exists with
/// `api_key`. Returns true when a row was created or changed. A second Dubarr
/// instance added by hand is left alone: only the first one is managed.
pub async fn ensure_dubarr(
    repo: &Arc<dyn SourceInstanceRepo>,
    overrides: &[UrlOverride],
    api_key: &str,
) -> Result<bool, playarr_db::DbError> {
    let api_key = api_key.trim();
    let Some(o) = overrides
        .iter()
        .find(|o| o.kind == SourceKind::Dubarr && o.name.is_none())
    else {
        return Ok(false);
    };
    if api_key.is_empty() {
        return Ok(false);
    }
    dedupe_dubarr(repo).await?;
    let existing = repo
        .list_all()
        .await?
        .into_iter()
        .find(|i| i.kind == SourceKind::Dubarr);
    let mut row = match existing {
        Some(i) if i.api_key_encrypted.expose_secret() == api_key => return Ok(false),
        Some(i) => i,
        None => SourceInstance {
            id: DUBARR_INSTANCE_ID,
            kind: SourceKind::Dubarr,
            name: DUBARR_DEFAULT_NAME.into(),
            base_url: o.base_url.clone(),
            api_key_encrypted: playarr_model::Sensitive::new(String::new()),
            priority: 10,
            default_root_folder_id: None,
            folder_mappings: Default::default(),
            default_quality_profile_id: None,
            best_effort: true,
            group_library_id: None,
        },
    };
    row.api_key_encrypted = playarr_model::Sensitive::new(api_key.to_string());
    tracing::info!(
        source_instance_id = %row.id,
        host = host_of(&row.base_url),
        "ensuring Dubarr source instance from {DUBARR_KEY_ENV_VAR}"
    );
    repo.upsert(&row).await?;
    Ok(true)
}

/// Collapses Dubarr instances that point at the same base URL (typically one
/// created locally plus one replicated from a peer that did the same before ids
/// were fixed) to a single row: [`DUBARR_INSTANCE_ID`] if present, otherwise the
/// lowest id, so every node picks the same survivor. The others are soft-deleted,
/// which replicates as a tombstone. Dubarr instances with different URLs are
/// never touched. Returns how many rows were removed.
pub async fn dedupe_dubarr(
    repo: &Arc<dyn SourceInstanceRepo>,
) -> Result<usize, playarr_db::DbError> {
    let norm = |u: &str| u.trim().trim_end_matches('/').to_ascii_lowercase();
    let all: Vec<SourceInstance> = repo
        .list_all()
        .await?
        .into_iter()
        .filter(|i| i.kind == SourceKind::Dubarr)
        .collect();
    let mut removed = 0;
    for i in &all {
        let url = norm(&i.base_url);
        let keeper = all
            .iter()
            .filter(|o| norm(&o.base_url) == url)
            .min_by_key(|o| (o.id != DUBARR_INSTANCE_ID, o.id))
            .map(|o| o.id);
        if keeper != Some(i.id) {
            tracing::info!(
                source_instance_id = %i.id,
                host = host_of(&i.base_url),
                "removing duplicate Dubarr source instance"
            );
            repo.delete(i.id).await?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// Reads [`ENV_VAR`] and reconciles; failures are logged, never fatal.
pub async fn reconcile_from_env(repo: &Arc<dyn SourceInstanceRepo>) {
    let Ok(raw) = std::env::var(ENV_VAR) else {
        return;
    };
    match parse(&raw) {
        Err(err) => tracing::error!(%err, "ignoring invalid {ENV_VAR}"),
        Ok(overrides) => {
            match ensure_dubarr_from_env(repo, &overrides).await {
                Ok(true) => tracing::info!("Dubarr source instance ensured"),
                Ok(false) => {}
                Err(err) => tracing::error!(%err, "failed to ensure the Dubarr source instance"),
            }
            match reconcile(repo, &overrides).await {
                Ok(n) => {
                    tracing::info!(changed = n, entries = overrides.len(), "{ENV_VAR} applied")
                }
                Err(err) => tracing::error!(%err, "failed to apply {ENV_VAR}"),
            }
        }
    }
}

async fn ensure_dubarr_from_env(
    repo: &Arc<dyn SourceInstanceRepo>,
    overrides: &[UrlOverride],
) -> Result<bool, playarr_db::DbError> {
    match std::env::var(DUBARR_KEY_ENV_VAR) {
        Ok(key) => ensure_dubarr(repo, overrides, &key).await,
        Err(_) => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_kinds_names_and_trims() {
        let o = parse(" radarr=http://r:7878/ ,\nSonarr/Anime=https://s:8989").unwrap();
        assert_eq!(o.len(), 2);
        assert_eq!(
            o[0],
            UrlOverride {
                kind: SourceKind::Radarr,
                name: None,
                base_url: "http://r:7878".into()
            }
        );
        assert_eq!(o[1].kind, SourceKind::Sonarr);
        assert_eq!(o[1].name.as_deref(), Some("Anime"));
    }

    #[test]
    fn rejects_bad_entries_without_echoing_url() {
        assert!(parse("radarr").is_err());
        assert!(parse("nope=http://x").is_err());
        let err = parse("radarr=ftp://secret-host").unwrap_err();
        assert!(!err.contains("secret-host"));
        assert!(parse("").unwrap().is_empty());
    }

    #[test]
    fn host_strips_scheme_path_and_userinfo() {
        assert_eq!(host_of("http://user:pw@h:1/p"), "h:1");
        assert_eq!(host_of("http://203.0.113.10:7878"), "203.0.113.10:7878");
    }

    async fn repo() -> Arc<dyn SourceInstanceRepo> {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        sqlx::any::install_default_drivers();
        let pool: playarr_db::DbPool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect(&format!(
                "sqlite://playarr_bin_source_urls_test_{n}?mode=memory&cache=shared"
            ))
            .await
            .expect("open in-memory sqlite pool");
        playarr_db::run_migrations(&pool, false)
            .await
            .expect("migrate");
        Arc::new(playarr_db::repo::SqlxSourceInstanceRepo::new(pool))
    }

    fn inst(kind: SourceKind, name: &str, url: &str) -> SourceInstance {
        SourceInstance {
            id: uuid::Uuid::new_v4(),
            kind,
            name: name.into(),
            base_url: url.into(),
            api_key_encrypted: playarr_model::Sensitive::new("keep-me".to_string()),
            priority: 3,
            default_root_folder_id: None,
            folder_mappings: Default::default(),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: None,
        }
    }

    #[tokio::test]
    async fn reconcile_rewrites_only_matching_urls_idempotently_keeping_keys() {
        let repo = repo().await;
        let r1 = inst(SourceKind::Radarr, "Radarr", "http://203.0.113.10:7878");
        let s1 = inst(SourceKind::Sonarr, "Main", "http://203.0.113.10:8989");
        let s2 = inst(SourceKind::Sonarr, "Anime", "http://203.0.113.10:8990");
        let l1 = inst(SourceKind::Lidarr, "Lidarr", "http://keep:8686");
        for i in [&r1, &s1, &s2, &l1] {
            repo.upsert(i).await.unwrap();
        }
        let o = parse("radarr=http://radarr.media:7878,sonarr=http://sonarr.media:8989,sonarr/anime=http://anime.media:8989").unwrap();
        assert_eq!(reconcile(&repo, &o).await.unwrap(), 3);
        assert_eq!(reconcile(&repo, &o).await.unwrap(), 0);

        let by_id = |id| {
            let repo = repo.clone();
            async move { repo.get(id).await.unwrap().unwrap() }
        };
        assert_eq!(by_id(r1.id).await.base_url, "http://radarr.media:7878");
        assert_eq!(by_id(s1.id).await.base_url, "http://sonarr.media:8989");
        assert_eq!(by_id(s2.id).await.base_url, "http://anime.media:8989");
        let l = by_id(l1.id).await;
        assert_eq!(l.base_url, "http://keep:8686");
        let r = by_id(r1.id).await;
        assert_eq!(r.api_key_encrypted, r1.api_key_encrypted);
        assert_eq!(r.priority, 3);
    }

    #[tokio::test]
    async fn dubarr_is_created_once_then_key_follows_the_env() {
        let repo = repo().await;
        let o = parse("dubarr=http://dubarr.dubarr:8686").unwrap();
        assert_eq!(o[0].kind, SourceKind::Dubarr);
        // No key: nothing created. No entry: nothing created.
        assert!(!ensure_dubarr(&repo, &o, "").await.unwrap());
        assert!(!ensure_dubarr(&repo, &[], "k1").await.unwrap());
        assert!(repo.list_all().await.unwrap().is_empty());

        assert!(ensure_dubarr(&repo, &o, "k1").await.unwrap());
        assert!(!ensure_dubarr(&repo, &o, "k1").await.unwrap());
        let all = repo.list_all().await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].kind, SourceKind::Dubarr);
        assert_eq!(all[0].base_url, "http://dubarr.dubarr:8686");
        assert_eq!(all[0].api_key_encrypted.expose_secret().as_str(), "k1");

        // Rotated key updates the same row; the URL path then applies as usual.
        assert!(ensure_dubarr(&repo, &o, "k2").await.unwrap());
        let all = repo.list_all().await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].api_key_encrypted.expose_secret().as_str(), "k2");
        let o2 = parse("dubarr=http://elsewhere:1").unwrap();
        assert_eq!(reconcile(&repo, &o2).await.unwrap(), 1);
        assert_eq!(
            repo.list_all().await.unwrap()[0].base_url,
            "http://elsewhere:1"
        );
    }

    #[tokio::test]
    async fn dubarr_created_with_the_fixed_id() {
        let repo = repo().await;
        let o = parse("dubarr=http://dubarr.dubarr:8686").unwrap();
        assert!(ensure_dubarr(&repo, &o, "k1").await.unwrap());
        assert_eq!(repo.list_all().await.unwrap()[0].id, DUBARR_INSTANCE_ID);
    }

    #[tokio::test]
    async fn duplicate_dubarr_rows_collapse_to_one_deterministically() {
        let repo = repo().await;
        let mut a = inst(SourceKind::Dubarr, "Dubarr", "http://dubarr.dubarr:8686");
        let mut b = inst(SourceKind::Dubarr, "Dubarr", "http://dubarr.dubarr:8686/");
        let other = inst(SourceKind::Dubarr, "Other", "http://elsewhere:1");
        let radarr = inst(SourceKind::Radarr, "Radarr", "http://dubarr.dubarr:8686");
        a.id = uuid::Uuid::from_u128(5);
        b.id = uuid::Uuid::from_u128(2);
        for i in [&a, &b, &other, &radarr] {
            repo.upsert(i).await.unwrap();
        }
        assert_eq!(dedupe_dubarr(&repo).await.unwrap(), 1);
        assert_eq!(dedupe_dubarr(&repo).await.unwrap(), 0);
        let ids: Vec<_> = repo
            .list_all()
            .await
            .unwrap()
            .iter()
            .map(|i| i.id)
            .collect();
        assert!(ids.contains(&b.id) && !ids.contains(&a.id));
        assert!(ids.contains(&other.id) && ids.contains(&radarr.id));

        // The fixed id wins over a lower id.
        let mut fixed = inst(SourceKind::Dubarr, "Dubarr", "http://dubarr.dubarr:8686");
        fixed.id = DUBARR_INSTANCE_ID;
        repo.upsert(&fixed).await.unwrap();
        assert_eq!(dedupe_dubarr(&repo).await.unwrap(), 1);
        let ids: Vec<_> = repo
            .list_all()
            .await
            .unwrap()
            .iter()
            .map(|i| i.id)
            .collect();
        assert!(ids.contains(&DUBARR_INSTANCE_ID) && !ids.contains(&b.id));
    }

    #[tokio::test]
    async fn ensure_dubarr_removes_a_replicated_duplicate_at_boot() {
        let repo = repo().await;
        let o = parse("dubarr=http://dubarr.dubarr:8686").unwrap();
        for n in [7u128, 3] {
            let mut d = inst(SourceKind::Dubarr, "Dubarr", "http://dubarr.dubarr:8686");
            d.id = uuid::Uuid::from_u128(n);
            d.api_key_encrypted = playarr_model::Sensitive::new("k1".to_string());
            repo.upsert(&d).await.unwrap();
        }
        ensure_dubarr(&repo, &o, "k1").await.unwrap();
        let all = repo.list_all().await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, uuid::Uuid::from_u128(3));
    }
}
