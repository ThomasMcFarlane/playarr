package io.streamarr.tv

import android.os.Bundle
import android.view.View
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import dagger.hilt.android.AndroidEntryPoint
import io.streamarr.tv.ui.screens.StreamarrWebAppScreen
import io.streamarr.tv.ui.theme.StreamarrTvTheme
import io.streamarr.tv.update.AppUpdateEffect

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY

        setContent {
            StreamarrTvTheme {
                AppUpdateEffect()
                StreamarrWebAppScreen()
            }
        }
    }
}
