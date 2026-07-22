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
import androidx.core.content.edit

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
    val playerDefaults: PlayarrPlayerDefaults,
    val setTheme: (PlayarrThemePreference) -> Unit,
    val setHomeView: (PlayarrHomeViewPreference) -> Unit,
    val setLanguage: (String) -> Unit,
    val setPlayerQuality: (String) -> Unit,
    val setSubtitleMode: (PlayarrSubtitleDefault) -> Unit,
    val setSubtitleLanguage: (String) -> Unit,
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
    var language by remember { mutableStateOf(parsePlayarrLanguagePreference(store.getString("language", null))) }
    var playerQuality by remember { mutableStateOf(parsePlayarrQualityDefault(store.getString("player_quality", null))) }
    var subtitleMode by remember { mutableStateOf(parsePlayarrSubtitleDefault(store.getString("subtitle_mode", null))) }
    var subtitleLanguage by remember { mutableStateOf(parsePlayarrSubtitleLanguage(store.getString("subtitle_language", null))) }
    val darkTheme = when (theme) {
        PlayarrThemePreference.System -> isSystemInDarkTheme()
        PlayarrThemePreference.Light -> false
        PlayarrThemePreference.Dark -> true
    }
    val value = PlayarrDisplayPreferences(
        theme = theme,
        homeView = homeView,
        language = language,
        playerDefaults = PlayarrPlayerDefaults(playerQuality, subtitleMode, subtitleLanguage),
        setTheme = {
            theme = it
            store.edit { putString("theme", it.name) }
        },
        setHomeView = {
            homeView = it
            val persisted = it.persistedValue()
            store.edit {
                if (persisted == null) remove("home_view") else putString("home_view", persisted)
            }
        },
        setLanguage = {
            language = parsePlayarrLanguagePreference(it)
            store.edit {
                if (language == "system") remove("language") else putString("language", language)
            }
        },
        setPlayerQuality = {
            playerQuality = parsePlayarrQualityDefault(it)
            store.edit { putString("player_quality", playerQuality) }
        },
        setSubtitleMode = {
            subtitleMode = it
            store.edit { putString("subtitle_mode", it.storageValue) }
        },
        setSubtitleLanguage = {
            subtitleLanguage = parsePlayarrSubtitleLanguage(it)
            store.edit { putString("subtitle_language", subtitleLanguage) }
        },
    )
    return RememberedPlayarrDisplayPreferences(value, darkTheme)
}
