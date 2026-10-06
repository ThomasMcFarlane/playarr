package io.playarr.mobile.ui

import androidx.lifecycle.Lifecycle
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Broadcast action and extra used by the Picture-in-Picture remote actions. */
internal const val PIP_CONTROL_ACTION = "io.playarr.mobile.PIP_CONTROL"
internal const val PIP_CONTROL_EXTRA = "control"

/** Seek step for the skip actions in the Picture-in-Picture window. */
internal const val PIP_SEEK_STEP_MS = 10_000L

/** The system limits a PiP aspect ratio to between 1:2.39 and 2.39:1. */
private const val PIP_MAX_RATIO = 2.39f

internal enum class PlayarrPipControl(val wire: String) {
    SkipBack("skip_back"),
    PlayPause("play_pause"),
    SkipForward("skip_forward");

    companion object {
        fun fromWire(value: String?): PlayarrPipControl? = entries.firstOrNull { it.wire == value }
    }
}

/** A numerator/denominator pair, kept free of `android.util.Rational` so it is unit-testable. */
internal data class PlayarrPipRatio(val numerator: Int, val denominator: Int)

/**
 * Aspect ratio for the PiP window from the video's displayed size (pixel width ratio applied),
 * clamped to the range the system accepts and defaulting to 16:9 while the size is unknown.
 */
internal fun playarrPipAspectRatio(width: Int, height: Int, pixelWidthHeightRatio: Float = 1f): PlayarrPipRatio {
    if (width <= 0 || height <= 0) return PlayarrPipRatio(16, 9)
    val pixelRatio = if (pixelWidthHeightRatio > 0f) pixelWidthHeightRatio else 1f
    val ratio = width * pixelRatio / height
    return when {
        ratio > PIP_MAX_RATIO -> PlayarrPipRatio(239, 100)
        ratio < 1f / PIP_MAX_RATIO -> PlayarrPipRatio(100, 239)
        else -> PlayarrPipRatio((ratio * 1000f).toInt().coerceAtLeast(1), 1000)
    }
}

/** PiP is only offered when the device declares `FEATURE_PICTURE_IN_PICTURE`. */
internal fun playarrPipSupported(hasPipFeature: Boolean): Boolean = hasPipFeature

/**
 * Whether the viewer may be put into PiP: local video is on screen and playing (not the music
 * visual, a cast session, a finished video or a failed start).
 */
internal fun playarrPipEligible(
    supported: Boolean,
    localVideoShown: Boolean,
    ready: Boolean,
    hasEnded: Boolean,
    hasError: Boolean,
): Boolean = supported && localVideoShown && ready && !hasEnded && !hasError

/** Leaving the app enters PiP only while eligible and actually playing. */
internal fun playarrShouldEnterPipOnLeave(eligible: Boolean, playing: Boolean): Boolean = eligible && playing

/**
 * After PiP ends: the window was closed (dismissed) when the activity is stopped, and expanded
 * back to full screen when it is still started or resumed.
 */
internal fun playarrPipWindowDismissed(leftPip: Boolean, lifecycleState: Lifecycle.State): Boolean =
    leftPip && !lifecycleState.isAtLeast(Lifecycle.State.STARTED)

internal data class PlayarrPipLabels(
    val play: String = "Play",
    val pause: String = "Pause",
    val skipBack: String = "Back 10 seconds",
    val skipForward: String = "Forward 10 seconds",
)

internal data class PlayarrPipState(
    val eligible: Boolean = false,
    val playing: Boolean = false,
    val aspect: PlayarrPipRatio = PlayarrPipRatio(16, 9),
    val labels: PlayarrPipLabels = PlayarrPipLabels(),
)

/**
 * Link between the player screen (Compose) and the activity, which owns the PiP window APIs.
 * The screen publishes [state] and the handlers; the activity publishes [inPip].
 */
internal object PlayarrPictureInPicture {
    private val _state = MutableStateFlow(PlayarrPipState())
    val state: StateFlow<PlayarrPipState> = _state.asStateFlow()

    private val _inPip = MutableStateFlow(false)
    val inPip: StateFlow<Boolean> = _inPip.asStateFlow()

    /** True once the activity has confirmed the device supports PiP. */
    @Volatile var supported: Boolean = false

    @Volatile var onControl: ((PlayarrPipControl) -> Unit)? = null
    @Volatile var onWindowClosed: (() -> Unit)? = null
    @Volatile var requestEnter: (() -> Boolean)? = null

    fun publish(state: PlayarrPipState) { _state.value = state }
    fun clear() { _state.value = PlayarrPipState() }
    fun setInPip(value: Boolean) { _inPip.value = value }

    /** Enters PiP if allowed; false when not eligible or unsupported. */
    fun enter(): Boolean = _state.value.eligible && (requestEnter?.invoke() ?: false)
}
