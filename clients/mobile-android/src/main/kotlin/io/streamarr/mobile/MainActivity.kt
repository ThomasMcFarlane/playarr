package io.streamarr.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.navigation.compose.rememberNavController
import dagger.hilt.android.AndroidEntryPoint
import io.streamarr.mobile.navigation.StreamarrNavHost
import io.streamarr.mobile.update.AppUpdateEffect
import io.streamarr.shared.designsystem.theme.StreamarrTheme

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            StreamarrTheme {
                AppUpdateEffect()
                val navController = rememberNavController()
                StreamarrNavHost(navController = navController)
            }
        }
    }
}
