package io.streamarr.mobile.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.toRoute
import io.streamarr.mobile.R
import io.streamarr.mobile.ui.screens.HomeScreen
import io.streamarr.mobile.ui.screens.LibraryScreen
import io.streamarr.mobile.ui.screens.PlayerScreen
import io.streamarr.mobile.ui.screens.SettingsScreen

private data class BottomNavDestination(
    val route: Routes,
    val labelRes: Int,
    val icon: ImageVector,
)

private val bottomNavDestinations = listOf(
    BottomNavDestination(Routes.Home, R.string.nav_home, Icons.Filled.Home),
    BottomNavDestination(Routes.Library, R.string.nav_library, Icons.Filled.VideoLibrary),
    BottomNavDestination(Routes.Player(), R.string.nav_player, Icons.Filled.PlayArrow),
    BottomNavDestination(Routes.Settings, R.string.nav_settings, Icons.Filled.Settings),
)

@Composable
fun StreamarrNavHost(navController: NavHostController) {
    Scaffold(
        bottomBar = { StreamarrBottomBar(navController) },
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Routes.Home,
            modifier = Modifier.padding(innerPadding),
        ) {
            composable<Routes.Home> {
                HomeScreen(onWorkClick = { work -> navController.navigateToWorkPlayback(work.id) })
            }
            composable<Routes.Library> {
                LibraryScreen(onWorkClick = { work -> navController.navigateToWorkPlayback(work.id) })
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

/**
 * Placeholder navigation from a catalog tile straight into the player.
 * A real flow would land on a work-detail screen first (season/media-file
 * picker) rather than assuming `work.id` is itself a playable media file
 * id -- left as a follow-up once `GetWorkDetailsUseCase` has a screen.
 */
private fun NavHostController.navigateToWorkPlayback(workId: String) {
    navigate(Routes.Player(mediaFileId = workId))
}

@Composable
private fun StreamarrBottomBar(navController: NavHostController) {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = backStackEntry?.destination

    NavigationBar {
        bottomNavDestinations.forEach { destination ->
            val selected = currentDestination?.hierarchy?.any { it.hasRoute(destination.route::class) } == true
            NavigationBarItem(
                selected = selected,
                onClick = {
                    navController.navigate(destination.route) {
                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                },
                icon = { Icon(destination.icon, contentDescription = null) },
                label = { Text(stringResource(destination.labelRes)) },
            )
        }
    }
}
