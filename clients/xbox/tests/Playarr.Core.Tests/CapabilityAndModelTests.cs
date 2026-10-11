using System;
using System.Linq;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Playarr.Core.Playback;
using Xunit;

namespace Playarr.Core.Tests
{
    public class ClientPlatformTests
    {
        /// <summary>
        /// Mirrors the backend's own
        /// <c>every_variant_round_trips_through_its_wire_name</c>. If the two
        /// ever disagree, an Xbox identifies itself as something the server
        /// does not recognise, and the platform silently degrades to "web"
        /// in the server's playback analytics.
        /// </summary>
        [Fact]
        public void EveryPlatformRoundTripsThroughItsWireName()
        {
            foreach (ClientPlatform platform in Enum.GetValues(typeof(ClientPlatform)))
            {
                Assert.Equal(platform, ClientPlatformExtensions.FromWireName(platform.WireName()));
            }
        }

        [Fact]
        public void XboxUsesTheWireNameTheBackendEnumDeclares()
        {
            Assert.Equal("xbox", ClientPlatform.Xbox.WireName());
        }

        /// <summary>
        /// Unlike the Kotlin and Swift mirrors, an unrecognised platform is
        /// "some other client" rather than a decoding failure.
        /// </summary>
        [Fact]
        public void UnknownWireNameParsesToNullRatherThanThrowing()
        {
            Assert.Null(ClientPlatformExtensions.FromWireName("tv-something-new"));
            Assert.Null(ClientPlatformExtensions.FromWireName(null));
        }
    }

    public class SensitiveTests
    {
        [Fact]
        public void ToStringNeverRevealsTheSecret()
        {
            var secret = new Sensitive<string>("super-secret-refresh-token");

            Assert.Equal("REDACTED", secret.ToString());
            Assert.DoesNotContain("super-secret", $"{secret}");
            Assert.Equal("super-secret-refresh-token", secret.ExposeSecret());
        }

        [Fact]
        public void SerialisesTransparentlyAsTheWrappedValue()
        {
            var session = new StoredAuthSession("access", "refresh", "Bearer", DateTimeOffset.UnixEpoch);

            var json = JsonCoding.Serialize(session);

            Assert.Contains("\"access_token\":\"access\"", json);
            Assert.Contains("\"refresh_token\":\"refresh\"", json);

            var decoded = JsonCoding.Deserialize<StoredAuthSession>(json);
            Assert.NotNull(decoded);
            Assert.Equal("access", decoded!.AccessToken.ExposeSecret());
        }
    }

    public class TolerantEnumTests
    {
        private sealed class Holder
        {
            [Newtonsoft.Json.JsonProperty("kind")] public WorkKind Kind { get; set; }
        }

        /// <summary>
        /// The whole reason <see cref="TolerantEnumConverter"/> exists: the
        /// server growing one catalog kind must not break decoding of an
        /// entire response for older client builds.
        /// </summary>
        [Fact]
        public void UnrecognisedEnumValueDecodesToUnknownInsteadOfThrowing()
        {
            var decoded = JsonCoding.Deserialize<Holder>("{\"kind\":\"game\"}");

            Assert.NotNull(decoded);
            Assert.Equal(WorkKind.Unknown, decoded!.Kind);
        }

        [Fact]
        public void KnownEnumValuesStillDecodeAndReEncode()
        {
            var decoded = JsonCoding.Deserialize<Holder>("{\"kind\":\"series\"}");
            Assert.Equal(WorkKind.Series, decoded!.Kind);
            Assert.Contains("\"kind\":\"series\"", JsonCoding.Serialize(decoded));
        }

        [Fact]
        public void MultiWordWireValuesUseTheirEnumMemberSpelling()
        {
            var decoded = JsonCoding.Deserialize<Holder>("{\"kind\":\"movie\"}");
            Assert.Equal(WorkKind.Movie, decoded!.Kind);

            var progress = JsonCoding.Deserialize<WatchProgress>(
                "{\"media_file_id\":\"00000000-0000-0000-0000-000000000000\"," +
                "\"work_id\":\"00000000-0000-0000-0000-000000000000\"," +
                "\"position_ms\":1,\"duration_ms\":2,\"state\":\"part_watched\"}");

            Assert.Equal(WatchState.InProgress, progress!.State);
        }
    }

    public class XboxPlaybackProfileTests
    {
        /// <summary>
        /// No Xbox has AV1 hardware decode, not even Series X. Advertising
        /// it would trade a clean server-side transcode for a software
        /// decode that stutters.
        /// </summary>
        [Theory]
        [InlineData(XboxModel.Unknown)]
        [InlineData(XboxModel.XboxOne)]
        [InlineData(XboxModel.XboxOneS)]
        [InlineData(XboxModel.XboxOneX)]
        [InlineData(XboxModel.XboxSeriesS)]
        [InlineData(XboxModel.XboxSeriesX)]
        public void NoModelEverAdvertisesAv1(XboxModel model)
        {
            Assert.DoesNotContain("av1", XboxPlaybackProfile.ForModel(model).VideoCodecs);
        }

        /// <summary>
        /// The original Xbox One has no hardware HEVC decoder at all.
        /// </summary>
        [Fact]
        public void OriginalXboxOneDoesNotAdvertiseHevc()
        {
            var profile = XboxPlaybackProfile.ForModel(XboxModel.XboxOne);

            Assert.DoesNotContain("hevc", profile.VideoCodecs);
            Assert.Equal(1080, profile.MaxHeight);
        }

        /// <summary>
        /// An undetected model must under-declare, never over-declare: a
        /// needless transcode is far easier to live with than a direct play
        /// that dies at the decoder.
        /// </summary>
        [Fact]
        public void UnknownModelIsAsConservativeAsTheOldestConsole()
        {
            var unknown = XboxPlaybackProfile.ForModel(XboxModel.Unknown);
            var oldest = XboxPlaybackProfile.ForModel(XboxModel.XboxOne);

            Assert.Equal(oldest.VideoCodecs, unknown.VideoCodecs);
            Assert.Equal(oldest.MaxHeight, unknown.MaxHeight);
            Assert.Equal(oldest.MaxBitrateBps, unknown.MaxBitrateBps);
        }

        [Theory]
        [InlineData(XboxModel.XboxOneS, false)]
        [InlineData(XboxModel.XboxOneX, true)]
        [InlineData(XboxModel.XboxSeriesS, true)]
        [InlineData(XboxModel.XboxSeriesX, true)]
        public void Vp9IsLimitedToOneXAndSeriesConsoles(XboxModel model, bool expected)
        {
            Assert.Equal(expected, XboxPlaybackProfile.ForModel(model).SupportsVideoCodec("vp9"));
        }

        [Theory]
        [InlineData(XboxModel.XboxOneS)]
        [InlineData(XboxModel.XboxSeriesX)]
        public void HevcCapableConsolesReachFourK(XboxModel model)
        {
            var profile = XboxPlaybackProfile.ForModel(model);

            Assert.Contains("hevc", profile.VideoCodecs);
            Assert.Equal(2160, profile.MaxHeight);
        }

        /// <summary>
        /// Matroska is the single biggest direct-play win a native client
        /// has over the web client on identical hardware: Chromium has no
        /// Matroska demuxer, the Xbox media pipeline does.
        /// </summary>
        [Fact]
        public void MatroskaIsAdvertisedForDirectPlay()
        {
            Assert.True(XboxPlaybackProfile.ForModel(XboxModel.XboxSeriesX).SupportsContainer("mkv"));
        }

        [Fact]
        public void QueryParametersCarryTheDeclarationTheServerNegotiatesAgainst()
        {
            var query = XboxPlaybackProfile.ForModel(XboxModel.XboxSeriesX).ToQueryParameters();

            Assert.Equal("xbox", query["profile"]);
            Assert.Contains("mkv", query["containers"]);
            Assert.Contains("hevc", query["video_codecs"]);
            Assert.Contains("eac3", query["audio_codecs"]);
            Assert.True(long.Parse(query["max_bitrate_bps"]) > 0);
        }

        [Fact]
        public void EveryConsoleCapsAtSixtyFramesPerSecond()
        {
            Assert.Equal(60, XboxPlaybackProfile.MaxFrameRate);
        }
    }

    public class WorkChildrenTests
    {
        /// <summary>
        /// The server serialises children as an externally-tagged Rust enum,
        /// so a film arrives as the bare string "Movie" and a series as
        /// <c>{"Series": [...]}</c>. Both shapes have to decode.
        /// </summary>
        [Fact]
        public void MovieChildrenDecodeFromTheBareStringTag()
        {
            var detail = JsonCoding.Deserialize<WorkDetail>(
                "{\"work\":{\"id\":\"11111111-1111-1111-1111-111111111111\",\"kind\":\"movie\"," +
                "\"title\":\"A Film\",\"sort_title\":\"Film, A\",\"added_at\":\"2026-01-01T00:00:00+00:00\"," +
                "\"monitored\":true,\"availability\":\"available\"},\"children\":\"Movie\"," +
                "\"media_file_id\":\"22222222-2222-2222-2222-222222222222\"}");

            Assert.NotNull(detail);
            Assert.Equal(WorkKind.Movie, detail!.Children.ParentKind);
            Assert.Empty(detail.Children.Seasons);
            Assert.Equal(Guid.Parse("22222222-2222-2222-2222-222222222222"), detail.MediaFileId);
        }

        [Fact]
        public void SeriesChildrenDecodeSeasonsAndEpisodes()
        {
            var detail = JsonCoding.Deserialize<WorkDetail>(
                "{\"work\":{\"id\":\"11111111-1111-1111-1111-111111111111\",\"kind\":\"series\"," +
                "\"title\":\"A Show\",\"sort_title\":\"Show, A\",\"added_at\":\"2026-01-01T00:00:00+00:00\"," +
                "\"monitored\":true,\"availability\":\"available\"},\"children\":{\"Series\":[" +
                "{\"season\":{\"id\":\"33333333-3333-3333-3333-333333333333\"," +
                "\"series_work_id\":\"11111111-1111-1111-1111-111111111111\",\"season_number\":1," +
                "\"monitored\":true,\"availability\":\"available\"},\"episodes\":[" +
                "{\"episode\":{\"id\":\"44444444-4444-4444-4444-444444444444\"," +
                "\"season_id\":\"33333333-3333-3333-3333-333333333333\",\"episode_number\":1," +
                "\"title\":\"Pilot\",\"monitored\":true,\"availability\":\"available\"}," +
                "\"media_file_id\":\"55555555-5555-5555-5555-555555555555\"}]}]}}");

            Assert.NotNull(detail);
            Assert.Equal(WorkKind.Series, detail!.Children.ParentKind);
            var season = Assert.Single(detail.Children.Seasons);
            Assert.Equal(1, season.Season.SeasonNumber);
            var episode = Assert.Single(season.Episodes);
            Assert.Equal("Pilot", episode.Episode.Title);
            Assert.Equal(Guid.Parse("55555555-5555-5555-5555-555555555555"), episode.MediaFileId);
        }

        /// <summary>
        /// A first-class provider arrives as a bare string, anything else as
        /// <c>{"other": "..."}</c>; both flatten to one provider string.
        /// </summary>
        [Fact]
        public void ExternalRefsFlattenBothProviderShapes()
        {
            var work = JsonCoding.Deserialize<Work>(
                "{\"id\":\"11111111-1111-1111-1111-111111111111\",\"kind\":\"movie\",\"title\":\"T\"," +
                "\"sort_title\":\"T\",\"added_at\":\"2026-01-01T00:00:00+00:00\",\"monitored\":true," +
                "\"availability\":\"available\",\"external_refs\":[" +
                "{\"provider\":\"tmdb\",\"external_id\":\"603\"}," +
                "{\"provider\":{\"other\":\"anidb\"},\"external_id\":\"17\"}]}");

            Assert.NotNull(work);
            Assert.Equal(2, work!.ExternalRefs.Count);
            Assert.Equal("tmdb", work.ExternalRefs[0].Provider);
            Assert.Equal("603", work.ExternalRefs[0].ExternalId);
            Assert.Equal("anidb", work.ExternalRefs[1].Provider);
        }

        [Fact]
        public void WatchProgressFractionIsSafeWhenDurationIsUnknown()
        {
            Assert.Equal(0, new WatchProgress { PositionMs = 500, DurationMs = 0 }.Fraction);
            Assert.Equal(0.5, new WatchProgress { PositionMs = 500, DurationMs = 1000 }.Fraction);
            Assert.Equal(1.0, new WatchProgress { PositionMs = 5000, DurationMs = 1000 }.Fraction);
        }
    }

    public class JwtClaimsTests
    {
        // Payload: {"sub":"11111111-1111-1111-1111-111111111111",
        //           "iss":"99999999-9999-9999-9999-999999999999"}
        private const string GroupedNodeToken =
            "header." +
            "eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiLCJpc3MiOiI5OTk5OTk5OS05OTk5LT" +
            "k5OTktOTk5OS05OTk5OTk5OTk5OTkifQ" +
            ".signature";

        [Fact]
        public void ReadsSubjectAndIssuerFromAGroupedNodeToken()
        {
            Assert.Equal(
                Guid.Parse("11111111-1111-1111-1111-111111111111"),
                JwtClaims.Subject(GroupedNodeToken));
            Assert.Equal(
                Guid.Parse("99999999-9999-9999-9999-999999999999"),
                JwtClaims.IssuerPeerId(GroupedNodeToken));
        }

        [Fact]
        public void ReadsTheSessionDeviceId()
        {
            // Payload: {"sub":"11111111-…","device_id":"22222222-2222-2222-2222-222222222222"}
            const string token =
                "header." +
                "eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiLCJkZ" +
                "XZpY2VfaWQiOiIyMjIyMjIyMi0yMjIyLTIyMjItMjIyMi0yMjIyMjIyMjIyMjIifQ" +
                ".signature";

            Assert.Equal(Guid.Parse("22222222-2222-2222-2222-222222222222"), JwtClaims.DeviceId(token));
            Assert.Null(JwtClaims.DeviceId(GroupedNodeToken));
        }

        /// <summary>
        /// A standalone node signs with a configured issuer string such as
        /// "playarr", which is not a GUID. That has to read as "don't know
        /// which node issued this", not as a crash.
        /// </summary>
        [Fact]
        public void StandaloneNodeIssuerStringYieldsNull()
        {
            // Payload: {"iss":"playarr"}
            const string token = "header.eyJpc3MiOiJzdHJlYW1hcnIifQ.signature";

            Assert.Null(JwtClaims.IssuerPeerId(token));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("not-a-jwt")]
        [InlineData("only.two")]
        [InlineData("a.!!!not-base64!!!.c")]
        public void MalformedTokensYieldNullRatherThanThrowing(string? token)
        {
            Assert.Null(JwtClaims.Subject(token));
            Assert.Null(JwtClaims.IssuerPeerId(token));
        }
    }
}
