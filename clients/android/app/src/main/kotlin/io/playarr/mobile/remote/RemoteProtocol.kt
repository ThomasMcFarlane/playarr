package io.playarr.mobile.remote

import io.playarr.shared.data.model.RemoteCapability
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/**
 * Pure protocol helpers for the phone remote (`docs/architecture/remote-control.md`):
 * command decoding, text editing and playback command execution. No Android
 * types, so they are plain JVM unit tests.
 */
enum class RemoteKey { Up, Down, Left, Right, Select, Back, Home }

sealed interface RemoteOutcome {
    data object Ok : RemoteOutcome
    data class Failed(val detail: String) : RemoteOutcome
    data class Unsupported(val detail: String) : RemoteOutcome

    val wire: String
        get() = when (this) {
            Ok -> "ok"
            is Failed -> "failed"
            is Unsupported -> "unsupported"
        }
    val detailOrNull: String?
        get() = when (this) {
            Ok -> null
            is Failed -> detail
            is Unsupported -> detail
        }
}

/** Capabilities this Android client can execute as a target. */
val ANDROID_TARGET_CAPABILITIES: List<String> = listOf(
    RemoteCapability.Navigate,
    RemoteCapability.Text,
    RemoteCapability.Playback,
    RemoteCapability.Handoff,
)

/** Advertised while merely playing, so the title can be handed off. */
val HANDOFF_ONLY_CAPABILITIES: List<String> = listOf(RemoteCapability.Handoff)

fun remoteKeyFor(name: String): RemoteKey? = when (name) {
    "up" -> RemoteKey.Up
    "down" -> RemoteKey.Down
    "left" -> RemoteKey.Left
    "right" -> RemoteKey.Right
    "select" -> RemoteKey.Select
    "back" -> RemoteKey.Back
    "home" -> RemoteKey.Home
    else -> null
}

data class TextCommand(val value: String, val mode: String, val submit: Boolean)

fun parseTextCommand(args: JsonObject): TextCommand {
    val mode = args.string("mode").let { if (it == "replace" || it == "backspace") it else "insert" }
    return TextCommand(
        value = args.string("value").orEmpty(),
        mode = mode,
        submit = (args["submit"] as? JsonPrimitive)?.booleanOrNull == true,
    )
}

data class TextEdit(val value: String, val caret: Int)

/** Applies [command] to [current] with the given selection; clamps out-of-range selections. */
fun applyTextCommand(current: String, selectionStart: Int, selectionEnd: Int, command: TextCommand): TextEdit {
    val start = selectionStart.coerceIn(0, current.length)
    val end = selectionEnd.coerceIn(start, current.length)
    return when (command.mode) {
        "replace" -> TextEdit(command.value, command.value.length)
        "backspace" -> when {
            end > start -> TextEdit(current.removeRange(start, end), start)
            start == 0 -> TextEdit(current, 0)
            else -> TextEdit(current.removeRange(start - 1, end), start - 1)
        }
        else -> TextEdit(current.substring(0, start) + command.value + current.substring(end), start + command.value.length)
    }
}

/** Playback surface a command drives; implemented over the app's player. */
interface RemotePlayerControls {
    val mediaFileId: String
    fun positionMs(): Long
    fun durationMs(): Long
    fun isPaused(): Boolean
    /** True once media is loaded and controllable. */
    fun isReady(): Boolean
    fun play()
    fun pause()
    fun seekToMs(positionMs: Long)
    fun setVolume(level: Float): Boolean
    fun stop()
    fun next(): Boolean
    fun previous(): Boolean
    fun setAudioLanguage(language: String): Boolean
    fun setSubtitleLanguage(language: String?): Boolean
}

fun executePlaybackCommand(player: RemotePlayerControls?, args: JsonObject): RemoteOutcome {
    if (player == null) return RemoteOutcome.Failed("nothing is playing")
    return when (args.string("action")) {
        "play" -> { player.play(); RemoteOutcome.Ok }
        "pause" -> { player.pause(); RemoteOutcome.Ok }
        "toggle" -> { if (player.isPaused()) player.play() else player.pause(); RemoteOutcome.Ok }
        "stop" -> { player.stop(); RemoteOutcome.Ok }
        "seek" -> {
            val position = args.long("position_ms") ?: return RemoteOutcome.Failed("missing position")
            player.seekToMs(position.coerceAtLeast(0L))
            RemoteOutcome.Ok
        }
        "seek_by" -> {
            val delta = args.long("delta_ms") ?: return RemoteOutcome.Failed("missing delta")
            val duration = player.durationMs()
            val target = (player.positionMs() + delta).coerceAtLeast(0L)
            player.seekToMs(if (duration > 0L) target.coerceAtMost(duration) else target)
            RemoteOutcome.Ok
        }
        "volume" -> {
            val level = args.double("level") ?: return RemoteOutcome.Failed("missing level")
            if (player.setVolume((level / 100.0).coerceIn(0.0, 1.0).toFloat())) RemoteOutcome.Ok
            else RemoteOutcome.Unsupported("volume is controlled by the device")
        }
        "next" -> if (player.next()) RemoteOutcome.Ok else RemoteOutcome.Unsupported("no next item")
        "previous" -> if (player.previous()) RemoteOutcome.Ok else RemoteOutcome.Unsupported("no previous item")
        "set_audio" ->
            if (player.setAudioLanguage(args.string("language").orEmpty())) RemoteOutcome.Ok
            else RemoteOutcome.Failed("no matching audio track")
        "set_subtitle" -> {
            val language = args.string("language") ?: "off"
            if (player.setSubtitleLanguage(language.takeUnless { it == "off" })) RemoteOutcome.Ok
            else RemoteOutcome.Failed("no matching subtitle track")
        }
        else -> RemoteOutcome.Unsupported("unknown playback action")
    }
}

internal fun JsonObject.string(name: String): String? = (this[name] as? JsonPrimitive)?.contentOrNull
internal fun JsonObject.long(name: String): Long? = (this[name] as? JsonPrimitive)?.longOrNull
internal fun JsonObject.double(name: String): Double? = (this[name] as? JsonPrimitive)?.doubleOrNull
internal fun JsonElement?.asObject(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
