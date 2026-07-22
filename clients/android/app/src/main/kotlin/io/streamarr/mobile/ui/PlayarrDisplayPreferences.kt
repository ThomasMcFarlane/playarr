package io.streamarr.mobile.ui

import android.content.Context
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

internal enum class PlayarrThemePreference { System, Light, Dark }

internal enum class PlayarrHomeViewPreference { Thumbnail, Cover }

internal fun parsePlayarrHomeViewPreference(value: String?): PlayarrHomeViewPreference =
    if (value == "cover") PlayarrHomeViewPreference.Cover else PlayarrHomeViewPreference.Thumbnail

internal fun PlayarrHomeViewPreference.persistedValue(): String? =
    if (this == PlayarrHomeViewPreference.Cover) "cover" else null

@Immutable
internal data class PlayarrDisplayPreferences(
    val theme: PlayarrThemePreference,
    val homeView: PlayarrHomeViewPreference,
    val language: String,
    val setTheme: (PlayarrThemePreference) -> Unit,
    val setHomeView: (PlayarrHomeViewPreference) -> Unit,
    val setLanguage: (String) -> Unit,
)

internal val LocalPlayarrDisplayPreferences = compositionLocalOf<PlayarrDisplayPreferences> {
    error("Playarr display preferences are not available")
}

internal data class RememberedPlayarrDisplayPreferences(
    val value: PlayarrDisplayPreferences,
    val darkTheme: Boolean,
)

@Composable
internal fun rememberPlayarrDisplayPreferences(context: Context): RememberedPlayarrDisplayPreferences {
    val store = remember(context) { context.getSharedPreferences("playarr_display", Context.MODE_PRIVATE) }
    var theme by remember {
        mutableStateOf(
            runCatching { PlayarrThemePreference.valueOf(store.getString("theme", null).orEmpty()) }
                .getOrDefault(PlayarrThemePreference.System),
        )
    }
    var homeView by remember {
        mutableStateOf(parsePlayarrHomeViewPreference(store.getString("home_view", null)))
    }
    var language by remember { mutableStateOf(store.getString("language", "system") ?: "system") }
    val darkTheme = when (theme) {
        PlayarrThemePreference.System -> isSystemInDarkTheme()
        PlayarrThemePreference.Light -> false
        PlayarrThemePreference.Dark -> true
    }
    val value = PlayarrDisplayPreferences(
        theme = theme,
        homeView = homeView,
        language = language,
        setTheme = {
            theme = it
            store.edit().putString("theme", it.name).apply()
        },
        setHomeView = {
            homeView = it
            val persisted = it.persistedValue()
            if (persisted == null) {
                store.edit().remove("home_view").apply()
            } else {
                store.edit().putString("home_view", persisted).apply()
            }
        },
        setLanguage = {
            language = it
            store.edit().putString("language", it).apply()
        },
    )
    return RememberedPlayarrDisplayPreferences(value, darkTheme)
}
