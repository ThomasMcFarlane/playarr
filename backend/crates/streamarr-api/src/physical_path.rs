use streamarr_model::SourceInstance;
use uuid::Uuid;

pub(crate) fn map_source_path(
    path: &str,
    source_root: Option<&str>,
    mapped_root: Option<&str>,
) -> (String, bool) {
    let (Some(source_root), Some(mapped_root)) = (source_root, mapped_root) else {
        return (path.to_string(), false);
    };
    let normalise = |value: &str| value.replace('\\', "/").trim_end_matches('/').to_string();
    let path_normalised = normalise(path);
    let source_normalised = normalise(source_root);
    let suffix = if path_normalised == source_normalised {
        ""
    } else if let Some(suffix) = path_normalised.strip_prefix(&(source_normalised.clone() + "/")) {
        suffix
    } else {
        return (path.to_string(), false);
    };
    let separator = if mapped_root.contains('\\') && !mapped_root.contains('/') {
        "\\"
    } else {
        "/"
    };
    let root = mapped_root.trim_end_matches(['/', '\\']);
    let mapped = if suffix.is_empty() {
        root.to_string()
    } else {
        format!("{root}{separator}{}", suffix.replace('/', separator))
    };
    (mapped, true)
}

/// Resolve a source-reported path for this peer and prove that the resulting
/// path is a physical regular file visible to the running Streamarr process.
pub(crate) async fn existing_physical_file(
    source: &SourceInstance,
    peer_id: Uuid,
    reported_path: &str,
) -> Option<(String, bool)> {
    let mapped_root = source.folder_mappings.get(&peer_id);
    let (physical_path, mapped) = map_source_path(
        reported_path,
        source.default_root_folder_id.as_deref(),
        mapped_root.map(String::as_str),
    );
    let metadata = tokio::fs::metadata(&physical_path).await.ok()?;
    metadata.is_file().then_some((physical_path, mapped))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use streamarr_model::{Sensitive, SourceKind};

    use super::*;

    fn source_instance(peer_id: Uuid, root: &str, mapped_root: &str) -> SourceInstance {
        SourceInstance {
            id: Uuid::new_v4(),
            kind: SourceKind::Radarr,
            name: "Radarr".to_string(),
            base_url: "https://radarr.example.com".to_string(),
            api_key_encrypted: Sensitive::new("key".to_string()),
            priority: 0,
            default_root_folder_id: Some(root.to_string()),
            folder_mappings: BTreeMap::from([(peer_id, mapped_root.to_string())]),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: None,
        }
    }

    #[test]
    fn source_paths_map_across_unix_and_windows_roots() {
        assert_eq!(
            map_source_path(
                "/source/movies/Voyage (2016)/Voyage.mkv",
                Some("/source/movies"),
                Some("/mnt/media/movies"),
            ),
            (
                "/mnt/media/movies/Voyage (2016)/Voyage.mkv".to_string(),
                true,
            )
        );
        assert_eq!(
            map_source_path(
                r"D:\Movies\Voyage (2016)\Voyage.mkv",
                Some(r"D:\Movies"),
                Some(r"E:\Media\Movies"),
            ),
            (
                r"E:\Media\Movies\Voyage (2016)\Voyage.mkv".to_string(),
                true
            )
        );
    }

    #[tokio::test]
    async fn physical_file_requires_a_visible_regular_file_after_mapping() {
        let temp = tempfile::tempdir().unwrap();
        let peer_id = Uuid::new_v4();
        let mapped_root = temp.path().to_string_lossy();
        let source = source_instance(peer_id, "/source/movies", &mapped_root);
        let physical_file = temp.path().join("Voyage.mkv");
        std::fs::write(&physical_file, b"media").unwrap();

        assert_eq!(
            existing_physical_file(&source, peer_id, "/source/movies/Voyage.mkv").await,
            Some((physical_file.to_string_lossy().into_owned(), true))
        );
        assert_eq!(
            existing_physical_file(&source, peer_id, "/source/movies/Missing.mkv").await,
            None
        );
        assert_eq!(
            existing_physical_file(&source, peer_id, "/source/movies").await,
            None
        );

        let mut direct_source = source_instance(peer_id, "/unused", "/unused");
        direct_source.default_root_folder_id = None;
        direct_source.folder_mappings.clear();
        assert_eq!(
            existing_physical_file(&direct_source, peer_id, &physical_file.to_string_lossy()).await,
            Some((physical_file.to_string_lossy().into_owned(), false))
        );
    }
}
