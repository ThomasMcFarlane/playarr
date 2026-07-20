package io.streamarr.shared.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement

@Serializable
enum class WatchState {
    @SerialName("unseen") Unseen,
    @SerialName("part_watched") PartWatched,
    @SerialName("watched") Watched,
}

@Serializable
data class WatchProgress(
    @SerialName("media_file_id") val mediaFileId: String,
    @SerialName("work_id") val workId: String,
    @SerialName("position_ms") val positionMs: Long,
    @SerialName("duration_ms") val durationMs: Long,
    val state: WatchState,
    @SerialName("updated_at") val updatedAt: String? = null,
) {
    val fraction: Float
        get() = if (durationMs <= 0) 0f else (positionMs.toDouble() / durationMs).coerceIn(0.0, 1.0).toFloat()
}

@Serializable
data class UpdateWatchProgressRequest(
    @SerialName("position_ms") val positionMs: Long,
    @SerialName("duration_ms") val durationMs: Long,
    val completed: Boolean = false,
    /**
     * When this update actually happened, ISO-8601/RFC3339 (e.g.
     * `"2026-07-20T14:22:05Z"`). Additive/optional server-side; omit for a
     * live update (the server stamps `Utc::now()`) and set it when
     * replaying a progress update that was buffered while this device was
     * offline (see `core-download`'s `OfflineProgressRepository`), so the
     * server records when the watch actually happened rather than when the
     * replay call landed.
     */
    @SerialName("occurred_at") val occurredAt: String? = null,
)

@Serializable
enum class PlaylistMediaType {
    @SerialName("video") Video,
    @SerialName("audio") Audio,
}

@Serializable
data class Playlist(
    val id: String,
    val name: String,
    @SerialName("is_system") val isSystem: Boolean,
    @SerialName("media_type") val mediaType: PlaylistMediaType,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
    @SerialName("owner_user_id") val ownerUserId: String? = null,
    @SerialName("parent_playlist_id") val parentPlaylistId: String? = null,
)

@Serializable
data class PlaylistItem(
    val id: String,
    @SerialName("playlist_id") val playlistId: String,
    @SerialName("work_id") val workId: String,
    val position: Int,
    @SerialName("added_at") val addedAt: String,
    @SerialName("track_id") val trackId: String? = null,
)

@Serializable
data class CreatePlaylistRequest(
    val name: String,
    @SerialName("media_type") val mediaType: PlaylistMediaType,
    @SerialName("parent_playlist_id") val parentPlaylistId: String? = null,
    @SerialName("is_system") val isSystem: Boolean = false,
)

@Serializable
data class UpdatePlaylistRequest(
    val name: String,
    @SerialName("parent_playlist_id") val parentPlaylistId: String? = null,
)

@Serializable
data class AddPlaylistItemRequest(
    @SerialName("work_id") val workId: String,
    @SerialName("track_id") val trackId: String? = null,
)

@Serializable
data class ReorderPlaylistItemsRequest(
    @SerialName("item_ids") val itemIds: List<String>,
)

@Serializable
data class AvailableProfile(
    val id: String,
    val username: String,
    @SerialName("display_name") val displayName: String,
    @SerialName("is_current") val isCurrent: Boolean,
    @SerialName("pin_locked") val pinLocked: Boolean,
)

@Serializable
data class ProfilePinSetting(@SerialName("pin_locked") val pinLocked: Boolean)

@Serializable
data class UpdateProfilePinRequest(val pin: String?)

@Serializable
data class VerifyProfilePinRequest(val pin: String)

@Serializable
data class VerifyProfilePinResponse(val verified: Boolean)

@Serializable
data class PlayerPreferences(@SerialName("preferred_audio_language") val preferredAudioLanguage: String)

@Serializable
data class UpdatePlayerPreferencesRequest(
    @SerialName("preferred_audio_language") val preferredAudioLanguage: String,
)

@Serializable
enum class ProfileAvatarKind {
    @SerialName("preset") Preset,
    @SerialName("custom") Custom,
}

@Serializable
data class ProfileAvatarPreference(val kind: ProfileAvatarKind, val value: String)

@Serializable
data class ProfileAvatarSetting(val preference: ProfileAvatarPreference? = null)

@Serializable
data class UpdateProfileAvatarRequest(val preference: ProfileAvatarPreference)

@Serializable
enum class InviteRequestStatus {
    @SerialName("pending") Pending,
    @SerialName("approved") Approved,
    @SerialName("denied") Denied,
    @SerialName("generated") Generated,
}

@Serializable
data class UserInviteRequest(
    val id: String,
    @SerialName("user_id") val userId: String,
    val username: String,
    @SerialName("display_name") val displayName: String,
    val status: InviteRequestStatus,
    @SerialName("requested_at") val requestedAt: String,
    @SerialName("can_stream") val canStream: Boolean,
    @SerialName("library_allow") val libraryAllow: List<String>,
    val message: String? = null,
    @SerialName("reviewed_at") val reviewedAt: String? = null,
    @SerialName("generated_at") val generatedAt: String? = null,
)

/**
 * Retrofit erases Kotlin return-type nullability when it selects a response
 * converter. Keep the endpoint's literal JSON `null` inside a non-null wrapper
 * so profiles that have never requested an invite still decode correctly.
 */
@Serializable(with = OptionalUserInviteRequestSerializer::class)
data class OptionalUserInviteRequest(val value: UserInviteRequest?)

object OptionalUserInviteRequestSerializer : KSerializer<OptionalUserInviteRequest> {
    override val descriptor: SerialDescriptor = UserInviteRequest.serializer().descriptor

    override fun deserialize(decoder: Decoder): OptionalUserInviteRequest {
        require(decoder is JsonDecoder)
        val element = decoder.decodeJsonElement()
        return OptionalUserInviteRequest(
            if (element is JsonNull) null else decoder.json.decodeFromJsonElement(UserInviteRequest.serializer(), element),
        )
    }

    override fun serialize(encoder: Encoder, value: OptionalUserInviteRequest) {
        require(encoder is JsonEncoder)
        encoder.encodeJsonElement(
            value.value?.let { encoder.json.encodeToJsonElement(UserInviteRequest.serializer(), it) } ?: JsonNull,
        )
    }
}

@Serializable
data class CreateUserInviteRequest(val message: String? = null)

@Serializable
data class UserInvite(
    @SerialName("invite_token") val inviteToken: String,
    @SerialName("expires_at") val expiresAt: String,
)
