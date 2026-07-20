package io.streamarr.shared.download

/**
 * The Keep-until picker's selectable modes (see the quality/Keep-until
 * `ModalBottomSheet` in the app module). Resolved to the
 * `keepUntilEpochMillis: Long?` shape [DownloadRepository.enqueue]/
 * [DownloadRepository.setKeepUntil] persist (`null` == forever) via
 * [resolveEpochMillis] at selection time.
 */
sealed interface KeepUntilSelection {
    data object Forever : KeepUntilSelection
    data class SpecificDate(val epochMillis: Long) : KeepUntilSelection

    /**
     * N days/weeks after the item is marked Watched.
     *
     * Simplification (the Room schema this repository persists into only
     * has room for one resolved `keepUntilEpochMillis: Long?` per item, not
     * a live "watched-relative" policy -- see `DownloadMetadataEntity`'s
     * KDoc): this resolves relative to *now* (selection/download time), not
     * to a future watched event this client has no feed for reacting to
     * later. In practice this behaves as "N days after downloaded" rather
     * than truly "N days after watched" for an item not yet watched at
     * selection time. A real "watched-relative" expiry would need the
     * schema to instead store this policy unresolved and recompute
     * [DownloadRepository.setKeepUntil] from a watched-state event hook.
     */
    data class AfterWatched(val amount: Int, val unit: KeepUntilUnit) : KeepUntilSelection
}

enum class KeepUntilUnit { Days, Weeks }

/** Resolves [this] to an epoch-millis Keep-until (`null` = forever), anchoring a relative selection at [nowEpochMillis]. */
fun KeepUntilSelection.resolveEpochMillis(nowEpochMillis: Long = System.currentTimeMillis()): Long? = when (this) {
    KeepUntilSelection.Forever -> null
    is KeepUntilSelection.SpecificDate -> epochMillis
    is KeepUntilSelection.AfterWatched -> {
        val days = when (unit) {
            KeepUntilUnit.Days -> amount.toLong()
            KeepUntilUnit.Weeks -> amount.toLong() * 7L
        }
        nowEpochMillis + days * MILLIS_PER_DAY
    }
}

private const val MILLIS_PER_DAY = 24L * 60L * 60L * 1000L
