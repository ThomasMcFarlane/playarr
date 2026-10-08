package io.playarr.shared.designsystem.page

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import io.playarr.shared.designsystem.theme.PlayarrWebTheme

/** One rendering target of the screenshot tests: a form factor in a theme. */
enum class Target(val formFactor: PlayarrFormFactor, val dark: Boolean, val slug: String) {
    TvDark(PlayarrFormFactor.Tv, true, "tv-dark"),
    TvLight(PlayarrFormFactor.Tv, false, "tv-light"),
    PhoneDark(PlayarrFormFactor.Phone, true, "phone-dark"),
    PhoneLight(PlayarrFormFactor.Phone, false, "phone-light"),
}

/** Golden images live next to the module's tests (docs/design/page-layout.md section 7.3). */
fun golden(name: String) = "src/test/snapshots/$name.png"

/** Renders [content] in a box of the given size, on the page surface, as [target]. */
@Composable
fun GoldenFrame(target: Target, width: Dp, height: Dp, content: @Composable () -> Unit) {
    PlayarrWebTheme.select(target.dark)
    // A D-pad remote: clickable elements only take focus in keyboard input mode.
    val inputMode = LocalInputModeManager.current
    LaunchedEffect(Unit) { inputMode.requestInputMode(InputMode.Keyboard) }
    CompositionLocalProvider(LocalPlayarrFormFactor provides target.formFactor) {
        Box(Modifier.size(width, height).background(PlayarrWebTheme.palette.surface)) { content() }
    }
}
