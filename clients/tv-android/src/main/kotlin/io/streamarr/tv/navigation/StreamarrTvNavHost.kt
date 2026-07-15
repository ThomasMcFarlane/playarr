package io.streamarr.tv.navigation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.toRoute
import androidx.tv.material3.Button
import androidx.tv.material3.Text
import io.streamarr.tv.R
import io.streamarr.tv.ui.screens.HomeScreen
import io.streamarr.tv.ui.screens.LibraryScreen
import io.streamarr.tv.ui.screens.PairingScreen
import io.streamarr.tv.ui.screens.PlayerScreen
import io.streamarr.tv.ui.screens.RequestsScreen
import io.streamarr.tv.ui.screens.SettingsScreen
import io.streamarr.tv.ui.screens.WorkDetailScreen

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

            Column(modifier = Modifier.fillMaxSize()) {
                if (signedIn) {
                    StreamarrTvTopBar(navController)
                }
                NavHost(navController = navController, startDestination = startDestination, modifier = Modifier.fillMaxSize()) {
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
                        HomeScreen(onWorkClick = { work -> navController.navigate(Routes.WorkDetail(workId = work.id)) })
                    }
                    composable<Routes.Library> {
                        LibraryScreen(onWorkClick = { work -> navController.navigate(Routes.WorkDetail(workId = work.id)) })
                    }
                    composable<Routes.WorkDetail> { backStackEntry ->
                        val route: Routes.WorkDetail = backStackEntry.toRoute()
                        WorkDetailScreen(
                            workId = route.workId,
                            onPlayMediaFile = { mediaFileId -> navController.navigate(Routes.Player(mediaFileId = mediaFileId)) },
                        )
                    }
                    composable<Routes.Player> { backStackEntry ->
                        val route: Routes.Player = backStackEntry.toRoute()
                        PlayerScreen(mediaFileId = route.mediaFileId)
                    }
                    composable<Routes.Requests> {
                        RequestsScreen()
                    }
                    composable<Routes.Settings> {
                        SettingsScreen()
                    }
                }
            }
        }
    }
}

private data class TvNavDestination(val route: Routes, val labelRes: Int)

private val tvTopBarDestinations = listOf(
    TvNavDestination(Routes.Home, R.string.nav_home),
    TvNavDestination(Routes.Library, R.string.nav_library),
    TvNavDestination(Routes.Requests, R.string.nav_requests),
    TvNavDestination(Routes.Settings, R.string.nav_settings),
)

/**
 * A persistent, d-pad-focusable row of top-level destinations -- the TV
 * equivalent of mobile's bottom [androidx.compose.material3.NavigationBar].
 * Built on [androidx.tv.material3.Button] (rather than
 * `androidx.tv.material3.TabRow`/`Tab`) since `Button` is already the
 * proven, d-pad-focusable clickable surface used elsewhere in this app
 * (`WorkDetailScreen`, `SettingsScreen`).
 */
@Composable
private fun StreamarrTvTopBar(navController: NavHostController) {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = backStackEntry?.destination

    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 48.dp, vertical = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        tvTopBarDestinations.forEach { destination ->
            val selected = currentDestination?.hasRoute(destination.route::class) == true
            Button(
                onClick = {
                    navController.navigate(destination.route) {
                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                },
                enabled = !selected,
            ) {
                Text(stringResource(destination.labelRes))
            }
        }
    }
}
