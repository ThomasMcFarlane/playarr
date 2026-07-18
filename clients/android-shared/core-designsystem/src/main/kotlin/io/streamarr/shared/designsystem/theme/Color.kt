package io.streamarr.shared.designsystem.theme

import androidx.compose.ui.graphics.Color

/**
 * Streamarr / Playarr brand palette used by the universal Android
 * application's Material 3 colour scheme on every screen size.
 */
object StreamarrPalette {
    val Violet40 = Color(0xFF6750E4)
    val Violet80 = Color(0xFFC9BFFF)
    val Violet20 = Color(0xFF211360)

    val Teal40 = Color(0xFF1D9E93)
    val Teal80 = Color(0xFF7EDBD1)
    val Teal20 = Color(0xFF00382F)

    val Amber40 = Color(0xFFAE5F00)
    val Amber80 = Color(0xFFFFB86B)

    val Error40 = Color(0xFFBA1A1A)
    val Error80 = Color(0xFFFFB4AB)

    // TV surfaces sit further from mid-grey than mobile's: living-room
    // viewing conditions want a darker, higher-contrast background than a
    // phone held at arm's length.
    val SurfaceDark = Color(0xFF141218)
    val SurfaceDarkTv = Color(0xFF0B0A0D)
    val SurfaceLight = Color(0xFFFFFBFF)
}
