package io.playarr.mobile

import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Rational
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import io.playarr.mobile.ui.PIP_CONTROL_ACTION
import io.playarr.mobile.ui.PIP_CONTROL_EXTRA
import io.playarr.mobile.ui.PlayarrPictureInPicture
import io.playarr.mobile.ui.PlayarrPipControl
import io.playarr.mobile.ui.PlayarrPipState
import io.playarr.mobile.ui.playarrPipSupported
import io.playarr.mobile.ui.playarrPipWindowDismissed
import io.playarr.mobile.ui.playarrShouldEnterPipOnLeave
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.util.DisplayMetrics
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import dagger.hilt.android.AndroidEntryPoint
import io.playarr.mobile.ui.LocalPlayarrDisplayPreferences
import io.playarr.mobile.ui.PlayarrApp
import io.playarr.mobile.ui.rememberPlayarrDisplayPreferences
import io.playarr.mobile.ui.setPlayarrWebPalette
import io.playarr.mobile.update.AppUpdateEffect
import io.playarr.shared.designsystem.theme.PlayarrTheme

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun attachBaseContext(newBase: Context) {
        val configuration = Configuration(newBase.resources.configuration)
        if (isTelevision(newBase)) {
            // Playarr Web's TV canvas is an explicit 1920x1080 CSS-pixel
            // viewport. Android TV commonly reports 320 dpi, which would
            // otherwise make every copied 64 px control render as 128 px.
            // A 160 dpi activity context keeps native Compose geometry at
            // the same physical pixel scale without changing phone/tablet
            // density or using a WebView.
            configuration.densityDpi = DisplayMetrics.DENSITY_DEFAULT
        }
        super.attachBaseContext(newBase.createConfigurationContext(configuration))
    }

    private val pipControlReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != PIP_CONTROL_ACTION) return
            PlayarrPipControl.fromWire(intent.getStringExtra(PIP_CONTROL_EXTRA))
                ?.let { PlayarrPictureInPicture.onControl?.invoke(it) }
        }
    }
    private var pipReceiverRegistered = false

    private fun pipFeature(): Boolean =
        playarrPipSupported(packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE))

    private fun pipAction(control: PlayarrPipControl, icon: Int, label: String): RemoteAction {
        val intent = Intent(PIP_CONTROL_ACTION).setPackage(packageName).putExtra(PIP_CONTROL_EXTRA, control.wire)
        val pending = PendingIntent.getBroadcast(
            this,
            control.ordinal,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return RemoteAction(Icon.createWithResource(this, icon), label, label, pending)
    }

    private fun pipParams(state: PlayarrPipState): PictureInPictureParams {
        val labels = state.labels
        val builder = PictureInPictureParams.Builder()
            .setAspectRatio(Rational(state.aspect.numerator, state.aspect.denominator))
            .setActions(
                listOf(
                    pipAction(PlayarrPipControl.SkipBack, android.R.drawable.ic_media_rew, labels.skipBack),
                    if (state.playing) {
                        pipAction(PlayarrPipControl.PlayPause, android.R.drawable.ic_media_pause, labels.pause)
                    } else {
                        pipAction(PlayarrPipControl.PlayPause, android.R.drawable.ic_media_play, labels.play)
                    },
                    pipAction(PlayarrPipControl.SkipForward, android.R.drawable.ic_media_ff, labels.skipForward),
                ),
            )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(state.eligible && state.playing).setSeamlessResizeEnabled(false)
        }
        return builder.build()
    }

    private fun enterPip(): Boolean {
        if (!pipFeature()) return false
        return runCatching { enterPictureInPictureMode(pipParams(PlayarrPictureInPicture.state.value)) }
            .getOrDefault(false)
    }

    override fun onDestroy() {
        if (pipReceiverRegistered) {
            unregisterReceiver(pipControlReceiver)
            pipReceiverRegistered = false
        }
        PlayarrPictureInPicture.setInPip(false)
        super.onDestroy()
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // API 31+ enters through setAutoEnterEnabled; older versions enter here.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && pipFeature()) {
            val state = PlayarrPictureInPicture.state.value
            if (playarrShouldEnterPipOnLeave(state.eligible, state.playing)) enterPip()
        }
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        PlayarrPictureInPicture.setInPip(isInPictureInPictureMode)
        if (isInPictureInPictureMode) {
            if (!pipReceiverRegistered) {
                ContextCompat.registerReceiver(
                    this,
                    pipControlReceiver,
                    IntentFilter(PIP_CONTROL_ACTION),
                    ContextCompat.RECEIVER_NOT_EXPORTED,
                )
                pipReceiverRegistered = true
            }
        } else {
            if (pipReceiverRegistered) {
                unregisterReceiver(pipControlReceiver)
                pipReceiverRegistered = false
            }
            // Closing the PiP window stops the activity; expanding leaves it started.
            if (playarrPipWindowDismissed(leftPip = true, lifecycleState = lifecycle.currentState)) {
                PlayarrPictureInPicture.onWindowClosed?.invoke()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        PlayarrPictureInPicture.supported = pipFeature()
        PlayarrPictureInPicture.requestEnter = ::enterPip
        if (PlayarrPictureInPicture.supported) {
            lifecycleScope.launch {
                PlayarrPictureInPicture.state.collect { state ->
                    runCatching { setPictureInPictureParams(pipParams(state)) }
                }
            }
        }
        val isTelevision = isTelevision(this) ||
            intent.hasCategory(Intent.CATEGORY_LEANBACK_LAUNCHER)
        if (isTelevision) {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        } else {
            enableEdgeToEdge(
                statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
                navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            )
        }
        io.playarr.mobile.ui.parityNoInsets = !isTelevision &&
            (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0 &&
            intent.getBooleanExtra("parity_no_insets", false)
        io.playarr.mobile.ui.parityPauseAtMs = intent.getLongExtra("parity_pause_at_ms", -1L).takeIf {
            it >= 0L && (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
        }
        setContent {
            val display = rememberPlayarrDisplayPreferences(this)
            setPlayarrWebPalette(display.darkTheme)
            io.playarr.mobile.ui.setPlayarrWebFont(!isTelevision)
            PlayarrTheme(darkTheme = display.darkTheme) {
                CompositionLocalProvider(LocalPlayarrDisplayPreferences provides display.value) {
                    androidx.compose.material3.ProvideTextStyle(
                        androidx.compose.ui.text.TextStyle(
                            fontFamily = io.playarr.mobile.ui.webFontFamily,
                            textMotion = if (io.playarr.mobile.ui.webFontFamily != null) androidx.compose.ui.text.style.TextMotion.Animated else null,
                        ),
                    ) {
                        PlayarrApp(isTelevision = isTelevision)
                    }
                    if (!isTelevision) AppUpdateEffect()
                }
            }
        }
    }
}

@Suppress("DEPRECATION")
internal fun isTelevision(context: Context): Boolean = isTelevision(
    uiModeType = context.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK,
    hasLeanbackFeature = context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK),
    hasTelevisionFeature = context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEVISION),
)

internal fun isTelevision(
    uiModeType: Int,
    hasLeanbackFeature: Boolean,
    hasTelevisionFeature: Boolean,
): Boolean =
    uiModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
        hasLeanbackFeature ||
        hasTelevisionFeature
