using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Playarr.Core.Auth;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Xunit;

namespace Playarr.Core.Tests
{
    public class FolderContractTests
    {
        private static readonly Guid RootId =
            Guid.Parse("11111111-2222-3333-4444-555555555555");

        [Fact]
        public void FolderNavigationStateKeepsOnlyOpaqueRelativeContext()
        {
            var state = new LibraryFolderNavigationState(
                WorkKind.Series,
                RootId,
                "Season 02/Extras",
                240);

            Assert.Equal(WorkKind.Series, state.LibraryKind);
            Assert.Equal(RootId, state.RootFolderId);
            Assert.Equal("Season 02/Extras", state.Path);
            Assert.Equal(240, state.LoadedEntryCount);
        }

        [Theory]
        [InlineData(-1, 0)]
        [InlineData(0, 0)]
        [InlineData(100, 100)]
        [InlineData(5000, LibraryFolderNavigationState.MaximumRestoredEntryCount)]
        public void FolderNavigationStateBoundsAutomaticPageRestoration(int requested, int expected)
        {
            var state = new LibraryFolderNavigationState(
                WorkKind.Movie,
                RootId,
                null,
                requested);

            Assert.Equal(string.Empty, state.Path);
            Assert.Equal(expected, state.LoadedEntryCount);
        }

        [Fact]
        public void FileDerivedFolderPayloadDecodesWithoutAFilesystemRootPath()
        {
            var payload =
                "{\"root\":{\"id\":\"11111111-2222-3333-4444-555555555555\"," +
                "\"source_instance_id\":\"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\"," +
                "\"source_name\":\"Radarr\",\"library_kind\":\"movie\",\"name\":\"Films\"," +
                "\"available\":true},\"path\":\"Classics\",\"breadcrumbs\":[" +
                "{\"name\":\"Films\",\"path\":\"\"},{\"name\":\"Classics\",\"path\":\"Classics\"}]," +
                "\"entries\":[{\"entry_type\":\"media\",\"name\":\"Metropolis.mkv\"," +
                "\"path\":\"Classics/Metropolis.mkv\"," +
                "\"media_file_id\":\"99999999-8888-7777-6666-555555555555\"," +
                "\"media_kind\":\"movie\",\"title\":\"Metropolis\",\"container\":\"mkv\"," +
                "\"video_codec\":\"h264\",\"audio_codec\":\"aac\",\"duration_ms\":90000," +
                "\"bitrate_bps\":8000000,\"size_bytes\":90000000,\"width\":1920,\"height\":1080," +
                "\"modified_at\":\"2026-07-31T12:00:00+00:00\"," +
                "\"thumbnail_url\":\"/api/v1/media/99999999-8888-7777-6666-555555555555/thumbnail\"}]," +
                "\"total\":1,\"offset\":0,\"limit\":100}";

            var decoded = JsonCoding.Deserialize<FolderBrowseResponse>(payload);

            Assert.NotNull(decoded);
            Assert.Equal(RootId, decoded!.Root.Id);
            Assert.Equal("Classics", decoded.Path);
            Assert.Equal(string.Empty, decoded.Breadcrumbs[0].Path);

            var media = Assert.Single(decoded.Entries);
            Assert.Equal(FolderEntryType.Media, media.EntryType);
            Assert.Equal("Metropolis", media.DisplayTitle);
            Assert.Equal(WorkKind.Movie, media.MediaKind);
            Assert.Equal(90000, media.DurationMs);
            Assert.Equal(1920, media.Width);
            Assert.EndsWith("/thumbnail", media.ThumbnailUrl);

            var encodedRoot = JsonCoding.Serialize(decoded.Root);
            Assert.DoesNotContain("\"path\"", encodedRoot);
        }

        [Fact]
        public async Task FolderCallsUseBearerAuthOpaqueRootAndEncodedRelativePath()
        {
            var handler = new RecordingHandler(
                "{\"roots\":[{\"id\":\"11111111-2222-3333-4444-555555555555\"," +
                "\"source_instance_id\":\"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\"," +
                "\"source_name\":\"Radarr\",\"library_kind\":\"movie\",\"name\":\"Films\"," +
                "\"available\":true,\"unavailable_reason\":null}],\"errors\":[]}",
                "{\"root\":{\"id\":\"11111111-2222-3333-4444-555555555555\"," +
                "\"source_instance_id\":\"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\"," +
                "\"source_name\":\"Radarr\",\"library_kind\":\"movie\",\"name\":\"Films\"," +
                "\"available\":true},\"path\":\"Classics/Drama & Comedy\"," +
                "\"breadcrumbs\":[],\"entries\":[],\"total\":0,\"offset\":200,\"limit\":100}");
            var tokenStore = new InMemoryTokenStore();
            await tokenStore.StoreSessionAsync(new StoredAuthSession(
                "folder-access-token",
                "unused-refresh-token",
                "Bearer",
                DateTimeOffset.UtcNow.AddHours(1)));

            var configuration = new ApiClientConfiguration(
                new Uri("https://example.test/playarr/"),
                Guid.Parse("01234567-89ab-cdef-0123-456789abcdef"));
            var client = new PlayarrApiClient(
                configuration,
                tokenStore,
                httpClient: new HttpClient(handler));

            var roots = await client.ListFolderRootsAsync(WorkKind.Movie);
            var directory = await client.BrowseFolderAsync(
                roots.Roots[0].Id,
                "Classics/Drama & Comedy",
                limit: 100,
                offset: 200);

            Assert.Equal(2, handler.Requests.Count);
            Assert.Equal("/playarr/api/v1/folders/roots", handler.Requests[0].Uri.AbsolutePath);
            Assert.Equal("?kind=movie", handler.Requests[0].Uri.Query);
            Assert.Equal("Bearer folder-access-token", handler.Requests[0].Authorization);

            var browse = handler.Requests[1];
            Assert.Equal(
                "/playarr/api/v1/folders/11111111-2222-3333-4444-555555555555",
                browse.Uri.AbsolutePath);
            Assert.Contains("path=Classics%2FDrama%20%26%20Comedy", browse.Uri.Query);
            Assert.Contains("limit=100", browse.Uri.Query);
            Assert.Contains("offset=200", browse.Uri.Query);
            Assert.Equal("Bearer folder-access-token", browse.Authorization);
            Assert.Equal("Classics/Drama & Comedy", directory.Path);
        }

        private sealed class RecordedRequest
        {
            public RecordedRequest(Uri uri, string? authorization)
            {
                Uri = uri;
                Authorization = authorization;
            }

            public Uri Uri { get; }

            public string? Authorization { get; }
        }

        private sealed class RecordingHandler : HttpMessageHandler
        {
            private readonly Queue<string> _responses;

            public RecordingHandler(params string[] responses)
            {
                _responses = new Queue<string>(responses);
            }

            public IList<RecordedRequest> Requests { get; } = new List<RecordedRequest>();

            protected override Task<HttpResponseMessage> SendAsync(
                HttpRequestMessage request,
                CancellationToken cancellationToken)
            {
                request.Headers.TryGetValues("Authorization", out var values);
                Requests.Add(new RecordedRequest(
                    request.RequestUri!,
                    values?.SingleOrDefault()));

                var response = new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(
                        _responses.Dequeue(),
                        Encoding.UTF8,
                        "application/json"),
                };
                return Task.FromResult(response);
            }
        }
    }
}
