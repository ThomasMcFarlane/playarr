package io.streamarr.shared.designsystem.theme

import androidx.compose.ui.graphics.Color

/**
 * Streamarr / Playarr brand palette used by the universal Android
 * application's Material 3 colour scheme on every screen size.
 */
object StreamarrPalette {
    // Playarr Web tokens. Native clients use these exact values so moving
    // between the browser, phone, and television does not change identity.
    val PlayarrPink = Color(0xFFCF3157)
    val PlayarrPinkLight = Color(0xFFF47A91)
    val PlayarrBackground = Color(0xFF151315)
    val PlayarrSurface = Color(0xFF1B181B)
    val PlayarrSurfaceStrong = Color(0xFF211D21)
    val PlayarrSurfaceSoft = Color(0xFF312A30)
    val PlayarrInk = Color(0xFFF4F0F1)
    val PlayarrInkSoft = Color(0xFFC5B8BD)
    val PlayarrInkMuted = Color(0xFF887A82)

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
    val SurfaceDark = PlayarrBackground
    val SurfaceDarkTv = PlayarrBackground
    val SurfaceLight = Color(0xFFFFFBFF)
}
