package io.playarr.shared.designsystem.component

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.playarr.shared.designsystem.theme.FocusMotion

/*
 * The one Playarr button family. Screens use PlayarrButton / PlayarrIconButton and never the raw Material
 * Button, OutlinedButton, TextButton or IconButton; PlayarrButtonUsageTest (app module) enforces that.
 * Every variant is rounded, shows the web focus ring (a 3 px ring outside the button, no fill change) and grows slightly on focus (television D-pad).
 */

enum class PlayarrButtonVariant { Primary, Secondary, Ghost }

enum class PlayarrButtonSize(val height: Dp, val horizontalPadding: Dp, val iconSize: Dp) {
    Small(36.dp, 14.dp, 16.dp),
    Medium(44.dp, 18.dp, 18.dp),
    Large(52.dp, 24.dp, 22.dp),
}

@Composable
private fun rememberFocusScale(focused: Boolean): Float {
    val scale by animateFloatAsState(
        targetValue = if (focused) FocusMotion.tileFocusScale else FocusMotion.restScale,
        animationSpec = tween(FocusMotion.transitionMs),
        label = "playarrButtonFocus",
    )
    return scale
}

@Composable
fun PlayarrButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: PlayarrButtonVariant = PlayarrButtonVariant.Primary,
    size: PlayarrButtonSize = PlayarrButtonSize.Medium,
    enabled: Boolean = true,
    active: Boolean = false,
    /** Optional colour overrides for buttons over artwork or on auth screens; null keeps the variant colours. */
    containerColor: Color? = null,
    contentColor: Color? = null,
    contentPadding: PaddingValues? = null,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val scheme = MaterialTheme.colorScheme
    val shape = RoundedCornerShape(50)
    val scale = rememberFocusScale(focused)
    val container: Color
    val resolvedContent: Color
    val border: BorderStroke?
    when {
        active -> { container = scheme.onSurface; resolvedContent = scheme.surface; border = null }
        variant == PlayarrButtonVariant.Primary -> { container = scheme.primary; resolvedContent = scheme.onPrimary; border = null }
        variant == PlayarrButtonVariant.Secondary ->
            { container = scheme.surfaceVariant.copy(alpha = 0.7f); resolvedContent = scheme.onSurface; border = BorderStroke(1.dp, scheme.outline.copy(alpha = 0.35f)) }
        else -> { container = Color.Transparent; resolvedContent = scheme.primary; border = null }
    }
    val finalContent = contentColor ?: resolvedContent
    Surface(
        onClick = onClick,
        enabled = enabled,
        interactionSource = source,
        shape = shape,
        color = containerColor ?: container,
        contentColor = finalContent.copy(alpha = if (enabled) 1f else 0.4f),
        border = border,
        modifier = modifier
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .playarrFocusRing(focused, LocalPlayarrFocusRing.current, offset = 2.dp)
            .defaultMinSize(minHeight = size.height),
    ) {
        ProvideTextStyle(MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold)) {
            Row(
                Modifier.padding(contentPadding ?: PaddingValues(horizontal = size.horizontalPadding)).defaultMinSize(minHeight = size.height),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                content = content,
            )
        }
    }
}

/** Round icon-only button; [contentDescription] is mandatory for accessibility. */
@Composable
fun PlayarrIconButton(
    onClick: () -> Unit,
    contentDescription: String,
    modifier: Modifier = Modifier,
    size: PlayarrButtonSize = PlayarrButtonSize.Medium,
    variant: PlayarrButtonVariant = PlayarrButtonVariant.Ghost,
    enabled: Boolean = true,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable () -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val scheme = MaterialTheme.colorScheme
    val scale = rememberFocusScale(focused)
    Surface(
        onClick = onClick,
        enabled = enabled,
        interactionSource = source,
        shape = CircleShape,
        color = if (variant == PlayarrButtonVariant.Ghost) Color.Transparent else if (variant == PlayarrButtonVariant.Primary) scheme.primary else scheme.surfaceVariant.copy(alpha = 0.7f),
        contentColor = if (variant == PlayarrButtonVariant.Primary) scheme.onPrimary else scheme.onSurface,
        border = null,
        modifier = modifier
            .size(size.height)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .playarrFocusRing(focused, LocalPlayarrFocusRing.current, offset = 2.dp)
            .semantics { this.contentDescription = contentDescription; this.role = Role.Button },
    ) {
        androidx.compose.foundation.layout.Box(contentAlignment = Alignment.Center) { content() }
    }
}
