package io.streamarr.tv.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.tv.material3.Button
import androidx.tv.material3.ListItem
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.shared.auth.TokenStore
import io.streamarr.shared.data.model.MediaRequest
import io.streamarr.shared.data.model.RequestStatus
import io.streamarr.shared.data.model.RequestTarget
import io.streamarr.shared.domain.model.StreamarrError
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.usecase.ApproveMediaRequestUseCase
import io.streamarr.shared.domain.usecase.ListMediaRequestsUseCase
import io.streamarr.shared.domain.usecase.RejectMediaRequestUseCase
import io.streamarr.tv.R
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

sealed interface TvRequestsUiState {
    data object Loading : TvRequestsUiState
    data class Content(val myRequests: List<MediaRequest>, val pendingApproval: List<MediaRequest>) : TvRequestsUiState
    data class Failure(val message: String) : TvRequestsUiState
}

/** Mirrors `mobile-android`'s `RequestsViewModel` -- see that file's KDoc for the admin-gating caveat. */
@HiltViewModel
class TvRequestsViewModel @Inject constructor(
    private val listMediaRequestsUseCase: ListMediaRequestsUseCase,
    private val approveMediaRequestUseCase: ApproveMediaRequestUseCase,
    private val rejectMediaRequestUseCase: RejectMediaRequestUseCase,
    private val tokenStore: TokenStore,
) : ViewModel() {

    private val _uiState = MutableStateFlow<TvRequestsUiState>(TvRequestsUiState.Loading)
    val uiState: StateFlow<TvRequestsUiState> = _uiState.asStateFlow()

    private val _actionError = MutableStateFlow<String?>(null)
    val actionError: StateFlow<String?> = _actionError.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = TvRequestsUiState.Loading
            val userId = tokenStore.userId.first()
            val mine = listMediaRequestsUseCase(userId = userId)
            val pending = listMediaRequestsUseCase(userId = null)
            _uiState.value = when {
                mine is StreamarrResult.Failure -> TvRequestsUiState.Failure(mine.error.toUserMessage())
                pending is StreamarrResult.Failure -> TvRequestsUiState.Failure(pending.error.toUserMessage())
                else -> TvRequestsUiState.Content(
                    myRequests = (mine as StreamarrResult.Success).value,
                    pendingApproval = (pending as StreamarrResult.Success).value,
                )
            }
        }
    }

    fun approve(requestId: String) = decide(requestId, approveMediaRequestUseCase::invoke)

    fun reject(requestId: String) = decide(requestId, rejectMediaRequestUseCase::invoke)

    private fun decide(requestId: String, action: suspend (String, String, String?) -> StreamarrResult<MediaRequest>) {
        viewModelScope.launch {
            _actionError.value = null
            val decidedBy = tokenStore.userId.first()
            if (decidedBy == null) {
                _actionError.value = "Sign in again to decide on requests."
                return@launch
            }
            when (val result = action(requestId, decidedBy, null)) {
                is StreamarrResult.Success -> refresh()
                is StreamarrResult.Failure -> _actionError.value = result.error.toUserMessage()
            }
        }
    }
}

private fun StreamarrError.toUserMessage(): String = when (this) {
    is StreamarrError.Network -> "Can't reach the Streamarr server. Check the server address in Settings."
    is StreamarrError.Http -> if (code == 409) "This request was already decided." else "Server error ($code)."
    is StreamarrError.Unknown -> "Something went wrong loading requests."
}

private fun requestTargetLabel(request: MediaRequest): String = when (val target = request.target) {
    is RequestTarget.ExistingWork -> "${request.kind} – ${target.workId}"
    is RequestTarget.External -> "${request.kind} – ${target.externalRef.provider} ${target.externalRef.externalId}"
}

private fun RequestStatus.wireLabel(): String = when (this) {
    RequestStatus.Pending -> "Pending"
    RequestStatus.Approved -> "Approved"
    RequestStatus.Rejected -> "Rejected"
    RequestStatus.Submitted -> "Submitted"
    RequestStatus.Available -> "Available"
    RequestStatus.Failed -> "Failed"
}

@Composable
fun RequestsScreen(
    modifier: Modifier = Modifier,
    viewModel: TvRequestsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val actionError by viewModel.actionError.collectAsState()

    Box(modifier = modifier.fillMaxSize()) {
        when (val current = uiState) {
            is TvRequestsUiState.Loading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            is TvRequestsUiState.Failure -> Box(modifier = Modifier.fillMaxSize().padding(48.dp), contentAlignment = Alignment.Center) {
                Text(text = current.message, style = MaterialTheme.typography.bodyLarge)
            }
            is TvRequestsUiState.Content -> TvRequestsContent(
                content = current,
                actionError = actionError,
                onApprove = viewModel::approve,
                onReject = viewModel::reject,
            )
        }
    }
}

@Composable
private fun TvRequestsContent(
    content: TvRequestsUiState.Content,
    actionError: String?,
    onApprove: (String) -> Unit,
    onReject: (String) -> Unit,
) {
    LazyColumn(modifier = Modifier.fillMaxSize().padding(top = 32.dp)) {
        actionError?.let { message ->
            item {
                Text(text = message, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 48.dp, vertical = 8.dp))
            }
        }

        item {
            Text(
                text = stringResource(R.string.requests_pending_approval),
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.padding(horizontal = 48.dp, vertical = 16.dp),
            )
        }
        if (content.pendingApproval.isEmpty()) {
            item {
                Text(
                    text = stringResource(R.string.requests_empty_pending),
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(horizontal = 48.dp),
                )
            }
        } else {
            items(content.pendingApproval, key = { "pending-${it.id}" }) { request ->
                TvPendingRequestRow(request = request, onApprove = { onApprove(request.id) }, onReject = { onReject(request.id) })
            }
        }

        item {
            Text(
                text = stringResource(R.string.requests_my_requests),
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.padding(horizontal = 48.dp, vertical = 16.dp),
            )
        }
        if (content.myRequests.isEmpty()) {
            item {
                Text(
                    text = stringResource(R.string.requests_empty_mine),
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(horizontal = 48.dp),
                )
            }
        } else {
            items(content.myRequests, key = { "mine-${it.id}" }) { request ->
                ListItem(
                    selected = false,
                    onClick = {},
                    headlineContent = { Text(requestTargetLabel(request)) },
                    supportingContent = { Text(stringResource(R.string.requests_status, request.status.wireLabel())) },
                    modifier = Modifier.padding(horizontal = 48.dp),
                )
            }
        }
    }
}

@Composable
private fun TvPendingRequestRow(request: MediaRequest, onApprove: () -> Unit, onReject: () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 48.dp, vertical = 4.dp)) {
        Text(text = requestTargetLabel(request), style = MaterialTheme.typography.bodyLarge)
        Text(text = stringResource(R.string.requests_status, request.status.wireLabel()), style = MaterialTheme.typography.bodySmall)
        if (request.status == RequestStatus.Pending) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 4.dp)) {
                Button(onClick = onApprove) { Text(stringResource(R.string.requests_approve)) }
                Button(onClick = onReject) { Text(stringResource(R.string.requests_reject)) }
            }
        }
    }
}
