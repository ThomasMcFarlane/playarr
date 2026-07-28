package io.playarr.shared.designsystem.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val PlayarrDarkColorScheme = darkColorScheme(
    primary = PlayarrPalette.PlayarrPink,
    onPrimary = PlayarrPalette.PlayarrInk,
    secondary = PlayarrPalette.PlayarrPinkLight,
    onSecondary = PlayarrPalette.PlayarrBackground,
    tertiary = PlayarrPalette.PlayarrInkSoft,
    error = PlayarrPalette.Error80,
    background = PlayarrPalette.PlayarrBackground,
    onBackground = PlayarrPalette.PlayarrInk,
    surface = PlayarrPalette.PlayarrSurface,
    onSurface = PlayarrPalette.PlayarrInk,
    surfaceVariant = PlayarrPalette.PlayarrSurfaceSoft,
    onSurfaceVariant = PlayarrPalette.PlayarrInkSoft,
    outline = PlayarrPalette.PlayarrInkMuted,
)

private val PlayarrLightColorScheme = lightColorScheme(
    primary = PlayarrPalette.PlayarrLightAccent,
    onPrimary = PlayarrPalette.PlayarrLightSurfaceStrong,
    secondary = PlayarrPalette.PlayarrLightInkSoft,
    onSecondary = PlayarrPalette.PlayarrLightSurfaceStrong,
    tertiary = PlayarrPalette.PlayarrPink,
    error = PlayarrPalette.Error40,
    background = PlayarrPalette.PlayarrLightBackground,
    onBackground = PlayarrPalette.PlayarrLightInk,
    surface = PlayarrPalette.PlayarrLightSurface,
    onSurface = PlayarrPalette.PlayarrLightInk,
    surfaceVariant = PlayarrPalette.PlayarrLightSurfaceSoft,
    onSurfaceVariant = PlayarrPalette.PlayarrLightInkSoft,
    outline = PlayarrPalette.PlayarrLightInkMuted,
)

/**
 * Material 3 theme wrapper shared by the universal phone, tablet, and TV
 * application. Device-specific spacing and focus live in the responsive UI.
 */
@Composable
fun PlayarrTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) PlayarrDarkColorScheme else PlayarrLightColorScheme
    MaterialTheme(
        colorScheme = colorScheme,
        typography = PlayarrTypography,
        content = content,
    )
}
