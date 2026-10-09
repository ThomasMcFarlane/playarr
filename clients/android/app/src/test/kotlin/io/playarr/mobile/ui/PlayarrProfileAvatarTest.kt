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

    @Test
    fun `preset ids and gradient colours match the shared source of truth`() {
        // Gradle runs unit tests with the module directory (clients/android/app) as the working directory.
        val shared = java.io.File("../../shared/profile-avatars/presets.json").readText()
        val presets = Regex(""""id":\s*"(\w+)",\s*"start":\s*"(#\w+)",\s*"end":\s*"(#\w+)"""").findAll(shared)
            .map { Triple(it.groupValues[1], it.groupValues[2].uppercase(), it.groupValues[3].uppercase()) }.toList()

        assertEquals(playarrProfileAvatarPresetIds, presets.map { it.first })
        assertEquals(
            presets.map { it.second to it.third },
            presets.map { (id, _, _) ->
                val visual = playarrProfileAvatarPresetColours(id)
                hex(visual.first) to hex(visual.second)
            },
        )
    }

    private fun hex(argb: Long): String = "#%06X".format(argb and 0xFFFFFF)

    @Test
    fun `preset drawables are generated from the shared presets`() {
        val node = try {
            ProcessBuilder("node", "../scripts/gen-avatar-drawables.mjs", "--check").redirectErrorStream(true).start()
        } catch (_: java.io.IOException) {
            org.junit.Assume.assumeTrue("node is not available", false)
            return
        }
        val output = node.inputStream.bufferedReader().readText()
        assertEquals(output, 0, node.waitFor())
    }
}
