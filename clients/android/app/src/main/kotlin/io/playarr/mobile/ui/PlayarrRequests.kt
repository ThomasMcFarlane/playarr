package io.playarr.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.playarr.shared.data.model.RequestView
import io.playarr.shared.data.model.RequestWire
import io.playarr.shared.data.remote.PlayarrApi
import javax.inject.Inject
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Status chip label for a request; unknown future statuses return null and show verbatim. */
internal fun String.requestStatusLabel(): PlayarrString? = when (this) {
    RequestWire.STATUS_PENDING -> PlayarrString.RequestsStatusPending
    RequestWire.STATUS_APPROVED -> PlayarrString.RequestsStatusApproved
    RequestWire.STATUS_DECLINED -> PlayarrString.RequestsStatusDeclined
    RequestWire.STATUS_AVAILABLE -> PlayarrString.RequestsStatusAvailable
    RequestWire.STATUS_FAILED -> PlayarrString.RequestsStatusFailed
    else -> null
}

/** "Requested by you" for the viewer's own request, "Requested by <name>" when the server named someone, else null. */
internal fun RequestView.requesterLabel(): Pair<PlayarrString, Map<String, String>>? = when {
    mine -> PlayarrString.RequestsByYou to emptyMap()
    !requestedBy.isNullOrBlank() -> PlayarrString.RequestsBy to mapOf("name" to requestedBy!!)
    else -> null
}

@HiltViewModel
internal class RequestsViewModel @Inject constructor(
    private val api: PlayarrApi,
) : ViewModel() {
    private val _requests = MutableStateFlow<ParityLoad<List<RequestView>>>(ParityLoad.Loading)
    val requests: StateFlow<ParityLoad<List<RequestView>>> = _requests.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _requests.value = ParityLoad.Loading
            _requests.value = try {
                ParityLoad.Ready(api.listRequests())
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                ParityLoad.Failed(
                    error.message?.takeIf(String::isNotBlank)?.let(PlayarrMessage::Dynamic)
                        ?: PlayarrMessage.Localized(PlayarrString.RequestsErrorTitle),
                )
            }
        }
    }
}

@Composable
internal fun ExperienceRequestsScreen(
    isTelevision: Boolean,
    onBack: () -> Unit,
    viewModel: RequestsViewModel = hiltViewModel(),
) {
    val state by viewModel.requests.collectAsState()
    LaunchedEffect(Unit) { viewModel.load() }
    PlayarrPageScaffold(
        title = playarrString(PlayarrString.RequestsTitle),
        onBack = onBack,
        isTelevision = isTelevision,
    ) {
        when (val current = state) {
            ParityLoad.Loading -> ParityLoading(playarrString(PlayarrString.RequestsLoading))
            is ParityLoad.Failed -> ParityFailure(current.message, viewModel::load)
            is ParityLoad.Ready -> if (current.value.isEmpty()) {
                ExperienceEmpty(
                    playarrString(PlayarrString.RequestsEmptyTitle),
                    playarrString(PlayarrString.RequestsEmptyDescription),
                )
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(top = 18.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    contentPadding = PaddingValues(bottom = 104.dp),
                ) {
                    items(current.value, key = { it.id }) { request ->
                        RequestRow(request, dpadFocus = isTelevision)
                    }
                }
            }
        }
    }
}

@Composable
private fun RequestRow(request: RequestView, dpadFocus: Boolean) {
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(14.dp)
    // Rows carry no actions, so on television the row itself takes D-pad focus to let the list scroll.
    val focusModifier = if (dpadFocus) {
        Modifier.onFocusChanged { focused = it.isFocused }.focusable()
            .border(if (focused) 2.dp else 0.dp, if (focused) WebPink else WebSurface, shape)
    } else Modifier
    Surface(
        color = WebSurfaceStrong.copy(alpha = 0.6f),
        shape = shape,
        modifier = Modifier.fillMaxWidth().then(focusModifier),
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(request.title, color = WebInk, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            request.year?.let { Text(it.toString(), color = WebInkMuted, fontSize = 11.sp) }
            Text(
                request.status.requestStatusLabel()?.let { playarrString(it) } ?: request.status,
                color = WebInk,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier
                    .background(WebPink.copy(alpha = 0.22f), RoundedCornerShape(50))
                    .padding(horizontal = 10.dp, vertical = 3.dp),
            )
            request.requesterLabel()?.let { (key, params) ->
                Text(playarrString(key, *params.toList().toTypedArray()), color = WebInkMuted, fontSize = 11.sp)
            }
            request.statusNote?.takeIf(String::isNotBlank)?.let {
                Text(it, color = WebInkMuted, fontSize = 11.sp)
            }
        }
    }
}
