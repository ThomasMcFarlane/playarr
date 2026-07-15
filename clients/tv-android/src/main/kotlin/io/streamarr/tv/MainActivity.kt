package io.streamarr.tv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.navigation.compose.rememberNavController
import dagger.hilt.android.AndroidEntryPoint
import io.streamarr.tv.navigation.StreamarrTvNavHost
import io.streamarr.tv.ui.theme.StreamarrTvTheme
import io.streamarr.tv.update.AppUpdateEffect

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            StreamarrTvTheme {
                AppUpdateEffect()
                val navController = rememberNavController()
                StreamarrTvNavHost(navController = navController)
            }
        }
    }
}
