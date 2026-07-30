import Foundation
import PlayarrKit
import XCTest
@testable import PlayarrTV

final class TVFolderBrowserTests: XCTestCase {
    func testSitesNavigationExposesTheNativeLibraryAndFoldersSurface() {
        XCTAssertTrue(TVNavTab.allCases.contains(.sites))
        XCTAssertEqual(TVNavTab.sites.title, "Sites")
        XCTAssertEqual(TVNavTab.sites.systemImage, "globe")
    }

    func testSharedFolderWireTypesDecodeFileMetadata() throws {
        let payload = Data(
            """
            {
              "root": {
                "id": "00000000-0000-4000-8000-000000000001",
                "source_instance_id": "00000000-0000-4000-8000-000000000002",
                "source_name": "Radarr",
                "library_kind": "movie",
                "name": "Movies",
                "available": true,
                "unavailable_reason": null
              },
              "path": "Unsorted",
              "breadcrumbs": [
                {"name": "Movies", "path": ""},
                {"name": "Unsorted", "path": "Unsorted"}
              ],
              "entries": [{
                "entry_type": "media",
                "name": "Film.mkv",
                "path": "Unsorted/Film.mkv",
                "media_file_id": "00000000-0000-4000-8000-000000000003",
                "media_kind": "movie",
                "title": "Film",
                "artist": null,
                "album": null,
                "container": "mkv",
                "video_codec": "hevc",
                "audio_codec": "eac3",
                "duration_ms": 3723000,
                "bitrate_bps": 8000000,
                "size_bytes": 1572864,
                "width": 3840,
                "height": 2160,
                "modified_at": "2026-07-31T08:00:00Z",
                "thumbnail_url": "/api/v1/media/00000000-0000-4000-8000-000000000003/thumbnail"
              }],
              "total": 1,
              "offset": 0,
              "limit": 100
            }
            """.utf8
        )
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let response = try decoder.decode(FolderBrowseResponse.self, from: payload)

        XCTAssertEqual(response.root.libraryKind, .movie)
        XCTAssertEqual(response.breadcrumbs.map(\.path), ["", "Unsorted"])
        XCTAssertEqual(response.entries.first?.mediaKind, .movie)
        XCTAssertEqual(response.entries.first?.videoCodec, "hevc")
        XCTAssertEqual(response.entries.first?.thumbnailURL, "/api/v1/media/00000000-0000-4000-8000-000000000003/thumbnail")
    }

    @MainActor
    func testViewModelSelectsAvailableRootAndAppendsNextPage() async {
        let root = makeRoot()
        let firstPage = FolderBrowseResponse(
            root: root,
            path: "",
            breadcrumbs: [FolderBreadcrumb(name: "Movies", path: "")],
            entries: [
                FolderEntry(entryType: .directory, name: "A", path: "A"),
                makeMedia(name: "One.mkv", idSuffix: "11"),
            ],
            total: 3,
            offset: 0,
            limit: 2
        )
        let secondPage = FolderBrowseResponse(
            root: root,
            path: "",
            breadcrumbs: [FolderBreadcrumb(name: "Movies", path: "")],
            entries: [makeMedia(name: "Two.mkv", idSuffix: "12")],
            total: 3,
            offset: 2,
            limit: 2
        )
        let api = TVFolderAPIMock(
            roots: FolderRootsResponse(roots: [root], errors: []),
            pages: [0: firstPage, 2: secondPage]
        )
        let viewModel = TVFolderBrowserViewModel(api: api)

        await viewModel.load(kind: .movie)

        XCTAssertEqual(viewModel.rootsState, .loaded)
        XCTAssertEqual(viewModel.selectedRootID, root.id)
        XCTAssertEqual(viewModel.directory?.entries.count, 2)
        XCTAssertTrue(viewModel.canLoadMore)

        await viewModel.loadMore()

        XCTAssertEqual(viewModel.directory?.entries.map(\.name), ["A", "One.mkv", "Two.mkv"])
        XCTAssertFalse(viewModel.canLoadMore)
        let offsets = await api.offsets()
        XCTAssertEqual(offsets, [0, 2])
    }

    func testFolderFormattingUsesOnlyFileEntryMetadata() {
        let modifiedAt = ISO8601DateFormatter().date(from: "2026-07-31T08:00:00Z")
        let entry = FolderEntry(
            entryType: .media,
            name: "01 - Intro.flac",
            path: "Album/01 - Intro.flac",
            mediaFileID: UUID(uuidString: "00000000-0000-4000-8000-000000000013"),
            mediaKind: .artist,
            title: "Intro",
            artist: "Artist",
            album: "Album",
            container: "flac",
            audioCodec: "flac",
            durationMS: 3_723_000,
            bitrateBPS: 1_200_000,
            sizeBytes: 1_572_864,
            modifiedAt: modifiedAt
        )

        XCTAssertEqual(tvFolderParentPath("Album/Disc 1/01 - Intro.flac"), "Album/Disc 1")
        XCTAssertEqual(tvFolderDisplayTitle(entry), "Intro")
        XCTAssertEqual(
            tvFolderMetadata(entry),
            "Artist · Album\nFLAC · 1:02:03 · 1.2 Mbps · 1.5 MB · 2026-07-31"
        )
    }

    @MainActor
    func testFoldersViewAndAudioPlaybackCapabilitiesAreExposed() {
        XCTAssertTrue(TVLibraryViewMode.allCases.contains(.folders))
        XCTAssertTrue(TVPlayerViewModel.supportedContainers.contains("flac"))
        XCTAssertTrue(TVPlayerViewModel.supportedAudioCodecs.contains("alac"))
        XCTAssertFalse(TVPlayerViewModel.supportedContainers.contains("mkv"))
        XCTAssertFalse(TVPlayerViewModel.supportedContainers.contains("ogg"))
        XCTAssertFalse(TVPlayerViewModel.supportedAudioCodecs.contains("opus"))
    }

    private func makeRoot() -> FolderRoot {
        FolderRoot(
            id: UUID(uuidString: "00000000-0000-4000-8000-000000000001")!,
            sourceInstanceID: UUID(uuidString: "00000000-0000-4000-8000-000000000002")!,
            sourceName: "Radarr",
            libraryKind: .movie,
            name: "Movies",
            available: true
        )
    }

    private func makeMedia(name: String, idSuffix: String) -> FolderEntry {
        FolderEntry(
            entryType: .media,
            name: name,
            path: name,
            mediaFileID: UUID(uuidString: "00000000-0000-4000-8000-0000000000\(idSuffix)"),
            mediaKind: .movie,
            title: name.replacingOccurrences(of: ".mkv", with: ""),
            container: "mkv",
            videoCodec: "h264",
            audioCodec: "aac"
        )
    }
}

private actor TVFolderAPIMock: TVFolderBrowsingAPI {
    let roots: FolderRootsResponse
    let pages: [Int: FolderBrowseResponse]
    private var requestedOffsets = [Int]()

    init(roots: FolderRootsResponse, pages: [Int: FolderBrowseResponse]) {
        self.roots = roots
        self.pages = pages
    }

    func listFolderRoots(kind: WorkKind) async throws -> FolderRootsResponse {
        roots
    }

    func browseFolder(
        rootID: UUID,
        path: String?,
        limit: Int?,
        offset: Int?
    ) async throws -> FolderBrowseResponse {
        let offset = offset ?? 0
        requestedOffsets.append(offset)
        guard let page = pages[offset] else {
            throw TVFolderMockError.missingPage
        }
        return page
    }

    func offsets() -> [Int] {
        requestedOffsets
    }
}

private enum TVFolderMockError: Error {
    case missingPage
}
