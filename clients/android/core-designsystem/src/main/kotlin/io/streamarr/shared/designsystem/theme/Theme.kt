package io.streamarr.shared.designsystem.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val StreamarrDarkColorScheme = darkColorScheme(
    primary = StreamarrPalette.PlayarrPink,
    onPrimary = StreamarrPalette.PlayarrInk,
    secondary = StreamarrPalette.PlayarrPinkLight,
    onSecondary = StreamarrPalette.PlayarrBackground,
    tertiary = StreamarrPalette.PlayarrInkSoft,
    error = StreamarrPalette.Error80,
    background = StreamarrPalette.PlayarrBackground,
    onBackground = StreamarrPalette.PlayarrInk,
    surface = StreamarrPalette.PlayarrSurface,
    onSurface = StreamarrPalette.PlayarrInk,
    surfaceVariant = StreamarrPalette.PlayarrSurfaceSoft,
    onSurfaceVariant = StreamarrPalette.PlayarrInkSoft,
    outline = StreamarrPalette.PlayarrInkMuted,
)

private val StreamarrLightColorScheme = lightColorScheme(
    primary = StreamarrPalette.PlayarrLightAccent,
    onPrimary = StreamarrPalette.PlayarrLightSurfaceStrong,
    secondary = StreamarrPalette.PlayarrLightInkSoft,
    onSecondary = StreamarrPalette.PlayarrLightSurfaceStrong,
    tertiary = StreamarrPalette.PlayarrPink,
    error = StreamarrPalette.Error40,
    background = StreamarrPalette.PlayarrLightBackground,
    onBackground = StreamarrPalette.PlayarrLightInk,
    surface = StreamarrPalette.PlayarrLightSurface,
    onSurface = StreamarrPalette.PlayarrLightInk,
    surfaceVariant = StreamarrPalette.PlayarrLightSurfaceSoft,
    onSurfaceVariant = StreamarrPalette.PlayarrLightInkSoft,
    outline = StreamarrPalette.PlayarrLightInkMuted,
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
