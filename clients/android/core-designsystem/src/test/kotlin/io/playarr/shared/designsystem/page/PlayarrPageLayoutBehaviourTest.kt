package io.playarr.shared.designsystem.page

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w390dp-h844dp-xxhdpi")
class PlayarrPageLayoutBehaviourTest {
    @get:Rule
    val compose = createComposeRule()

    private fun spec(vararg actions: PlayarrPageAction, onBack: () -> Unit = {}) =
        PlayarrPageHeaderSpec("Library", null, PlayarrBack("Back", onBack), actions.toList())

    @Test
    fun theHeaderAndBackStayUpWhileLoadingAndOnError() {
        var backs = 0
        compose.setContent {
            GoldenFrame(Target.PhoneDark, 390.dp, 700.dp) {
                PlayarrPageLayout(
                    pageId = PlayarrPageId.Library,
                    header = spec(onBack = { backs++ }),
                    state = PlayarrPageState.Error(PlayarrErrorSpec("Could not load", "Try again"), onRetry = {}),
                ) { Text("content") }
            }
        }
        compose.onNodeWithText("Library").assertIsDisplayed()
        compose.onNodeWithText("content").assertDoesNotExistOrIsAbsent()
        compose.onNodeWithText("Could not load").assertIsDisplayed()
        compose.onNodeWithContentDescription("Back").performClick()
        assertEquals(1, backs)
    }

    @Test
    fun aStateReplacesTheContentAndIsTaggedForTests() {
        compose.setContent {
            GoldenFrame(Target.PhoneLight, 390.dp, 700.dp) {
                PlayarrPageLayout(PlayarrPageId.Library, spec(), state = PlayarrPageState.Loading("Loading")) { Text("content") }
            }
        }
        compose.onNode(SemanticsMatcher("loading state") { it.config.getOrNull(PlayarrPageStateKey) == "loading" }).assertIsDisplayed()
        assertTrue(compose.onAllNodesWithTextCount("content") == 0)
    }

    @Test
    fun filtersDrawsAfterTheSecondaryPillsWhateverOrderTheCallerGave() {
        compose.setContent {
            GoldenFrame(Target.TvDark, 1920.dp, 150.dp) {
                CompositionLocalProvider(LocalPlayarrFormFactor provides PlayarrFormFactor.Tv) {
                    PlayarrPageLayout(
                        PlayarrPageId.Library,
                        spec(
                            PlayarrPageAction.Filters("Filters", false, 0) {},
                            PlayarrPageAction.Panel("bell", "Calendar link", PlayarrActionIcon.Bell, false) {},
                        ),
                        PlayarrPageBody.Bleed,
                    ) {}
                }
            }
        }
        val filtersX = compose.onNodeWithContentDescription("Filters").fetchSemanticsNode().boundsInRoot.left
        val bellX = compose.onNodeWithContentDescription("Calendar link").fetchSemanticsNode().boundsInRoot.left
        assertTrue("Filters is rightmost", filtersX > bellX)
        assertFalse(filtersX == bellX)
    }
}

private fun androidx.compose.ui.test.SemanticsNodeInteraction.assertDoesNotExistOrIsAbsent() = assertDoesNotExist()
private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onAllNodesWithTextCount(text: String): Int =
    onAllNodesWithText(text).fetchSemanticsNodes().size
