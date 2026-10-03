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

use std::sync::Arc;

use playarr_db::SourceInstanceRepo;
use playarr_model::{SourceInstance, SourceKind};

pub const ENV_VAR: &str = "PLAYARR_SOURCE_INSTANCE_URLS";

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

/// Reads [`ENV_VAR`] and reconciles; failures are logged, never fatal.
pub async fn reconcile_from_env(repo: &Arc<dyn SourceInstanceRepo>) {
    let Ok(raw) = std::env::var(ENV_VAR) else {
        return;
    };
    match parse(&raw) {
        Err(err) => tracing::error!(%err, "ignoring invalid {ENV_VAR}"),
        Ok(overrides) => match reconcile(repo, &overrides).await {
            Ok(n) => tracing::info!(changed = n, entries = overrides.len(), "{ENV_VAR} applied"),
            Err(err) => tracing::error!(%err, "failed to apply {ENV_VAR}"),
        },
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
}
