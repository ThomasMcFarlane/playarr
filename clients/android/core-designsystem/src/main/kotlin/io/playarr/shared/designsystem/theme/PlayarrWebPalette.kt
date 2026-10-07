package io.playarr.shared.designsystem.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color

/**
 * The Playarr Web palette (`--bg`, `--surface`, `--surface-strong`, `--surface-soft`, `--ink`, `--ink-soft`,
 * `--ink-muted`, `--accent`) for one theme. Both themes are first-class: no token exists for one theme only.
 *
 * [accent] is not pink. It is `#DFDCDD` in the dark theme and `#675961` in the light theme.
 */
@Immutable
data class PlayarrWebPalette(
    val dark: Boolean,
    val background: Color,
    val surface: Color,
    val surfaceStrong: Color,
    val surfaceSoft: Color,
    val ink: Color,
    val inkSoft: Color,
    val inkMuted: Color,
    val accent: Color,
) {
    /**
     * The focus ring colour (`--focus-ring-color`): white in the dark theme, the theme's near-black ink in the light
     * theme (owner ruling Q11).
     */
    val focusRing: Color get() = if (dark) Color.White else ink

    companion object {
        val Dark = PlayarrWebPalette(
            dark = true,
            background = Color(0xFF151315),
            surface = Color(0xFF1B181B),
            surfaceStrong = Color(0xFF211D21),
            surfaceSoft = Color(0xFF312A30),
            ink = Color(0xFFF4F0F1),
            inkSoft = Color(0xFFC5B8BD),
            inkMuted = Color(0xFF887A82),
            accent = Color(0xFFDFDCDD),
        )
        val Light = PlayarrWebPalette(
            dark = false,
            background = Color(0xFFF5F3F2),
            surface = Color(0xFFFBFAF9),
            surfaceStrong = Color.White,
            surfaceSoft = Color(0xFFDFDCDD),
            ink = Color(0xFF382621),
            inkSoft = Color(0xFF675961),
            inkMuted = Color(0xFFA5969E),
            accent = Color(0xFF675961),
        )

        fun of(dark: Boolean): PlayarrWebPalette = if (dark) Dark else Light
    }
}

/**
 * Observable holder of the active palette. It is Compose snapshot state, so any composable or draw block that reads
 * a palette token recomposes (or redraws) when the theme changes. [LocalPlayarrWebPalette] carries the same value
 * for composables that prefer to read it from the composition.
 */
object PlayarrWebTheme {
    var palette: PlayarrWebPalette by mutableStateOf(PlayarrWebPalette.Dark)
        private set

    fun select(dark: Boolean) {
        val next = PlayarrWebPalette.of(dark)
        if (palette != next) palette = next
    }
}

val LocalPlayarrWebPalette = compositionLocalOf { PlayarrWebPalette.Dark }

/** Selects the palette for [dark] and provides it to [content]. */
@Composable
fun ProvidePlayarrWebPalette(dark: Boolean, content: @Composable () -> Unit) {
    PlayarrWebTheme.select(dark)
    CompositionLocalProvider(LocalPlayarrWebPalette provides PlayarrWebTheme.palette, content = content)
}
