package io.playarr.mobile.remote

import android.app.Activity
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection

/**
 * Applies a phone-remote text command to whichever text field currently has
 * input focus, through the same `InputConnection` the soft keyboard uses, so it
 * works for Compose and View text fields alike without touching the keyboard.
 * Keystrokes are never logged.
 */
internal object RemoteTextInjector {
    fun inject(activity: Activity, command: TextCommand): RemoteOutcome {
        val view = activity.currentFocus ?: activity.window?.decorView?.findFocus()
            ?: return RemoteOutcome.Failed("no text field is focused")
        val info = EditorInfo()
        val connection: InputConnection = view.onCreateInputConnection(info)
            ?: return RemoteOutcome.Failed("no text field is focused")
        return try {
            connection.beginBatchEdit()
            when (command.mode) {
                "replace" -> {
                    val before = connection.getTextBeforeCursor(MAX_FIELD, 0)?.length ?: 0
                    val after = connection.getTextAfterCursor(MAX_FIELD, 0)?.length ?: 0
                    connection.deleteSurroundingText(before, after)
                    connection.commitText(command.value, 1)
                }
                "backspace" -> connection.deleteSurroundingText(1, 0)
                else -> connection.commitText(command.value, 1)
            }
            connection.endBatchEdit()
            if (command.submit) {
                val action = info.imeOptions and EditorInfo.IME_MASK_ACTION
                connection.performEditorAction(if (action == EditorInfo.IME_ACTION_UNSPECIFIED) EditorInfo.IME_ACTION_DONE else action)
            }
            RemoteOutcome.Ok
        } catch (_: Exception) {
            RemoteOutcome.Failed("could not enter text")
        }
    }

    private const val MAX_FIELD = 4096
}
