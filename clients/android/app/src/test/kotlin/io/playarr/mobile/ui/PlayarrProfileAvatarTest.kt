package io.playarr.mobile.ui

import io.playarr.shared.auth.SavedProfileAvatar
import io.playarr.shared.data.model.ProfileAvatarKind
import io.playarr.shared.data.model.ProfileAvatarPreference
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrProfileAvatarTest {
    @Test
    fun `native avatar presets match the server and Playarr Web contract`() {
        assertEquals(
            listOf("astronaut", "cat", "dinosaur", "robot", "pirate", "alien"),
            playarrProfileAvatarPresetIds,
        )
    }

    @Test
    fun `invalid or absent preferences use the deterministic account fallback`() {
        val userId = "22222222-2222-4222-8222-222222222222"
        val fallback = resolvedPlayarrProfileAvatarPreference(userId, null)

        assertEquals(ProfileAvatarKind.Preset, fallback.kind)
        assertEquals("dinosaur", fallback.value)
        assertEquals(defaultPlayarrProfileAvatarPreset(userId), fallback.value)
        assertEquals(
            fallback,
            resolvedPlayarrProfileAvatarPreference(
                userId,
                ProfileAvatarPreference(ProfileAvatarKind.Preset, "orbit"),
            ),
        )
    }

    @Test
    fun `valid server preferences remain unchanged`() {
        val preset = ProfileAvatarPreference(ProfileAvatarKind.Preset, "robot")
        val custom = ProfileAvatarPreference(ProfileAvatarKind.Custom, "data:image/jpeg;base64,AA==")

        assertEquals(preset, resolvedPlayarrProfileAvatarPreference("user", preset))
        assertEquals(custom, resolvedPlayarrProfileAvatarPreference("user", custom))
    }

    @Test
    fun `saved session avatars round trip through the wire preference types`() {
        val preset = ProfileAvatarPreference(ProfileAvatarKind.Preset, "robot")
        val custom = ProfileAvatarPreference(ProfileAvatarKind.Custom, "data:image/jpeg;base64,AA==")

        assertEquals(preset, preset.toSavedProfileAvatar().toPlayarrProfileAvatarPreference())
        assertEquals(custom, custom.toSavedProfileAvatar().toPlayarrProfileAvatarPreference())
        assertEquals(null, SavedProfileAvatar("unexpected", "robot").toPlayarrProfileAvatarPreference())
    }
}
