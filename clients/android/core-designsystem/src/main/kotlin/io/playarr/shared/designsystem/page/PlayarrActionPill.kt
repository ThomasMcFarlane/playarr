package io.playarr.shared.designsystem.page

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.playarr.shared.designsystem.theme.PlayarrWebTheme

/**
 * The one header action look (Filters, Calendar link, Create, Customise Home): the 30 September web library Filters
 * launcher (spec section 2.1, owner decision Q1). A 14 dp tile with the glyph above a small bold label (an icon-only
 * 44 dp square on phones), glass fill, hairline border and a soft shadow. Focus draws the ring at 1.06x and never
 * fills the tile; the open state ([active]) keeps the ink fill.
 *
 * Screens never call this directly (public only while a few screens still build their own action row): they describe a
 * [PlayarrPageAction] and the page header draws it. The round variant
 * (Back and the period arrows, owner decision Q10) is not a tile and lives in the page header.
 */
@Composable
fun PlayarrActionPill(
    icon: PlayarrActionIcon,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    active: Boolean = false,
    count: Int = 0,
    focusRequester: FocusRequester? = null,
) {
    val tv = LocalPlayarrFormFactor.current == PlayarrFormFactor.Tv
    val metrics = PlayarrPageTokens.current()
    val palette = PlayarrWebTheme.palette
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val focusScale = if (focused) 1.06f else 1f
    val tile = RoundedCornerShape(metrics.pillRadius)
    CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides Dp.Unspecified) {
        Surface(
            onClick = onClick,
            interactionSource = source,
            modifier = modifier
                .then(if (tv) Modifier.widthIn(min = metrics.pillWidth).height(metrics.pillHeight) else Modifier.size(metrics.pillWidth, metrics.pillHeight))
                .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
                .graphicsLayer { scaleX = focusScale; scaleY = focusScale }
                .shadow(14.dp, tile, clip = false, ambientColor = Color(0x14382621), spotColor = Color(0x14382621))
                .then(if (focused) Modifier.playarrFocusRing(PlayarrRingShape.Rounded(metrics.pillRadius)) else Modifier)
                .semantics { contentDescription = label },
            shape = tile,
            // Focus draws the ring only; the open state (panel shown) keeps the ink fill.
            color = if (active) palette.ink else palette.surfaceStrong.copy(alpha = 0.78f),
            contentColor = if (active) palette.background else if (focused) palette.ink else palette.inkMuted,
            border = BorderStroke(1.dp, palette.launcherBorder),
        ) {
            val vector = icon.vector
            if (tv) {
                Column(
                    Modifier.padding(horizontal = 4.dp, vertical = 7.2.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(5.6.dp, Alignment.CenterVertically),
                ) {
                    if (vector != null) Icon(vector, contentDescription = null, modifier = Modifier.size(24.dp))
                    Text(label, fontSize = 8.256.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.165.sp, maxLines = 1)
                    if (count > 0) {
                        Surface(color = palette.accent, shape = CircleShape) {
                            Text(
                                count.toString(),
                                color = Color.White,
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 6.dp),
                            )
                        }
                    }
                }
            } else {
                Box(contentAlignment = Alignment.Center) {
                    if (vector != null) Icon(vector, contentDescription = null, modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}
