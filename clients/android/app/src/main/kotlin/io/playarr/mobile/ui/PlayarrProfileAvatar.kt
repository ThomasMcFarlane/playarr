package io.playarr.mobile.ui

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import io.playarr.shared.auth.SavedProfileAvatar
import io.playarr.shared.data.model.ProfileAvatarKind
import io.playarr.shared.data.model.ProfileAvatarPreference

internal val playarrProfileAvatarPresetIds = listOf(
    "astronaut",
    "cat",
    "dinosaur",
    "robot",
    "pirate",
    "alien",
)

internal fun SavedProfileAvatar.toPlayarrProfileAvatarPreference(): ProfileAvatarPreference? {
    val avatarKind = when (kind) {
        "preset" -> ProfileAvatarKind.Preset
        "custom" -> ProfileAvatarKind.Custom
        else -> return null
    }
    return ProfileAvatarPreference(avatarKind, value)
}

internal fun ProfileAvatarPreference.toSavedProfileAvatar(): SavedProfileAvatar = SavedProfileAvatar(
    kind = when (kind) {
        ProfileAvatarKind.Preset -> "preset"
        ProfileAvatarKind.Custom -> "custom"
    },
    value = value,
)

private data class ProfileAvatarPresetVisual(
    val start: Color,
    val end: Color,
    val glyph: String,
)

private val profileAvatarPresetVisuals = mapOf(
    "astronaut" to ProfileAvatarPresetVisual(Color(0xFF5267AD), Color(0xFF222D5F), "🧑‍🚀"),
    "cat" to ProfileAvatarPresetVisual(Color(0xFFE37C68), Color(0xFF9C3F66), "🐈"),
    "dinosaur" to ProfileAvatarPresetVisual(Color(0xFF55A46E), Color(0xFF237265), "🦕"),
    "robot" to ProfileAvatarPresetVisual(Color(0xFF5D9CAF), Color(0xFF365383), "🤖"),
    "pirate" to ProfileAvatarPresetVisual(Color(0xFFD39A48), Color(0xFF91464C), "🏴‍☠️"),
    "alien" to ProfileAvatarPresetVisual(Color(0xFF8B71C5), Color(0xFF4A477F), "👽"),
)

internal fun defaultPlayarrProfileAvatarPreset(userId: String): String {
    var hash = 0L
    userId.forEach { character ->
        hash = (hash * 31L + character.code.toLong()) and 0xFFFF_FFFFL
    }
    return playarrProfileAvatarPresetIds[(hash % playarrProfileAvatarPresetIds.size).toInt()]
}

internal fun resolvedPlayarrProfileAvatarPreference(
    userId: String,
    preference: ProfileAvatarPreference?,
): ProfileAvatarPreference {
    val usable = when (preference?.kind) {
        ProfileAvatarKind.Preset -> preference.value in playarrProfileAvatarPresetIds
        ProfileAvatarKind.Custom -> preference.value.startsWith("data:image/jpeg;base64,")
        null -> false
    }
    return preference?.takeIf { usable } ?: ProfileAvatarPreference(
        kind = ProfileAvatarKind.Preset,
        value = defaultPlayarrProfileAvatarPreset(userId),
    )
}

@Composable
internal fun PlayarrProfileAvatar(
    userId: String,
    preference: ProfileAvatarPreference?,
    modifier: Modifier = Modifier,
    glyphSize: TextUnit = 36.sp,
) {
    val resolved = resolvedPlayarrProfileAvatarPreference(userId, preference)
    val preset = profileAvatarPresetVisuals[resolved.value]
        ?: profileAvatarPresetVisuals.getValue(defaultPlayarrProfileAvatarPreset(userId))
    Box(
        modifier = modifier
            .clip(CircleShape)
            .background(Brush.linearGradient(listOf(preset.start, preset.end)))
            .clearAndSetSemantics { },
        contentAlignment = Alignment.Center,
    ) {
        if (resolved.kind == ProfileAvatarKind.Custom) {
            val bitmap = remember(resolved.value) {
                runCatching {
                    val bytes = Base64.decode(resolved.value.substringAfter(','), Base64.DEFAULT)
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
                }.getOrNull()
            }
            if (bitmap != null) {
                Image(
                    bitmap = bitmap,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        } else {
            Text(preset.glyph, style = TextStyle(fontSize = glyphSize))
        }
    }
}
