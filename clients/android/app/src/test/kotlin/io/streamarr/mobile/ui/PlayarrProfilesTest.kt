package io.streamarr.mobile.ui

import io.streamarr.shared.data.model.AvailableProfile
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrProfilesTest {
    @Test
    fun `current profile navigates to the requested destination`() {
        val current = profile(isCurrent = true, pinLocked = true)

        assertEquals(
            ProfileActionResolution.Navigate(ProfileAction.Select),
            resolveProfileAction(current, ProfileAction.Select),
        )
        assertEquals(
            ProfileActionResolution.Navigate(ProfileAction.Settings),
            resolveProfileAction(current, ProfileAction.Settings),
        )
    }

    @Test
    fun `locked profile prompts before selection or settings`() {
        val locked = profile(isCurrent = false, pinLocked = true)

        assertEquals(
            ProfileActionResolution.PromptForPin(ProfileAction.Select),
            resolveProfileAction(locked, ProfileAction.Select),
        )
        assertEquals(
            ProfileActionResolution.PromptForPin(ProfileAction.Settings),
            resolveProfileAction(locked, ProfileAction.Settings),
        )
    }

    @Test
    fun `unlocked profile switches before selection or settings`() {
        val unlocked = profile(isCurrent = false, pinLocked = false)

        assertEquals(
            ProfileActionResolution.Switch(ProfileAction.Select),
            resolveProfileAction(unlocked, ProfileAction.Select),
        )
        assertEquals(
            ProfileActionResolution.Switch(ProfileAction.Settings),
            resolveProfileAction(unlocked, ProfileAction.Settings),
        )
    }

    private fun profile(isCurrent: Boolean, pinLocked: Boolean) = AvailableProfile(
        id = "profile-id",
        username = "viewer",
        displayName = "Viewer",
        isCurrent = isCurrent,
        pinLocked = pinLocked,
    )
}
