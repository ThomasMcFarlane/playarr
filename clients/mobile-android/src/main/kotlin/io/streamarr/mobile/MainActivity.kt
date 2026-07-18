package io.streamarr.mobile

import android.content.Context
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
import io.streamarr.mobile.ui.LocalPlayarrDisplayPreferences
import io.streamarr.mobile.ui.PlayarrApp
import io.streamarr.mobile.ui.rememberPlayarrDisplayPreferences
import io.streamarr.mobile.ui.setPlayarrWebPalette
import io.streamarr.shared.designsystem.theme.StreamarrTheme

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun attachBaseContext(newBase: Context) {
        val configuration = Configuration(newBase.resources.configuration)
        if (isTelevision(configuration)) {
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

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        val isTelevision = isTelevision(resources.configuration)
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
        setContent {
            val display = rememberPlayarrDisplayPreferences(this)
            setPlayarrWebPalette(display.darkTheme)
            StreamarrTheme(darkTheme = display.darkTheme) {
                CompositionLocalProvider(LocalPlayarrDisplayPreferences provides display.value) {
                    PlayarrApp(isTelevision = isTelevision)
                }
            }
        }
    }
}

internal fun isTelevision(configuration: Configuration): Boolean =
    configuration.uiMode and Configuration.UI_MODE_TYPE_MASK ==
        Configuration.UI_MODE_TYPE_TELEVISION
