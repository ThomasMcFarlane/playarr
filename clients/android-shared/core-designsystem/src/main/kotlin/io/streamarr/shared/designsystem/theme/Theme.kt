package io.streamarr.shared.designsystem.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val StreamarrDarkColorScheme = darkColorScheme(
    primary = StreamarrPalette.Violet80,
    onPrimary = StreamarrPalette.Violet20,
    secondary = StreamarrPalette.Teal80,
    onSecondary = StreamarrPalette.Teal20,
    tertiary = StreamarrPalette.Amber80,
    error = StreamarrPalette.Error80,
    background = StreamarrPalette.SurfaceDark,
    surface = StreamarrPalette.SurfaceDark,
)

private val StreamarrLightColorScheme = lightColorScheme(
    primary = StreamarrPalette.Violet40,
    onPrimary = StreamarrPalette.SurfaceLight,
    secondary = StreamarrPalette.Teal40,
    onSecondary = StreamarrPalette.SurfaceLight,
    tertiary = StreamarrPalette.Amber40,
    error = StreamarrPalette.Error40,
    background = StreamarrPalette.SurfaceLight,
    surface = StreamarrPalette.SurfaceLight,
)

/**
 * Material 3 theme wrapper shared by the universal phone, tablet, and TV
 * application. Device-specific spacing and focus live in the responsive UI.
 */
@Composable
fun StreamarrTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) StreamarrDarkColorScheme else StreamarrLightColorScheme
    MaterialTheme(
        colorScheme = colorScheme,
        typography = StreamarrTypography,
        content = content,
    )
}
