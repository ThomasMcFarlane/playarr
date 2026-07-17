package io.streamarr.tv

import android.annotation.SuppressLint
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import dagger.hilt.android.AndroidEntryPoint
import io.streamarr.tv.ui.screens.StreamarrWebAppScreen
import io.streamarr.tv.ui.theme.StreamarrTvTheme
import io.streamarr.tv.update.AppUpdateEffect

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private var openServerEditorRequest by mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
        }

        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY

        setContent {
            StreamarrTvTheme {
                AppUpdateEffect()
                StreamarrWebAppScreen(
                    openServerEditorRequest = openServerEditorRequest,
                )
            }
        }
    }

    @SuppressLint("RestrictedApi")
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (
            event.keyCode == KeyEvent.KEYCODE_MENU &&
            event.action == KeyEvent.ACTION_DOWN &&
            event.repeatCount == 0
        ) {
            openServerEditorRequest += 1
            return true
        }
        return super.dispatchKeyEvent(event)
    }
}
