//! Resolves a [`crate::media::MediaFile::path`] (as reported by the *arr
//! source instance that owns it) to the path this process should actually
//! open on its own local filesystem.
//!
//! In the common case those are the same path -- Playarr Server co-located with
//! its media, per the project's own design. They diverge when Playarr Server's
//! backend runs somewhere other than where the *arr apps (and the media
//! itself) actually live -- e.g. local dev on a laptop against a remote
//! production Sonarr/Radarr -- and the remote root is reachable locally only
//! via a network mount (SSHFS/NFS/SMB) at a different local path. Rather
//! than rewrite every stored `MediaFile::path` to match whatever mount
//! point a given deployment happens to use, this does the substitution at
//! read time, driven by two env vars read fresh on every call (cheap --
//! `std::env::var`, not filesystem/network I/O, so no caching is needed and
//! the crate's own "domain types only, no I/O" boundary still holds).
//!
//! Used by both `playarr-api` (direct-play/HLS-segment serving) and
//! `playarr-transcode` (the source file ffmpeg reads for an on-demand
//! transcode) -- both need the same substitution, so it lives here, the one
//! crate both already depend on, rather than being duplicated per caller.

use std::path::{Path, PathBuf};

/// `PLAYARR_MEDIA_REMOTE_ROOT` -- the path prefix as the *arr source
/// instance itself reports it (what's actually stored in `MediaFile::path`).
const REMOTE_ROOT_VAR: &str = "PLAYARR_MEDIA_REMOTE_ROOT";
/// `PLAYARR_MEDIA_LOCAL_ROOT` -- where that same root is reachable from
/// this process's own filesystem (e.g. an SSHFS/NFS mount point).
const LOCAL_ROOT_VAR: &str = "PLAYARR_MEDIA_LOCAL_ROOT";

/// Rewrites `path` from the *arr-reported root to the locally-reachable
/// root, if both `PLAYARR_MEDIA_REMOTE_ROOT` and `PLAYARR_MEDIA_LOCAL_ROOT`
/// are set and `path` actually starts with the remote root. Returns `path`
/// unchanged (as an owned clone) in every other case -- neither var set
/// (the common, co-located case), only one set (misconfiguration; fails
/// open to the original path rather than silently guessing), or a path
/// that doesn't match the configured remote root at all (e.g. a *arr
/// instance whose files span more than one root -- out of scope for this
/// simple single-prefix substitution).
pub fn resolve_media_path(path: &Path) -> PathBuf {
    let (Ok(remote_root), Ok(local_root)) = (
        std::env::var(REMOTE_ROOT_VAR),
        std::env::var(LOCAL_ROOT_VAR),
    ) else {
        return path.to_path_buf();
    };
    if remote_root.is_empty() || local_root.is_empty() {
        return path.to_path_buf();
    }

    match path.strip_prefix(&remote_root) {
        Ok(suffix) => Path::new(&local_root).join(suffix),
        Err(_) => path.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // `std::env::set_var`/`remove_var` mutate real process-global state,
    // which is inherently racy across Rust's default parallel test
    // threads -- this crate-local mutex serializes just these tests
    // against each other (matching the pattern other crates in this
    // workspace use for the same reason, e.g. `playarr-config`'s tests
    // avoid the problem entirely via dependency injection; a real env var
    // is unavoidable here since `resolve_media_path` is a free function
    // with no config-object parameter to inject through).
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_env<T>(remote: Option<&str>, local: Option<&str>, f: impl FnOnce() -> T) -> T {
        let _guard = ENV_LOCK.lock().unwrap();
        match remote {
            Some(v) => std::env::set_var(REMOTE_ROOT_VAR, v),
            None => std::env::remove_var(REMOTE_ROOT_VAR),
        }
        match local {
            Some(v) => std::env::set_var(LOCAL_ROOT_VAR, v),
            None => std::env::remove_var(LOCAL_ROOT_VAR),
        }
        let result = f();
        std::env::remove_var(REMOTE_ROOT_VAR);
        std::env::remove_var(LOCAL_ROOT_VAR);
        result
    }

    #[test]
    fn unchanged_when_neither_var_is_set() {
        with_env(None, None, || {
            let resolved = resolve_media_path(Path::new("/srv/media/Movies/Orbit/Orbit.mkv"));
            assert_eq!(
                resolved,
                PathBuf::from("/srv/media/Movies/Orbit/Orbit.mkv")
            );
        });
    }

    #[test]
    fn unchanged_when_only_one_var_is_set() {
        with_env(Some("/srv/media"), None, || {
            let resolved = resolve_media_path(Path::new("/srv/media/Movies/Orbit/Orbit.mkv"));
            assert_eq!(
                resolved,
                PathBuf::from("/srv/media/Movies/Orbit/Orbit.mkv")
            );
        });
    }

    #[test]
    fn substitutes_the_matching_prefix() {
        with_env(Some("/srv/media"), Some("/mnt/playarr-media"), || {
            let resolved = resolve_media_path(Path::new("/srv/media/Movies/Orbit/Orbit.mkv"));
            assert_eq!(
                resolved,
                PathBuf::from("/mnt/playarr-media/Movies/Orbit/Orbit.mkv")
            );
        });
    }

    #[test]
    fn unchanged_when_path_does_not_match_the_remote_root() {
        with_env(Some("/srv/media"), Some("/mnt/media"), || {
            let resolved = resolve_media_path(Path::new("/completely/different/root/file.mkv"));
            assert_eq!(
                resolved,
                PathBuf::from("/completely/different/root/file.mkv")
            );
        });
    }
}
