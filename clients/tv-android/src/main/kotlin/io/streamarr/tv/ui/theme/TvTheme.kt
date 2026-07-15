package io.streamarr.tv.ui.theme

import androidx.compose.runtime.Composable
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.darkColorScheme
import io.streamarr.shared.designsystem.theme.StreamarrPalette

/**
 * `androidx.tv.material3.MaterialTheme` wrapper, deliberately separate
 * from `core-designsystem`'s `StreamarrTheme` (which wraps
 * `androidx.compose.material3.MaterialTheme` for mobile) -- the two
 * `MaterialTheme`s are different types with different `ColorScheme`/
 * `Typography` shapes, so they can't share one theming composable. Both
 * pull their actual color values from [StreamarrPalette] so the brand
 * stays one source of truth across apps; TV always renders dark (10-foot
 * viewing in a living room has no meaningful "light mode" case the way a
 * phone does).
 */
private val StreamarrTvColorScheme = darkColorScheme(
    primary = StreamarrPalette.Violet80,
    onPrimary = StreamarrPalette.Violet20,
    secondary = StreamarrPalette.Teal80,
    onSecondary = StreamarrPalette.Teal20,
    tertiary = StreamarrPalette.Amber80,
    error = StreamarrPalette.Error80,
    background = StreamarrPalette.SurfaceDarkTv,
    surface = StreamarrPalette.SurfaceDarkTv,
)

@Composable
fun StreamarrTvTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = StreamarrTvColorScheme,
        content = content,
    )
}
