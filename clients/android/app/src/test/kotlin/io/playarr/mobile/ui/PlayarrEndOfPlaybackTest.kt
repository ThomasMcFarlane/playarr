package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrEndOfPlaybackTest {
    private val none = PlayarrEndCardEffect.None

    private fun reduce(state: PlayarrEndCardState, vararg events: PlayarrEndCardEvent):
        Pair<PlayarrEndCardState, PlayarrEndCardEffect> {
        var current = state to none as PlayarrEndCardEffect
        events.forEach { current = reducePlayarrEndCard(current.first, it) }
        return current
    }

    private fun countdown() = reduce(PlayarrEndCardState(), PlayarrEndCardEvent.Ended(hasNext = true)).first

    @Test
    fun `ended without a queue shows the standalone card`() {
        val (state, effect) = reduce(PlayarrEndCardState(), PlayarrEndCardEvent.Ended(hasNext = false))
        assertEquals(PlayarrEndCardMode.Standalone, state.mode)
        assertTrue(state.visible)
        assertFalse(state.counting)
        assertEquals(none, effect)
    }

    @Test
    fun `ended with a next item starts the full countdown`() {
        val state = countdown()
        assertEquals(PlayarrEndCardMode.Countdown, state.mode)
        assertEquals(PLAYER_UP_NEXT_COUNTDOWN_MS, state.remainingMs)
        assertEquals(10, state.remainingSeconds)
        assertTrue(state.counting)
    }

    @Test
    fun `countdown auto advances at zero and hides the card`() {
        var (state, effect) = countdown() to none as PlayarrEndCardEffect
        repeat((PLAYER_UP_NEXT_COUNTDOWN_MS / PLAYER_UP_NEXT_TICK_MS).toInt() - 1) {
            val r = reducePlayarrEndCard(state, PlayarrEndCardEvent.Tick(PLAYER_UP_NEXT_TICK_MS))
            state = r.first; effect = r.second
            assertEquals(none, effect)
        }
        assertEquals(PLAYER_UP_NEXT_TICK_MS, state.remainingMs)
        val last = reducePlayarrEndCard(state, PlayarrEndCardEvent.Tick(PLAYER_UP_NEXT_TICK_MS))
        assertEquals(PlayarrEndCardEffect.AdvanceAutomatically, last.second)
        assertFalse(last.first.visible)
    }

    @Test
    fun `cancel is sticky and returns to the plain ended card`() {
        val (state, effect) = reduce(countdown(), PlayarrEndCardEvent.Cancel)
        assertEquals(PlayarrEndCardMode.Standalone, state.mode)
        assertEquals(none, effect)
        assertFalse(state.hasNext)
        val ticked = reducePlayarrEndCard(state, PlayarrEndCardEvent.Tick(60_000L))
        assertEquals(state, ticked.first)
        assertEquals(none, ticked.second)
        assertEquals(none, reducePlayarrEndCard(state, PlayarrEndCardEvent.PlayNow).second)
    }

    @Test
    fun `play now advances immediately`() {
        val (state, effect) = reduce(countdown(), PlayarrEndCardEvent.PlayNow)
        assertEquals(PlayarrEndCardEffect.AdvanceNow, effect)
        assertFalse(state.visible)
    }

    @Test
    fun `play now is ignored on the standalone card`() {
        val standalone = reduce(PlayarrEndCardState(), PlayarrEndCardEvent.Ended(false)).first
        val (state, effect) = reducePlayarrEndCard(standalone, PlayarrEndCardEvent.PlayNow)
        assertEquals(standalone, state)
        assertEquals(none, effect)
    }

    @Test
    fun `replay and exit hide the card and request the effect`() {
        val standalone = reduce(PlayarrEndCardState(), PlayarrEndCardEvent.Ended(false)).first
        assertEquals(PlayarrEndCardEffect.Replay, reducePlayarrEndCard(standalone, PlayarrEndCardEvent.Replay).second)
        val exit = reducePlayarrEndCard(countdown(), PlayarrEndCardEvent.Exit)
        assertEquals(PlayarrEndCardEffect.Exit, exit.second)
        assertFalse(exit.first.visible)
    }

    @Test
    fun `selecting a suggestion opens its details`() {
        val (state, effect) = reduce(countdown(), PlayarrEndCardEvent.SelectSuggestion("work-7"))
        assertEquals(PlayarrEndCardEffect.OpenSuggestion("work-7"), effect)
        assertFalse(state.visible)
    }

    @Test
    fun `countdown pauses while browsing suggestions and resumes from the same value`() {
        val running = reduce(countdown(), PlayarrEndCardEvent.Tick(3_000L)).first
        val paused = reduce(running, PlayarrEndCardEvent.BrowsingSuggestions(true)).first
        assertFalse(paused.counting)
        val still = reducePlayarrEndCard(paused, PlayarrEndCardEvent.Tick(5_000L)).first
        assertEquals(7_000L, still.remainingMs)
        val resumed = reduce(still, PlayarrEndCardEvent.BrowsingSuggestions(false)).first
        assertTrue(resumed.counting)
        assertEquals(7_000L, resumed.remainingMs)
    }

    @Test
    fun `reset hides the card and a second ended is ignored while visible`() {
        val visible = countdown()
        assertEquals(visible, reducePlayarrEndCard(visible, PlayarrEndCardEvent.Ended(false)).first)
        assertFalse(reduce(visible, PlayarrEndCardEvent.Reset).first.visible)
    }

    @Test
    fun `events on a hidden card do nothing`() {
        val hidden = PlayarrEndCardState()
        listOf(
            PlayarrEndCardEvent.Replay, PlayarrEndCardEvent.Exit, PlayarrEndCardEvent.PlayNow,
            PlayarrEndCardEvent.Cancel, PlayarrEndCardEvent.SelectSuggestion("x"),
        ).forEach { assertEquals(hidden to none, reducePlayarrEndCard(hidden, it)) }
    }

    @Test
    fun `card applies to local video only`() {
        val video = PlayarrPlaybackQueueItem("m1", "Film")
        assertTrue(shouldShowPlayarrEndCard(video, casting = false))
        assertFalse(shouldShowPlayarrEndCard(video, casting = true))
        assertFalse(shouldShowPlayarrEndCard(video.copy(music = true), casting = false))
        assertFalse(shouldShowPlayarrEndCard(null, casting = false))
    }

    @Test
    fun `telemetry follows the cross-client spec names`() {
        assertEquals("play_now", playarrEndCardActionName(PlayarrEndCardEffect.AdvanceNow))
        assertEquals("suggestion", playarrEndCardActionName(PlayarrEndCardEffect.OpenSuggestion("a")))
        assertNull(playarrEndCardActionName(PlayarrEndCardEffect.AdvanceAutomatically))
        assertNull(playarrEndCardActionName(none))
        assertEquals(
            "event=end_screen_shown kind=up_next has_suggestions=true media_file_id=m1",
            playarrEndScreenShownLogLine(countdown(), "m1", 4),
        )
        assertEquals(
            "event=end_screen_shown kind=ended has_suggestions=false media_file_id=m1",
            playarrEndScreenShownLogLine(PlayarrEndCardState(PlayarrEndCardMode.Standalone), "m1", 0),
        )
        assertEquals(
            "event=end_screen_action action=cancel kind=up_next media_file_id=m1",
            playarrEndScreenActionLogLine("cancel", "up_next", "m1"),
        )
        assertEquals("event=end_screen_autoplay media_file_id=m1", playarrEndScreenAutoplayLogLine("m1"))
    }

    @Test
    fun `errors suppress the card`() {
        val video = PlayarrPlaybackQueueItem("m1", "Film")
        assertFalse(shouldShowPlayarrEndCard(video, casting = false, hasError = true))
    }

    @Test
    fun `keep awake is held on the card and released after idling on the plain ended card`() {
        val up = countdown()
        val plain = PlayarrEndCardState(PlayarrEndCardMode.Standalone)
        assertTrue(shouldHoldScreenForEndCard(up, idleExpired = true))
        assertTrue(shouldHoldScreenForEndCard(plain, idleExpired = false))
        assertFalse(shouldHoldScreenForEndCard(plain, idleExpired = true))
        assertFalse(shouldHoldScreenForEndCard(PlayarrEndCardState(), idleExpired = false))
        assertTrue(shouldKeepScreenOn(true, hasEnded = true, hasError = false, showsLocalVideo = true, endCardHeld = true))
        assertFalse(shouldKeepScreenOn(true, hasEnded = true, hasError = false, showsLocalVideo = true, endCardHeld = false))
        assertFalse(shouldKeepScreenOn(true, hasEnded = true, hasError = true, showsLocalVideo = true, endCardHeld = true))
    }

    private fun image(kind: io.playarr.shared.data.model.ImageKind, url: String) =
        io.playarr.shared.data.model.ImageAsset(kind, url)

    @Test
    fun `artwork candidates try the server endpoint then the provider url per kind`() {
                val candidates = playarrArtworkCandidates(
            "w1",
            listOf(image(io.playarr.shared.data.model.ImageKind.Banner, "https://cdn/banner.jpg"), image(io.playarr.shared.data.model.ImageKind.Poster, "https://cdn/poster.jpg")),
            PLAYER_SUGGESTION_ARTWORK_KINDS,
            "https://pl.example/",
        )
        assertEquals(
            listOf(
                "https://pl.example/api/v1/artwork/work/w1/poster",
                "https://cdn/poster.jpg",
                "https://pl.example/api/v1/artwork/work/w1/banner",
                "https://cdn/banner.jpg",
            ),
            candidates,
        )
    }

    @Test
    fun `artwork candidates prefer backdrop and resolve relative urls`() {
                val candidates = playarrArtworkCandidates(
            "w1",
            listOf(image(io.playarr.shared.data.model.ImageKind.Poster, "https://cdn/p.jpg"), image(io.playarr.shared.data.model.ImageKind.Backdrop, "/api/v1/artwork/work/w1/backdrop")),
            PLAYER_SUGGESTION_ARTWORK_KINDS,
            "https://pl.example",
        )
        assertEquals("https://pl.example/api/v1/artwork/work/w1/backdrop", candidates.first())
        assertEquals(3, candidates.size)
    }

    @Test
    fun `artwork candidates are empty when there is no usable image so the tile shows its title`() {
                assertTrue(playarrArtworkCandidates("w1", emptyList(), PLAYER_SUGGESTION_ARTWORK_KINDS, "https://pl.example").isEmpty())
        assertTrue(
            playarrArtworkCandidates("w1", listOf(image(io.playarr.shared.data.model.ImageKind.Logo, "https://cdn/logo.png")), PLAYER_SUGGESTION_ARTWORK_KINDS, "https://pl.example").isEmpty(),
        )
    }

    @Test
    fun `prewarmed negotiation is reused only for the same file, position and default settings`() {
        assertTrue(playarrPrewarmUsable("m2", 0L, "m2", 0L, hasLaunchSettings = false))
        assertFalse(playarrPrewarmUsable("m2", 0L, "m3", 0L, hasLaunchSettings = false))
        assertFalse(playarrPrewarmUsable("m2", 0L, "m2", 5_000L, hasLaunchSettings = false))
        assertFalse(playarrPrewarmUsable("m2", 0L, "m2", 0L, hasLaunchSettings = true))
    }

    private fun queueItem(id: String, music: Boolean = false) = PlayarrPlaybackQueueItem(mediaFileId = id, title = id, music = music)

    private fun minimised(
        hasEnded: Boolean = true,
        armed: Boolean = true,
        isPlayerRoute: Boolean = false,
        item: PlayarrPlaybackQueueItem? = queueItem("m1"),
        nextItem: PlayarrPlaybackQueueItem? = null,
        casting: Boolean = false,
        hasError: Boolean = false,
    ) = playarrMinimisedEndAction(hasEnded, armed, isPlayerRoute, item, nextItem, casting, hasError)

    @Test
    fun `minimised end with a next video continues with it`() {
        assertEquals(PlayarrMinimisedEndAction.AdvanceToNext, minimised(nextItem = queueItem("m2")))
    }

    @Test
    fun `minimised end with nothing queued expands the player to the ended card`() {
        assertEquals(PlayarrMinimisedEndAction.ExpandPlayer, minimised())
        assertEquals(PlayarrMinimisedEndAction.ExpandPlayer, minimised(nextItem = queueItem("t2", music = true)))
    }

    @Test
    fun `minimised end ignores stale ended state, the expanded player, music, casting and errors`() {
        assertEquals(PlayarrMinimisedEndAction.None, minimised(hasEnded = false))
        assertEquals(PlayarrMinimisedEndAction.None, minimised(armed = false, nextItem = queueItem("m2")))
        assertEquals(PlayarrMinimisedEndAction.None, minimised(isPlayerRoute = true))
        assertEquals(PlayarrMinimisedEndAction.None, minimised(item = queueItem("t1", music = true), nextItem = queueItem("t2", music = true)))
        assertEquals(PlayarrMinimisedEndAction.None, minimised(casting = true))
        assertEquals(PlayarrMinimisedEndAction.None, minimised(hasError = true))
        assertEquals(PlayarrMinimisedEndAction.None, minimised(item = null))
    }
}
