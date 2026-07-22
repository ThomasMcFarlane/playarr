package io.streamarr.shared.download

/**
 * The Keep-until picker's selectable modes (see the quality/Keep-until
 * `ModalBottomSheet` in the app module). Resolved to the
 * Persisted unresolved by [DownloadRepository] so an after-watched policy
 * starts from the actual watched event, including one recorded offline.
 */
sealed interface KeepUntilSelection {
    data object Forever : KeepUntilSelection
    data class SpecificDate(val epochMillis: Long) : KeepUntilSelection

    /** N days/weeks after the item is marked Watched. */
    data class AfterWatched(val amount: Int, val unit: KeepUntilUnit) : KeepUntilSelection
}

enum class KeepUntilUnit { Days, Weeks }
