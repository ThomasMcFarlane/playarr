package io.playarr.mobile.ui

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.playarr.mobile.R
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

/** Web `PROFILE_AVATAR_PRESETS` gradient stops. */
private data class ProfileAvatarPresetVisual(
    val start: Color,
    val end: Color,
    @param:DrawableRes val artwork: Int,
)

private val profileAvatarPresetVisuals = mapOf(
    "astronaut" to ProfileAvatarPresetVisual(Color(0xFF5267AD), Color(0xFF222D5F), R.drawable.avatar_preset_astronaut),
    "cat" to ProfileAvatarPresetVisual(Color(0xFFE37C68), Color(0xFF9C3F66), R.drawable.avatar_preset_cat),
    "dinosaur" to ProfileAvatarPresetVisual(Color(0xFF55A46E), Color(0xFF237265), R.drawable.avatar_preset_dinosaur),
    "robot" to ProfileAvatarPresetVisual(Color(0xFF5D9CAF), Color(0xFF365383), R.drawable.avatar_preset_robot),
    "pirate" to ProfileAvatarPresetVisual(Color(0xFFD39A48), Color(0xFF91464C), R.drawable.avatar_preset_pirate),
    "alien" to ProfileAvatarPresetVisual(Color(0xFF8B71C5), Color(0xFF4A477F), R.drawable.avatar_preset_alien),
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
        ProfileAvatarKind.Custom -> preference.value.startsWith("data:image/jpeg;base64,") ||
            preference.value.startsWith("data:image/png;base64,") ||
            preference.value.startsWith("data:image/webp;base64,")
        null -> false
    }
    return preference?.takeIf { usable } ?: ProfileAvatarPreference(
        kind = ProfileAvatarKind.Preset,
        value = defaultPlayarrProfileAvatarPreset(userId),
    )
}

/**
 * Web `ProfileAvatar` — circular gradient plate with SVG preset artwork (or
 * custom crop). Glyph-size parameter retained for call-site compatibility.
 */
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
            .background(
                Brush.linearGradient(
                    colors = listOf(preset.start, preset.end),
                    // Web: 145deg gradient + highlight at 34% 26%.
                ),
            )
            .clearAndSetSemantics { },
        contentAlignment = Alignment.Center,
    ) {
        // Soft highlight matching `.profile-avatar` radial wash.
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.radialGradient(
                        colors = listOf(Color.White.copy(alpha = 0.22f), Color.Transparent),
                    ),
                ),
        )
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
            } else {
                PresetArtwork(preset.artwork)
            }
        } else {
            PresetArtwork(preset.artwork)
        }
    }
}

@Composable
private fun PresetArtwork(@DrawableRes artwork: Int) {
    // Web `.profile-avatar > svg` is 86% of the plate.
    Image(
        painter = painterResource(artwork),
        contentDescription = null,
        modifier = Modifier.fillMaxSize(0.86f),
        contentScale = ContentScale.Fit,
    )
}

/** Brand rose used by web profiles kicker / selection rings (`#cf3157`). */
internal val ProfilesBrandRose = Color(0xFFCF3157)
