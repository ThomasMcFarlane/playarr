package io.playarr.mobile.ui

import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/**
 * The web client's navigation line icons (`NavIcons.tsx`), redrawn path for path so the native
 * navigation matches the web reference pixel for pixel. 24x24 viewport, 1.8 stroke, round caps and
 * joins, monochrome (tinted by the caller). Circles and rectangles are written as arc paths.
 */
private fun circle(cx: Float, cy: Float, r: Float) =
    "M${cx - r},$cy a$r,$r 0 1 0 ${2 * r},0 a$r,$r 0 1 0 ${-2 * r},0 Z"

private fun roundRect(x: Float, y: Float, w: Float, h: Float, r: Float) =
    "M${x + r},$y h${w - 2 * r} a$r,$r 0 0 1 $r,$r v${h - 2 * r} a$r,$r 0 0 1 ${-r},$r h${-(w - 2 * r)} " +
        "a$r,$r 0 0 1 ${-r},${-r} v${-(h - 2 * r)} a$r,$r 0 0 1 $r,${-r} Z"

private class IconSpec(val name: String, val strokeWidth: Float = 1.8f, val viewW: Float = 24f, val viewH: Float = 24f, val widthDp: Float = 24f, val heightDp: Float = 24f) {
    val strokes = mutableListOf<String>()
    val fills = mutableListOf<String>()
    fun stroke(vararg d: String) = apply { strokes += d }
    fun fill(d: String) = apply { fills += d }
    fun build(): ImageVector {
        val b = ImageVector.Builder(name, widthDp.dp, heightDp.dp, viewW, viewH)
        strokes.forEach {
            b.addPath(
                pathData = addPathNodes(it),
                stroke = SolidColor(Color.Black),
                strokeLineWidth = strokeWidth,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
        fills.forEach { b.addPath(pathData = addPathNodes(it), fill = SolidColor(Color.Black)) }
        return b.build()
    }
}

internal object PlayarrWebIcons {
    /** `.tv-empty-state-art` "details" graphic (48 x 32 viewport) drawn at 44 x 29.3. */
    val EmptyDetails: ImageVector by lazy {
        IconSpec("WebEmptyDetails", 1.8f, 48f, 32f, 44f, 29.3f).stroke(
            roundRect(7f, 5f, 34f, 22f, 3f), "M13 12h14M13 17h20M13 22h12", circle(35f, 11f, 2f),
        ).build()
    }
    val Bell: ImageVector by lazy {
        IconSpec("WebBell", 1.5f).stroke("M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0").build()
    }
    val FilterToggle: ImageVector by lazy {
        IconSpec("WebFilterToggle", 1.8f).stroke("M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M7 14v6").build()
    }
    val Filters: ImageVector by lazy {
        IconSpec("WebFilters", 1.5f).stroke("M4 6h16M7 12h10m-7 6h4", circle(8f, 6f, 1.5f), circle(15f, 12f, 1.5f), circle(12f, 18f, 1.5f)).build()
    }
    val Home: ImageVector by lazy {
        IconSpec("WebHome").stroke("M3 11.5 12 4l9 7.5", "M5.5 9.5V20h13V9.5", "M10 20v-6h4v6").build()
    }
    val Search: ImageVector by lazy {
        IconSpec("WebSearch").stroke(circle(10.5f, 10.5f, 6.5f), "m15.5 15.5 4.5 4.5").build()
    }
    val Movies: ImageVector by lazy {
        IconSpec("WebMovies").stroke(roundRect(3f, 5f, 18f, 14f, 2f), "m7 5 2-3M13 5l2-3M19 5l2-3")
            .fill("m10 10 5 2.5-5 2.5z").build()
    }
    val Series: ImageVector by lazy {
        IconSpec("WebSeries").stroke(roundRect(4f, 4f, 16f, 16f, 2f), "M8 9h8M8 13h8M8 17h5", "m10 1 2 3 2-3").build()
    }
    val Sites: ImageVector by lazy {
        IconSpec("WebSites").stroke(
            circle(12f, 12f, 8.5f),
            "M3.5 12h17M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5M12 3.5C9.8 5.8 8.7 8.6 8.7 12s1.1 6.2 3.3 8.5",
        ).build()
    }
    val Music: ImageVector by lazy {
        IconSpec("WebMusic").stroke("M9 18V6l10-2v12", circle(6.5f, 18.5f, 2.5f), circle(16.5f, 16.5f, 2.5f), "M9 10l10-2").build()
    }
    val Downloads: ImageVector by lazy {
        IconSpec("WebDownloads").stroke("M12 3v12", "m7 10.5 5 4.5 5-4.5", "M4.5 18.5v1.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-1.5").build()
    }
    val Playlists: ImageVector by lazy {
        IconSpec("WebPlaylists").stroke(
            "M5 6h10M5 10h10M5 14h6", "M17 13.5v6", "m17 13.5 4-1.5v5.5", circle(15.5f, 19.5f, 1.5f), circle(19.5f, 17.5f, 1.5f),
        ).build()
    }
    val Watchlist: ImageVector by lazy {
        IconSpec("WebWatchlist").stroke("M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1Z", "M12 7.5v5M9.5 10h5").build()
    }
    val Folders: ImageVector by lazy {
        IconSpec("WebFolders").stroke("M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z").build()
    }
    val Calendar: ImageVector by lazy {
        IconSpec("WebCalendar").stroke(roundRect(3.5f, 5f, 17f, 15f, 2f), "M3.5 10h17M8 3v4M16 3v4").build()
    }

    // The web player's control icons (`components/player/PlayerIcons.tsx`): 24 viewport drawn at 20 dp, 1.8 stroke.
    val PlayerPlay: ImageVector by lazy { IconSpec("WebPlayerPlay", 1.8f, widthDp = 20f, heightDp = 20f).fill("M7 4.5v15l13-7.5z").build() }
    val PlayerPause: ImageVector by lazy {
        IconSpec("WebPlayerPause", 1.8f, widthDp = 20f, heightDp = 20f).fill(roundRect(6f, 4.5f, 4.5f, 15f, 1f)).fill(roundRect(13.5f, 4.5f, 4.5f, 15f, 1f)).build()
    }
    val PlayerPrevious: ImageVector by lazy {
        IconSpec("WebPlayerPrevious", 1.8f, widthDp = 20f, heightDp = 20f).fill(roundRect(4.5f, 5f, 2.4f, 14f, 1f)).fill("M19.5 5.5v13L8.2 12z").build()
    }
    val PlayerNext: ImageVector by lazy {
        IconSpec("WebPlayerNext", 1.8f, widthDp = 20f, heightDp = 20f).fill(roundRect(17.1f, 5f, 2.4f, 14f, 1f)).fill("M4.5 5.5v13L15.8 12z").build()
    }
    val PlayerAudio: ImageVector by lazy {
        IconSpec("WebPlayerAudio", 1.8f, widthDp = 20f, heightDp = 20f).fill("M5 9.5v5h4l4.5 3.5V6L9 9.5z").stroke("M16.5 9a4.5 4.5 0 0 1 0 6", "M19 6.5a8 8 0 0 1 0 11").build()
    }
    val PlayerSubtitles: ImageVector by lazy {
        IconSpec("WebPlayerSubtitles", 1.8f, widthDp = 20f, heightDp = 20f)
            .stroke(roundRect(3.5f, 5f, 17f, 14f, 2f), "M6.5 12h4", "M13.5 12h4", "M6.5 15.5h7", "M15.5 15.5h2").build()
    }
    val PlayerPlaylist: ImageVector by lazy {
        IconSpec("WebPlayerPlaylist", 1.8f, widthDp = 20f, heightDp = 20f).stroke("M4 6.5h10", "M4 11.5h10", "M4 16.5h7").fill("m16 14 4 2.5-4 2.5z").build()
    }
    val PlayerHealth: ImageVector by lazy {
        IconSpec("WebPlayerHealth", 1.8f, widthDp = 20f, heightDp = 20f).stroke(circle(12f, 12f, 8.5f), "M12 11v5.5").fill(circle(12f, 7.8f, 0.9f)).build()
    }
    val PlayerVolumeHigh: ImageVector by lazy {
        IconSpec("WebPlayerVolumeHigh", 1.8f, widthDp = 20f, heightDp = 20f).fill("M4 9.5v5h4l5 4V5.5l-5 4z").stroke("M17 8.5a5 5 0 0 1 0 7", "M19.7 6a9 9 0 0 1 0 12").build()
    }
    val PlayerVolumeMuted: ImageVector by lazy {
        IconSpec("WebPlayerVolumeMuted", 1.8f, widthDp = 20f, heightDp = 20f).fill("M4 9.5v5h4l5 4V5.5l-5 4z").stroke("M16 10.5 21 15.5", "M21 10.5 16 15.5").build()
    }
    val PlayerFullscreenEnter: ImageVector by lazy {
        IconSpec("WebPlayerFullscreenEnter", 1.8f, widthDp = 20f, heightDp = 20f)
            .stroke("M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9", "M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9", "M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15", "M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15").build()
    }
    val PlayerFullscreenExit: ImageVector by lazy {
        IconSpec("WebPlayerFullscreenExit", 1.8f, widthDp = 20f, heightDp = 20f)
            .stroke("M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4", "M15 4v3.5A1.5 1.5 0 0 0 16.5 9H20", "M20 15h-3.5a1.5 1.5 0 0 0-1.5 1.5V20", "M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20").build()
    }
    val PlayerClose: ImageVector by lazy { IconSpec("WebPlayerClose", 1.8f, widthDp = 20f, heightDp = 20f).stroke("M6 6l12 12", "M18 6 6 18").build() }
    val PlayerMinimise: ImageVector by lazy {
        IconSpec("WebPlayerMinimise", 1.8f, widthDp = 20f, heightDp = 20f).stroke("M5 15h4v4", "m9 15-5 5", "M19 9h-4V5", "m15 9 5-5").build()
    }
    /** The "play on" device glyph: a monitor and a phone (an inline SVG in `PlayerControls.tsx`). */
    val PlayerPlayOn: ImageVector by lazy {
        IconSpec("WebPlayerPlayOn", 1.8f, widthDp = 20f, heightDp = 20f)
            .stroke(roundRect(2.5f, 5f, 13f, 9f, 1.2f), "M6 18h6M9 14v4", roundRect(17f, 9f, 5f, 10f, 1.2f)).build()
    }
}
