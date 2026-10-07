package io.playarr.mobile.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/*
 * The web client's player line icons (`components/player/PlayerIcons.tsx`), ported path for
 * path so the native shell draws the same glyphs: 24 x 24 view box, 1.8 stroke, round caps and joins. Fills
 * marked `fill = true` are the solid parts web draws with `fill="currentColor" stroke="none"`.
 */
internal object WebIcons {
    private class Builder(name: String) {
        val vector = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)
        private val ink = SolidColor(Color.Black)

        fun path(d: String, fill: Boolean = false) {
            val nodes = PathParser().parsePathString(d).toNodes()
            if (fill) {
                vector.addPath(nodes, fill = ink)
            } else {
                vector.addPath(
                    nodes,
                    stroke = ink,
                    strokeLineWidth = 1.8f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }

        fun circle(cx: Float, cy: Float, r: Float, fill: Boolean = false) =
            path("M${cx - r} ${cy}a$r $r 0 1 0 ${2 * r} 0a$r $r 0 1 0 ${-2 * r} 0Z", fill)

        fun rect(x: Float, y: Float, w: Float, h: Float, rx: Float = 0f, fill: Boolean = false) {
            if (rx == 0f) {
                path("M$x ${y}h${w}v${h}h${-w}Z", fill)
            } else {
                path(
                    "M${x + rx} ${y}H${x + w - rx}a$rx $rx 0 0 1 $rx ${rx}V${y + h - rx}a$rx $rx 0 0 1 ${-rx} ${rx}" +
                        "H${x + rx}a$rx $rx 0 0 1 ${-rx} ${-rx}V${y + rx}a$rx $rx 0 0 1 $rx ${-rx}Z",
                    fill,
                )
            }
        }

        fun build(): ImageVector = vector.build()
    }

    private fun icon(name: String, block: Builder.() -> Unit): ImageVector = Builder(name).apply(block).build()

    // Player icons.
    val Play by lazy { icon("Play") { path("M7 4.5v15l13-7.5z", fill = true) } }
    val Pause by lazy {
        icon("Pause") { rect(6f, 4.5f, 4.5f, 15f, 1f, fill = true); rect(13.5f, 4.5f, 4.5f, 15f, 1f, fill = true) }
    }
    val Previous by lazy {
        icon("Previous") { rect(4.5f, 5f, 2.4f, 14f, 1f, fill = true); path("M19.5 5.5v13L8.2 12z", fill = true) }
    }
    val Next by lazy {
        icon("Next") { rect(17.1f, 5f, 2.4f, 14f, 1f, fill = true); path("M4.5 5.5v13L15.8 12z", fill = true) }
    }
    val AudioTrack by lazy {
        icon("AudioTrack") { path("M5 9.5v5h4l4.5 3.5V6L9 9.5z", fill = true); path("M16.5 9a4.5 4.5 0 0 1 0 6"); path("M19 6.5a8 8 0 0 1 0 11") }
    }
    val Subtitles by lazy {
        icon("Subtitles") {
            rect(3.5f, 5f, 17f, 14f, 2f); path("M6.5 12h4"); path("M13.5 12h4"); path("M6.5 15.5h7"); path("M15.5 15.5h2")
        }
    }
    val PlaylistQueue by lazy {
        icon("PlaylistQueue") { path("M4 6.5h10"); path("M4 11.5h10"); path("M4 16.5h7"); path("m16 14 4 2.5-4 2.5z", fill = true) }
    }
    val Health by lazy {
        icon("Health") { circle(12f, 12f, 8.5f); path("M12 11v5.5"); circle(12f, 7.8f, 0.9f, fill = true) }
    }
    val PlayOnDevice by lazy {
        icon("PlayOnDevice") { rect(2.5f, 5f, 13f, 9f, 1.2f); path("M6 18h6M9 14v4"); rect(17f, 9f, 5f, 10f, 1.2f) }
    }
    val Back by lazy { icon("Back") { path("M15 5 8 12l7 7") } }
    val Close by lazy { icon("Close") { path("M6 6l12 12"); path("M18 6 6 18") } }
    val Minimise by lazy {
        icon("Minimise") { path("M5 15h4v4"); path("m9 15-5 5"); path("M19 9h-4V5"); path("m15 9 5-5") }
    }
}
