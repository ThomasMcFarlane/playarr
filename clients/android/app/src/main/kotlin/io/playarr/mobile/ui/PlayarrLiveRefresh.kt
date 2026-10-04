package io.playarr.mobile.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import io.playarr.shared.data.events.LiveInvalidationBus
import io.playarr.shared.data.events.LiveTarget

/**
 * Runs [onRefresh] (a silent, in-place refetch: no spinner, stale content kept
 * until the new arrives) whenever a live event or fallback poll affects
 * [interest] while the screen is started. On becoming visible again it also
 * catches up on a change that happened while hidden. [fetchStartedMs] is the
 * start time of the holder's latest fetch (`0` until the first one), used to
 * drop events that fetch already covers.
 */
@Composable
internal fun LiveRefreshEffect(
    bus: LiveInvalidationBus,
    interest: Set<LiveTarget>,
    fetchStartedMs: () -> Long,
    onRefresh: () -> Unit,
) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val refresh by rememberUpdatedState(onRefresh)
    val stamp by rememberUpdatedState(fetchStartedMs)
    LaunchedEffect(bus, interest, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            val started = stamp()
            if (started > 0L && bus.isStale(interest, started)) refresh()
            bus.refetchTriggers(interest) { stamp() }.collect { refresh() }
        }
    }
}
