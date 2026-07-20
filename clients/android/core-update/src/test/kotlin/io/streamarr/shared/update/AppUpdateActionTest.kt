package io.streamarr.shared.update

import com.google.android.play.core.install.model.AppUpdateType
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Exercises [resolveUpdateAction] against hand-built [AppUpdateSnapshot]
 * fixtures standing in for a mocked `AppUpdateManager`/`AppUpdateInfo` --
 * see [AppUpdateSnapshot]'s KDoc for why the seam is a plain DTO rather
 * than the real (unconstructable-outside-Play-Core) `AppUpdateInfo`.
 */
class AppUpdateActionTest {

    private val flexibleAndImmediateAllowed = AppUpdateSnapshot(
        updateAvailable = true,
        availableVersionCode = 42,
        isFlexibleUpdateAllowed = true,
        isImmediateUpdateAllowed = true,
    )

    @Test
    fun `no severity means no action, regardless of what Play reports`() {
        assertEquals(AppUpdateAction.None, resolveUpdateAction(UpdateSeverity.None, flexibleAndImmediateAllowed))
    }

    @Test
    fun `Recommended severity starts a Flexible flow when Play has an update and allows it`() {
        val action = resolveUpdateAction(UpdateSeverity.Recommended("2.4.1"), flexibleAndImmediateAllowed)
        assertEquals(AppUpdateAction.Start(AppUpdateType.FLEXIBLE), action)
    }

    @Test
    fun `Required severity starts an Immediate flow when Play has an update and allows it`() {
        val action = resolveUpdateAction(UpdateSeverity.Required("2.2.0"), flexibleAndImmediateAllowed)
        assertEquals(AppUpdateAction.Start(AppUpdateType.IMMEDIATE), action)
    }

    @Test
    fun `a severity with no matching Play update available takes no action`() {
        val noPlayUpdate = flexibleAndImmediateAllowed.copy(updateAvailable = false)
        assertEquals(AppUpdateAction.None, resolveUpdateAction(UpdateSeverity.Required("2.2.0"), noPlayUpdate))
        assertEquals(AppUpdateAction.None, resolveUpdateAction(UpdateSeverity.Recommended("2.4.1"), noPlayUpdate))
    }

    @Test
    fun `Required severity takes no action when Play disallows an Immediate flow, even though an update is available`() {
        val immediateDisallowed = flexibleAndImmediateAllowed.copy(isImmediateUpdateAllowed = false)
        assertEquals(AppUpdateAction.None, resolveUpdateAction(UpdateSeverity.Required("2.2.0"), immediateDisallowed))
    }

    @Test
    fun `Recommended severity takes no action when Play disallows a Flexible flow, even though an update is available`() {
        val flexibleDisallowed = flexibleAndImmediateAllowed.copy(isFlexibleUpdateAllowed = false)
        assertEquals(AppUpdateAction.None, resolveUpdateAction(UpdateSeverity.Recommended("2.4.1"), flexibleDisallowed))
    }

    @Test
    fun `Required severity ignores whether Flexible is allowed -- it only ever asks for Immediate`() {
        val onlyFlexibleAllowed = flexibleAndImmediateAllowed.copy(isImmediateUpdateAllowed = false, isFlexibleUpdateAllowed = true)
        assertEquals(AppUpdateAction.None, resolveUpdateAction(UpdateSeverity.Required("2.2.0"), onlyFlexibleAllowed))
    }
}
