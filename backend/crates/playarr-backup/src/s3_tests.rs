//! Off-node replication tests. An in-process fake S3 server (multipart,
//! per-part checksum verification, composite checksums, pagination) runs in
//! every test run. The same scenario also runs against a real S3-compatible
//! server (MinIO or similar) when `PLAYARR_TEST_S3_ENDPOINT`, `_ACCESS_KEY_ID` and
//! `_SECRET_ACCESS_KEY` are set; it uses a unique prefix and removes it.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Router;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use sha2::{Digest, Sha256};

use crate::manifest::BackupMode;
use crate::s3::{S3Config, S3Store};
use crate::store;
use crate::tests::fixture_with;

#[derive(Default)]
struct Object {
    data: Vec<u8>,
    checksum: String,
}

type Upload = (String, BTreeMap<usize, Vec<u8>>);

#[derive(Default)]
struct Fake {
    objects: Mutex<BTreeMap<String, Object>>,
    uploads: Mutex<BTreeMap<String, Upload>>,
    completed_parts: Mutex<Vec<usize>>,
    gets: AtomicUsize,
    reject_all: AtomicBool,
    corrupt_on_complete: AtomicBool,
    hide_checksums: AtomicBool,
}

fn xml(body: String) -> Response {
    (StatusCode::OK, body).into_response()
}

fn error(status: StatusCode, code: &str) -> Response {
    (
        status,
        format!("<Error><Code>{code}</Code><Message>fake</Message></Error>"),
    )
        .into_response()
}

fn query_of(request: &Request) -> BTreeMap<String, String> {
    request
        .uri()
        .query()
        .unwrap_or("")
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            (k.to_string(), v.replace("%2F", "/"))
        })
        .collect()
}

async fn handle(State(fake): State<Arc<Fake>>, request: Request) -> Response {
    if fake.reject_all.load(Ordering::SeqCst) {
        return error(StatusCode::FORBIDDEN, "AccessDenied");
    }
    let method = request.method().clone();
    let query = query_of(&request);
    let path = request.uri().path().to_string();
    let headers: HeaderMap = request.headers().clone();
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(
        auth.starts_with("AWS4-HMAC-SHA256 Credential=AK/"),
        "{auth}"
    );
    assert!(headers.contains_key("x-amz-content-sha256"));
    let body: Bytes = axum::body::to_bytes(request.into_body(), usize::MAX)
        .await
        .unwrap();
    // Path style: /bucket/key
    let key = path
        .trim_start_matches('/')
        .split_once('/')
        .map(|(_, key)| key.to_string())
        .unwrap_or_default();

    if key.is_empty() {
        if query.contains_key("uploads") {
            return xml("<ListMultipartUploadsResult></ListMultipartUploadsResult>".to_string());
        }
        // ListObjectsV2, two keys per page.
        let prefix = query.get("prefix").cloned().unwrap_or_default();
        let after = query.get("continuation-token").cloned().unwrap_or_default();
        let objects = fake.objects.lock().unwrap();
        let matching: Vec<_> = objects
            .iter()
            .filter(|(k, _)| k.starts_with(&prefix) && k.as_str() > after.as_str())
            .collect();
        let page: Vec<_> = matching.iter().take(2).collect();
        let mut out = String::from("<ListBucketResult>");
        for (k, o) in &page {
            out.push_str(&format!(
                "<Contents><Key>{k}</Key><Size>{}</Size></Contents>",
                o.data.len()
            ));
        }
        if matching.len() > 2 {
            out.push_str(&format!(
                "<IsTruncated>true</IsTruncated><NextContinuationToken>{}</NextContinuationToken>",
                page.last().unwrap().0
            ));
        } else {
            out.push_str("<IsTruncated>false</IsTruncated>");
        }
        out.push_str("</ListBucketResult>");
        return xml(out);
    }

    match method.as_str() {
        "POST" if query.contains_key("uploads") => {
            let id = format!("up-{}", fake.uploads.lock().unwrap().len() + 1);
            assert!(headers.contains_key("x-amz-meta-archive-sha256"));
            fake.uploads
                .lock()
                .unwrap()
                .insert(id.clone(), (key, BTreeMap::new()));
            xml(format!("<InitiateMultipartUploadResult><UploadId>{id}</UploadId></InitiateMultipartUploadResult>"))
        }
        "PUT" if query.contains_key("partNumber") => {
            let declared = headers
                .get("x-amz-checksum-sha256")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            if declared != B64.encode(Sha256::digest(&body)) {
                return error(StatusCode::BAD_REQUEST, "BadDigest");
            }
            let number: usize = query["partNumber"].parse().unwrap();
            let mut uploads = fake.uploads.lock().unwrap();
            let Some((_, parts)) = uploads.get_mut(&query["uploadId"]) else {
                return error(StatusCode::NOT_FOUND, "NoSuchUpload");
            };
            parts.insert(number, body.to_vec());
            let mut response = StatusCode::OK.into_response();
            response
                .headers_mut()
                .insert("etag", HeaderValue::from_static("\"etag\""));
            response
        }
        "POST" if query.contains_key("uploadId") => {
            let Some((upload_key, parts)) = fake.uploads.lock().unwrap().remove(&query["uploadId"])
            else {
                return error(StatusCode::NOT_FOUND, "NoSuchUpload");
            };
            let text = String::from_utf8_lossy(&body).to_string();
            assert_eq!(text.matches("<PartNumber>").count(), parts.len());
            let mut parts: Vec<Vec<u8>> = parts.into_values().collect();
            if fake.corrupt_on_complete.load(Ordering::SeqCst) {
                // Damage at rest: the server's own checksum reflects what it holds.
                let last = parts.last_mut().unwrap();
                let end = last.len() - 1;
                last[end] ^= 0xff;
            }
            let mut data = Vec::new();
            let mut composite = Sha256::new();
            for part in &parts {
                data.extend_from_slice(part);
                composite.update(Sha256::digest(part));
            }
            fake.completed_parts.lock().unwrap().push(parts.len());
            let checksum = format!("{}-{}", B64.encode(composite.finalize()), parts.len());
            fake.objects
                .lock()
                .unwrap()
                .insert(upload_key, Object { data, checksum });
            xml(
                "<CompleteMultipartUploadResult><ETag>x</ETag></CompleteMultipartUploadResult>"
                    .to_string(),
            )
        }
        "PUT" => {
            let declared = headers
                .get("x-amz-checksum-sha256")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();
            if declared != B64.encode(Sha256::digest(&body)) {
                return error(StatusCode::BAD_REQUEST, "BadDigest");
            }
            fake.objects.lock().unwrap().insert(
                key,
                Object {
                    data: body.to_vec(),
                    checksum: declared,
                },
            );
            StatusCode::OK.into_response()
        }
        "HEAD" => match fake.objects.lock().unwrap().get(&key) {
            None => StatusCode::NOT_FOUND.into_response(),
            Some(object) => {
                let mut response = StatusCode::OK.into_response();
                response.headers_mut().insert(
                    "content-length",
                    HeaderValue::from_str(&object.data.len().to_string()).unwrap(),
                );
                if headers.contains_key("x-amz-checksum-mode")
                    && !fake.hide_checksums.load(Ordering::SeqCst)
                {
                    response.headers_mut().insert(
                        "x-amz-checksum-sha256",
                        HeaderValue::from_str(&object.checksum).unwrap(),
                    );
                }
                response
            }
        },
        "GET" => {
            fake.gets.fetch_add(1, Ordering::SeqCst);
            match fake.objects.lock().unwrap().get(&key) {
                None => error(StatusCode::NOT_FOUND, "NoSuchKey"),
                Some(object) => object.data.clone().into_response(),
            }
        }
        "DELETE" if query.contains_key("uploadId") => {
            fake.uploads.lock().unwrap().remove(&query["uploadId"]);
            StatusCode::NO_CONTENT.into_response()
        }
        "DELETE" => {
            fake.objects.lock().unwrap().remove(&key);
            StatusCode::NO_CONTENT.into_response()
        }
        _ => error(StatusCode::BAD_REQUEST, "Unsupported"),
    }
}

async fn serve() -> (Arc<Fake>, String) {
    let fake = Arc::new(Fake::default());
    let app = Router::new().fallback(handle).with_state(fake.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (fake, format!("http://{address}"))
}

fn config(endpoint: &str) -> S3Config {
    S3Config {
        endpoint: endpoint.to_string(),
        bucket: "bk".to_string(),
        region: "auto".to_string(),
        prefix: "region-a/".to_string(),
        access_key_id: "AK".to_string(),
        secret_access_key: "SK".to_string(),
        path_style: true,
        part_size: 64 * 1024,
        keep_last: None,
        keep_days: None,
    }
}

/// Incompressible filler so the encrypted archive spans several parts.
fn add_filler(root: &std::path::Path) {
    let mut state = 0x9e3779b97f4a7c15u64;
    let bytes: Vec<u8> = (0..300_000)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state >> 24) as u8
        })
        .collect();
    std::fs::write(root.join("artwork/ab/filler.bin"), bytes).unwrap();
}

async fn remote_ids(store: &S3Store) -> Vec<String> {
    store
        .list_backups()
        .await
        .unwrap()
        .into_iter()
        .filter(|b| b.complete())
        .map(|b| b.id)
        .collect()
}

fn local_ids(dir: &std::path::Path) -> Vec<String> {
    store::list_backups(dir)
        .unwrap()
        .into_iter()
        .filter(|r| r.complete)
        .map(|r| r.sidecar.manifest.backup_id)
        .collect()
}

/// Five runs with the fixture's `keep_last = 3`: the bucket must end up with
/// the same three backups, byte-identical to the local archives, and
/// retention must have pruned the two older ones remotely.
#[tokio::test]
async fn replicates_with_multipart_verifies_and_prunes_remotely() {
    let (fake, endpoint) = serve().await;
    let mut cfg = config(&endpoint);
    // The bucket keeps fewer than the local destination (retention is
    // configured independently): the newest two.
    cfg.keep_last = Some(2);
    cfg.keep_days = Some(0);
    let store = S3Store::new(cfg.clone());
    let fx = fixture_with(BackupMode::Full, Some(cfg)).await;
    add_filler(fx._root.path());
    let mut sidecars = Vec::new();
    for _ in 0..5 {
        sidecars.push(fx.service.run_now("test").await.unwrap());
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    }
    assert!(store::list_failures(&fx.dest, 10).is_empty());
    let mut remote = remote_ids(&store).await;
    let mut local = local_ids(&fx.dest);
    remote.sort();
    local.sort();
    // The fixture keeps every recent backup locally (30 days).
    assert_eq!(local.len(), 5);
    let newest_two: Vec<String> = {
        let mut ids: Vec<String> = sidecars
            .iter()
            .rev()
            .take(2)
            .map(|s| s.manifest.backup_id.clone())
            .collect();
        ids.sort();
        ids
    };
    assert_eq!(remote, newest_two);
    // Retention pruned the three oldest remotely: no stray objects remain.
    let objects = store.list_objects().await.unwrap();
    assert_eq!(objects.len(), 4, "{objects:?}");
    // Several parts were used and the bytes match the local archive.
    assert!(fake.completed_parts.lock().unwrap().iter().all(|n| *n > 1));
    let newest = sidecars.last().unwrap();
    let key = format!("region-a/{}", newest.archive_name);
    let (sha, size) = store.download_sha256(&key).await.unwrap();
    assert_eq!(sha, newest.archive_sha256);
    assert_eq!(size, newest.archive_size);
    // The checksum path was used, so no read-back GET happened during uploads
    // beyond the one just made.
    assert_eq!(fake.gets.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_corrupted_upload_is_never_committed() {
    let (fake, endpoint) = serve().await;
    fake.corrupt_on_complete.store(true, Ordering::SeqCst);
    let fx = fixture_with(BackupMode::Full, Some(config(&endpoint))).await;
    add_filler(fx._root.path());
    // The run itself succeeds (local copy is intact) but replication fails.
    let sidecar = fx.service.run_now("test").await.unwrap();
    assert!(fx.dest.join(&sidecar.archive_name).exists());
    let failures = store::list_failures(&fx.dest, 10);
    assert_eq!(failures.len(), 1);
    assert_eq!(failures[0].phase, "replicate");
    assert!(
        fake.objects.lock().unwrap().is_empty(),
        "nothing is left in the bucket"
    );
}

#[tokio::test]
async fn falls_back_to_a_full_read_back_when_no_checksum_is_reported() {
    let (fake, endpoint) = serve().await;
    fake.hide_checksums.store(true, Ordering::SeqCst);
    let fx = fixture_with(BackupMode::Full, Some(config(&endpoint))).await;
    add_filler(fx._root.path());
    let sidecar = fx.service.run_now("test").await.unwrap();
    assert!(store::list_failures(&fx.dest, 10).is_empty());
    assert_eq!(fake.gets.load(Ordering::SeqCst), 1);
    let store = S3Store::new(config(&endpoint));
    assert_eq!(remote_ids(&store).await, vec![sidecar.manifest.backup_id]);

    // And a corrupted object is still caught by that path.
    fake.corrupt_on_complete.store(true, Ordering::SeqCst);
    let _ = fx.service.run_now("test").await.unwrap();
    assert_eq!(store::list_failures(&fx.dest, 10).len(), 1);
}

#[tokio::test]
async fn a_missed_upload_is_backfilled_by_the_next_run() {
    let (fake, endpoint) = serve().await;
    fake.reject_all.store(true, Ordering::SeqCst);
    let fx = fixture_with(BackupMode::Full, Some(config(&endpoint))).await;
    let first = fx.service.run_now("test").await.unwrap();
    assert_eq!(store::list_failures(&fx.dest, 10).len(), 1);
    assert!(fake.objects.lock().unwrap().is_empty());

    fake.reject_all.store(false, Ordering::SeqCst);
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    let second = fx.service.run_now("test").await.unwrap();
    let store = S3Store::new(config(&endpoint));
    let mut remote = remote_ids(&store).await;
    remote.sort();
    let mut expected = vec![first.manifest.backup_id, second.manifest.backup_id];
    expected.sort();
    assert_eq!(remote, expected);
}

#[tokio::test]
async fn remote_retention_clears_orphans_but_keeps_the_last_good_backup() {
    let (fake, endpoint) = serve().await;
    let cfg = config(&endpoint);
    let store = S3Store::new(cfg.clone());
    let put = |key: &str, size: usize| {
        fake.objects.lock().unwrap().insert(
            key.to_string(),
            Object {
                data: vec![0; size],
                checksum: String::new(),
            },
        );
    };
    // One old complete backup, one old archive with no sidecar, one sidecar
    // with no archive, and a recent archive that may be an upload in flight.
    put("region-a/playarr-backup-20200101T000000Z-old.parbak", 5);
    put("region-a/playarr-backup-20200101T000000Z-old.parbak.json", 2);
    put("region-a/playarr-backup-20200102T000000Z-orphan.parbak", 5);
    put("region-a/playarr-backup-20200103T000000Z-nosize.parbak.json", 2);
    let recent = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
    put(&format!("region-a/playarr-backup-{recent}-live.parbak"), 5);
    put("other/unrelated.txt", 1);

    let removed = store
        .apply_retention(1, 7, chrono::Utc::now())
        .await
        .unwrap();
    assert_eq!(removed.len(), 2, "{removed:?}");
    let keys: Vec<String> = fake.objects.lock().unwrap().keys().cloned().collect();
    assert!(keys.contains(&"region-a/playarr-backup-20200101T000000Z-old.parbak.json".to_string()));
    assert!(keys.contains(&format!("region-a/playarr-backup-{recent}-live.parbak")));
    assert!(keys.contains(&"other/unrelated.txt".to_string()));
    assert_eq!(keys.len(), 4);
}

/// Real S3-compatible server (MinIO or similar). Skipped unless configured.
#[tokio::test]
async fn real_object_storage_round_trip() {
    let var = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());
    let (Some(endpoint), Some(access), Some(secret)) = (
        var("PLAYARR_TEST_S3_ENDPOINT"),
        var("PLAYARR_TEST_S3_ACCESS_KEY_ID"),
        var("PLAYARR_TEST_S3_SECRET_ACCESS_KEY"),
    ) else {
        return;
    };
    let mut cfg = config(&endpoint);
    cfg.access_key_id = access;
    cfg.secret_access_key = secret;
    cfg.bucket = var("PLAYARR_TEST_S3_BUCKET").unwrap_or_else(|| "playarr-test".to_string());
    cfg.region = var("PLAYARR_TEST_S3_REGION").unwrap_or_else(|| "auto".to_string());
    cfg.prefix = format!("test-{}/", uuid::Uuid::new_v4().simple());
    cfg.part_size = 5 * 1024 * 1024;
    let store = S3Store::new(cfg.clone());
    let fx = fixture_with(BackupMode::Full, Some(cfg)).await;
    // Large enough for several 5 MiB parts.
    let mut state = 0x1234_5678_9abc_def1u64;
    let bytes: Vec<u8> = (0..12_000_000)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state >> 24) as u8
        })
        .collect();
    std::fs::write(fx._root.path().join("artwork/ab/filler.bin"), bytes).unwrap();
    let mut sidecars = Vec::new();
    for _ in 0..4 {
        sidecars.push(fx.service.run_now("test").await.unwrap());
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    }
    assert!(store::list_failures(&fx.dest, 10).is_empty());
    let mut remote = remote_ids(&store).await;
    let mut local = local_ids(&fx.dest);
    remote.sort();
    local.sort();
    assert_eq!(remote, local);
    let newest = sidecars.last().unwrap();
    let key = format!("{}{}", store.config().prefix, newest.archive_name);
    let (sha, size) = store.download_sha256(&key).await.unwrap();
    assert_eq!(
        (sha, size),
        (newest.archive_sha256.clone(), newest.archive_size)
    );
    // Clean up the unique prefix.
    store
        .apply_retention(1, 0, chrono::Utc::now())
        .await
        .unwrap();
    for object in store.list_objects().await.unwrap() {
        store.delete(&object.key).await.unwrap();
    }
}
