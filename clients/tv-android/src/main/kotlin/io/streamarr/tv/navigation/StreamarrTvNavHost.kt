package io.streamarr.tv.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import io.streamarr.tv.ui.screens.HomeScreen
import io.streamarr.tv.ui.screens.LibraryScreen
import io.streamarr.tv.ui.screens.PairingScreen
import io.streamarr.tv.ui.screens.PlayerScreen
import io.streamarr.tv.ui.screens.SettingsScreen

/**
 * Root NavHost, gated by the RFC 8628 pairing state (see
 * [AuthGateViewModel]/[io.streamarr.shared.auth.TokenStore]). Composition
 * of the actual [NavHost] is deferred until `isSignedIn` resolves from
 * `null` so `startDestination` is correct on the very first frame;
 * sign-out (from Settings) is caught by the `LaunchedEffect` below and
 * routes back to [Routes.Pairing].
 */
@Composable
fun StreamarrTvNavHost(
    navController: NavHostController,
    authGateViewModel: AuthGateViewModel = hiltViewModel(),
) {
    val isSignedIn by authGateViewModel.isSignedIn.collectAsState()

    when (val signedIn = isSignedIn) {
        null -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        else -> {
            val startDestination = remember { if (signedIn) Routes.Home else Routes.Pairing }

            // Tracks the previous value so this only fires on a genuine
            // true -> false transition (an in-session sign-out), not on
            // the initial null -> {true|false} resolution above, which
            // startDestination already accounts for.
            var wasSignedIn by remember { mutableStateOf<Boolean?>(signedIn) }
            LaunchedEffect(isSignedIn) {
                if (wasSignedIn == true && isSignedIn == false) {
                    navController.navigate(Routes.Pairing) { popUpTo(0) }
                }
                wasSignedIn = isSignedIn
            }

            NavHost(navController = navController, startDestination = startDestination) {
                composable<Routes.Pairing> {
                    PairingScreen(
                        onPaired = {
                            navController.navigate(Routes.Home) {
                                popUpTo(Routes.Pairing) { inclusive = true }
                            }
                        },
                    )
                }
                composable<Routes.Home> {
                    HomeScreen(onWorkClick = { work -> navController.navigate(Routes.Player(mediaFileId = work.id)) })
                }
                composable<Routes.Library> {
                    LibraryScreen(onWorkClick = { work -> navController.navigate(Routes.Player(mediaFileId = work.id)) })
                }
                composable<Routes.Player> { backStackEntry ->
                    val route: Routes.Player = backStackEntry.toRoute()
                    PlayerScreen(mediaFileId = route.mediaFileId)
                }
                composable<Routes.Settings> {
                    SettingsScreen()
                }
            }
        }
    }
}
