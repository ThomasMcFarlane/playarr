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

private class IconSpec(val name: String, val strokeWidth: Float = 1.8f) {
    val strokes = mutableListOf<String>()
    val fills = mutableListOf<String>()
    fun stroke(vararg d: String) = apply { strokes += d }
    fun fill(d: String) = apply { fills += d }
    fun build(): ImageVector {
        val b = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)
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
}
