package io.playarr.mobile.ui

import java.util.Locale

/**
 * Audio/subtitle language filter for a library (task 183). Codes are the
 * canonical ISO 639 codes the server indexes; several values within one list
 * match any of them, and audio combines with subtitle using AND.
 */
data class LanguageSelection(
    val audio: Set<String> = emptySet(),
    val subtitle: Set<String> = emptySet(),
) {
    val isEmpty: Boolean get() = audio.isEmpty() && subtitle.isEmpty()
    val audioParam: String? get() = audio.toQueryParam()
    val subtitleParam: String? get() = subtitle.toQueryParam()

    fun toggleAudio(code: String) = copy(audio = audio.toggled(code))
    fun toggleSubtitle(code: String) = copy(subtitle = subtitle.toggled(code))
}

private fun Set<String>.toQueryParam(): String? = takeIf { it.isNotEmpty() }?.sorted()?.joinToString(",")

private fun Set<String>.toggled(code: String): Set<String> = if (code in this) this - code else this + code

/**
 * The language's name in the UI locale (`ja` reads "Japanese" in English and
 * "日本語" in Japanese). Falls back to the server's English name and finally
 * the upper-cased code.
 */
fun languageDisplayName(code: String, uiLocale: Locale, fallbackName: String? = null): String {
    val name = Locale.forLanguageTag(code).getDisplayLanguage(uiLocale)
    return if (name.isNotBlank() && !name.equals(code, ignoreCase = true)) {
        name.replaceFirstChar { it.titlecase(uiLocale) }
    } else {
        fallbackName?.takeIf { it.isNotBlank() } ?: code.uppercase(Locale.ROOT)
    }
}
