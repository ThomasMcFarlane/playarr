package io.playarr.mobile.ui

import android.app.PendingIntent
import android.content.Intent
import android.view.KeyEvent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.IntentCompat
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession

internal enum class PlayarrMediaControlAction {
    Play,
    Pause,
    TogglePlayback,
    Stop,
    SeekBackward,
    SeekForward,
    Previous,
    Next,
}

internal fun playarrMediaControlAction(keyCode: Int): PlayarrMediaControlAction? = when (keyCode) {
    KeyEvent.KEYCODE_MEDIA_PLAY -> PlayarrMediaControlAction.Play
    KeyEvent.KEYCODE_MEDIA_PAUSE -> PlayarrMediaControlAction.Pause
    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> PlayarrMediaControlAction.TogglePlayback
    KeyEvent.KEYCODE_MEDIA_STOP -> PlayarrMediaControlAction.Stop
    KeyEvent.KEYCODE_MEDIA_REWIND -> PlayarrMediaControlAction.SeekBackward
    KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> PlayarrMediaControlAction.SeekForward
    KeyEvent.KEYCODE_MEDIA_PREVIOUS -> PlayarrMediaControlAction.Previous
    KeyEvent.KEYCODE_MEDIA_NEXT -> PlayarrMediaControlAction.Next
    else -> null
}

@Composable
internal fun PlayarrMediaSession(
    player: Player,
    canPrevious: Boolean,
    canNext: Boolean,
    onPlay: () -> Unit,
    onPause: () -> Unit,
    onTogglePlayback: () -> Unit,
    onStop: () -> Unit,
    onSeekBackward: () -> Unit,
    onSeekForward: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
) {
    val context = LocalContext.current
    val currentCanPrevious = rememberUpdatedState(canPrevious)
    val currentCanNext = rememberUpdatedState(canNext)
    val currentOnPlay = rememberUpdatedState(onPlay)
    val currentOnPause = rememberUpdatedState(onPause)
    val currentOnTogglePlayback = rememberUpdatedState(onTogglePlayback)
    val currentOnStop = rememberUpdatedState(onStop)
    val currentOnSeekBackward = rememberUpdatedState(onSeekBackward)
    val currentOnSeekForward = rememberUpdatedState(onSeekForward)
    val currentOnPrevious = rememberUpdatedState(onPrevious)
    val currentOnNext = rememberUpdatedState(onNext)

    DisposableEffect(player) {
        val callback = object : MediaSession.Callback {
            @UnstableApi
            override fun onMediaButtonEvent(
                session: MediaSession,
                controllerInfo: MediaSession.ControllerInfo,
                intent: Intent,
            ): Boolean {
                val event = IntentCompat.getParcelableExtra(
                    intent,
                    Intent.EXTRA_KEY_EVENT,
                    KeyEvent::class.java,
                ) ?: return false
                val action = playarrMediaControlAction(event.keyCode) ?: return false
                if (event.action != KeyEvent.ACTION_DOWN || event.repeatCount > 0) return true
                when (action) {
                    PlayarrMediaControlAction.Play -> currentOnPlay.value()
                    PlayarrMediaControlAction.Pause -> currentOnPause.value()
                    PlayarrMediaControlAction.TogglePlayback -> currentOnTogglePlayback.value()
                    PlayarrMediaControlAction.Stop -> currentOnStop.value()
                    PlayarrMediaControlAction.SeekBackward -> currentOnSeekBackward.value()
                    PlayarrMediaControlAction.SeekForward -> currentOnSeekForward.value()
                    PlayarrMediaControlAction.Previous -> if (currentCanPrevious.value) currentOnPrevious.value()
                    PlayarrMediaControlAction.Next -> if (currentCanNext.value) currentOnNext.value()
                }
                return true
            }
        }
        val builder = MediaSession.Builder(context.applicationContext, player)
            .setCallback(callback)
        context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launchIntent ->
            builder.setSessionActivity(
                PendingIntent.getActivity(
                    context,
                    0,
                    launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
        }
        val session = builder.build()
        onDispose { session.release() }
    }
}
