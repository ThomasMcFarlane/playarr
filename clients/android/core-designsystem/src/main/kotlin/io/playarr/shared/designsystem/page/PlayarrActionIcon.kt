package io.playarr.shared.designsystem.page

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.ui.graphics.vector.ImageVector
import io.playarr.shared.designsystem.icons.PlayarrWebIcons

/**
 * The one icon map for header actions (web `ActionIcon`). Pages name an icon, never a vector, so a glyph cannot drift
 * between pages. [Back], [Prev] and [Next] are the round arrows, drawn as the web's text glyphs.
 */
enum class PlayarrActionIcon(internal val glyph: String? = null) {
    Filters,
    Bell,
    Add,
    Customise,
    Prev("←"),
    Next("→"),
    Back("←"),
    ;

    /** The line icon, or null for the text-glyph arrows. */
    internal val vector: ImageVector?
        get() = when (this) {
            Filters -> PlayarrWebIcons.Filters
            Bell -> PlayarrWebIcons.Bell
            Add -> Icons.Outlined.Add
            Customise -> Icons.Outlined.Tune
            Prev, Next, Back -> null
        }
}
