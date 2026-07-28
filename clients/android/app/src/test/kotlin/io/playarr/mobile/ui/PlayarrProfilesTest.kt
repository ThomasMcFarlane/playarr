package io.playarr.mobile.ui

import io.playarr.shared.auth.SavedProfile
import io.playarr.shared.data.model.AvailableProfile
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

    @Test
    fun `profile chooser exposes only the current and saved Android sessions`() {
        val current = profile("current", isCurrent = true)
        val saved = profile("saved")
        val serverOnly = profile("server-only")

        assertEquals(
            listOf(current, saved),
            selectAndroidDeviceProfiles(
                available = listOf(current, saved, serverOnly),
                savedProfileIds = setOf("saved"),
                currentUserId = "current",
            ),
        )
    }

    @Test
    fun `saved sessions provide an offline profile chooser fallback`() {
        assertEquals(
            listOf(
                AvailableProfile("profile-a", "Alex", "Alex", isCurrent = true, pinLocked = false),
                AvailableProfile("profile-b", "Bailey", "Bailey", isCurrent = false, pinLocked = false),
            ),
            savedAndroidProfiles(
                profiles = listOf(
                    SavedProfile("https://playarr.example", "profile-a", "Alex"),
                    SavedProfile("https://playarr.example", "profile-b", "Bailey"),
                ),
                currentUserId = "profile-a",
            ),
        )
    }

    private fun profile(
        id: String = "profile-id",
        isCurrent: Boolean = false,
        pinLocked: Boolean = false,
    ) = AvailableProfile(
        id = id,
        username = "viewer",
        displayName = "Viewer",
        isCurrent = isCurrent,
        pinLocked = pinLocked,
    )
}
