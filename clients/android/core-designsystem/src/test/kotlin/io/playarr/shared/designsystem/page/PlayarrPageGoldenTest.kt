package io.playarr.shared.designsystem.page

import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Golden images of the shared page components: the header, the action pill in every state, the edge fades and the
 * states, for the television and phone layouts in both themes. A pixel change here is a change to the shared look,
 * which needs an owner request (docs/design/page-layout.md section 7.4). Record with
 * `./gradlew :core-designsystem:recordRoborazziDebug`; CI runs `verifyRoborazziDebug`.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w1920dp-h1080dp-mdpi")
class PlayarrPageGoldenTest(private val target: Target) {
    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun targets() = Target.entries.toList()
    }

    @get:Rule
    val compose = createComposeRule()

    private val tv get() = target.formFactor == PlayarrFormFactor.Tv
    private val width get() = if (tv) 1920.dp else 390.dp

    private fun header(
        title: String = "Library",
        detail: String? = null,
        actions: List<PlayarrPageAction> = emptyList(),
        backActive: Boolean = false,
    ) = PlayarrPageHeaderSpec(title, detail, PlayarrBack("Back") {}, actions, backActive = backActive)

    private fun shootHeader(name: String, spec: PlayarrPageHeaderSpec) {
        compose.setContent {
            GoldenFrame(target, width, if (tv) 150.dp else 64.dp) {
                PlayarrPageLayout(PlayarrPageId.Library, spec, PlayarrPageBody.Bleed) {}
            }
        }
        compose.onRoot().captureRoboImage(golden("header-$name-${target.slug}"))
    }

    @Test
    fun headerPlain() = shootHeader("plain", header())

    @Test
    fun headerDetail() = shootHeader("detail", header(detail = "420 TITLES"))

    @Test
    fun headerSettingsIndex() = shootHeader("back-active", header(title = "Settings", backActive = true))

    @Test
    fun headerAllActions() = shootHeader(
        "actions",
        header(
            actions = listOf(
                // Deliberately out of order: the header sorts them.
                PlayarrPageAction.Filters("Filters", open = false, activeCount = 2) {},
                PlayarrPageAction.Link("customise", "Customise", PlayarrActionIcon.Customise) {},
                PlayarrPageAction.Panel("bell", "Calendar link", PlayarrActionIcon.Bell, open = true) {},
                PlayarrPageAction.Navigation(
                    "period",
                    listOf(
                        PlayarrNavItem("prev", "Previous", PlayarrActionIcon.Prev) {},
                        PlayarrNavItem("today", "Today", null) {},
                        PlayarrNavItem("next", "Next", PlayarrActionIcon.Next) {},
                    ),
                ),
            ),
        ),
    )

    private fun shootPill(name: String, active: Boolean = false, count: Int = 0, focused: Boolean = false, icon: PlayarrActionIcon = PlayarrActionIcon.Filters, label: String = "Filters") {
        val focus = FocusRequester()
        compose.setContent {
            GoldenFrame(target, 160.dp, 140.dp) {
                Box(Modifier.fillMaxSize().padding(24.dp)) {
                    PlayarrActionPill(icon, label, {}, active = active, count = count, focusRequester = focus)
                }
            }
        }
        if (focused) {
            compose.runOnIdle { focus.requestFocus() }
            compose.waitForIdle()
            compose.mainClock.advanceTimeBy(400)
            compose.onNodeWithContentDescription(label).assertIsFocused()
        }
        compose.onRoot().captureRoboImage(golden("pill-$name-${target.slug}"))
    }

    @Test
    fun pillRest() = shootPill("rest")

    /** The Create pill on phones must draw the add glyph, not the Filters one (golden pins it). */
    @Test
    fun pillCreate() = shootPill("create", icon = PlayarrActionIcon.Add, label = "Create")

    @Test
    fun pillBell() = shootPill("bell", icon = PlayarrActionIcon.Bell, label = "Calendar link")

    @Test
    fun pillOpen() = shootPill("open", active = true)

    @Test
    fun pillCount() = shootPill("count", count = 3)

    @Test
    fun pillFocus() = shootPill("focus", focused = true)

    @Test
    fun edgeFadeVertical() {
        compose.setContent {
            GoldenFrame(target, 360.dp, 280.dp) {
                Box(Modifier.fillMaxSize().playarrEdgeFades(canScrollBackward = true, canScrollForward = true, axis = Orientation.Vertical))
            }
        }
        compose.onRoot().captureRoboImage(golden("fade-vertical-${target.slug}"))
    }

    @Test
    fun edgeFadeHorizontal() {
        compose.setContent {
            GoldenFrame(target, 360.dp, 280.dp) {
                Box(Modifier.fillMaxSize().playarrEdgeFades(canScrollBackward = true, canScrollForward = true, axis = Orientation.Horizontal))
            }
        }
        compose.onRoot().captureRoboImage(golden("fade-horizontal-${target.slug}"))
    }

    @Test
    fun states() {
        compose.setContent {
            GoldenFrame(target, 420.dp, 640.dp) {
                androidx.compose.foundation.layout.Column(Modifier.fillMaxSize()) {
                    Box(Modifier.weight(1f)) { PlayarrLoadingState("Loading") }
                    Box(Modifier.weight(1f)) { PlayarrEmptyState(PlayarrEmptySpec("Nothing here", "Add something to see it.")) }
                    Box(Modifier.weight(1f)) { PlayarrErrorState(PlayarrErrorSpec("Could not load", "Try again")) {} }
                }
            }
        }
        compose.onRoot().captureRoboImage(golden("states-${target.slug}"))
    }
}
