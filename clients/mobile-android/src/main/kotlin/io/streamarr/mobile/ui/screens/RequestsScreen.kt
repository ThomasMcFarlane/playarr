package io.streamarr.mobile.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
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
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.mobile.R
import io.streamarr.shared.auth.TokenStore
import io.streamarr.shared.data.model.MediaRequest
import io.streamarr.shared.data.model.RequestStatus
import io.streamarr.shared.data.model.RequestTarget
import io.streamarr.shared.designsystem.component.SectionHeader
import io.streamarr.shared.domain.model.StreamarrError
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.usecase.ApproveMediaRequestUseCase
import io.streamarr.shared.domain.usecase.ListMediaRequestsUseCase
import io.streamarr.shared.domain.usecase.RejectMediaRequestUseCase
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

sealed interface RequestsUiState {
    data object Loading : RequestsUiState
    data class Content(val myRequests: List<MediaRequest>, val pendingApproval: List<MediaRequest>) : RequestsUiState
    data class Failure(val message: String) : RequestsUiState
}

/**
 * Backs both the "My Requests" list (`GET /api/v1/requests?user_id=<me>`)
 * and the "Pending Approval" list with Approve/Reject actions
 * (`GET /api/v1/requests` unfiltered -- per the real spec this already *is*
 * "every request still Pending an admin decision"). See
 * [io.streamarr.shared.domain.repository.RequestRepository]'s KDoc for why
 * the approve/reject actions aren't gated behind a client-side admin check:
 * there is no real signal (JWT claim or endpoint) this client can read to
 * know whether the signed-in user actually is one.
 */
@HiltViewModel
class RequestsViewModel @Inject constructor(
    private val listMediaRequestsUseCase: ListMediaRequestsUseCase,
    private val approveMediaRequestUseCase: ApproveMediaRequestUseCase,
    private val rejectMediaRequestUseCase: RejectMediaRequestUseCase,
    private val tokenStore: TokenStore,
) : ViewModel() {

    private val _uiState = MutableStateFlow<RequestsUiState>(RequestsUiState.Loading)
    val uiState: StateFlow<RequestsUiState> = _uiState.asStateFlow()

    private val _actionError = MutableStateFlow<String?>(null)
    val actionError: StateFlow<String?> = _actionError.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = RequestsUiState.Loading
            val userId = tokenStore.userId.first()
            val mine = listMediaRequestsUseCase(userId = userId)
            val pending = listMediaRequestsUseCase(userId = null)
            _uiState.value = when {
                mine is StreamarrResult.Failure -> RequestsUiState.Failure(mine.error.toRequestsErrorMessage())
                pending is StreamarrResult.Failure -> RequestsUiState.Failure(pending.error.toRequestsErrorMessage())
                else -> RequestsUiState.Content(
                    myRequests = (mine as StreamarrResult.Success).value,
                    pendingApproval = (pending as StreamarrResult.Success).value,
                )
            }
        }
    }

    fun approve(requestId: String) = decide(requestId, approveMediaRequestUseCase::invoke)

    fun reject(requestId: String) = decide(requestId, rejectMediaRequestUseCase::invoke)

    /**
     * No longer needs a locally-read user id: the deciding admin is
     * derived server-side from the verified access token
     * `StreamarrHttpClient` attaches -- see [ApproveMediaRequestUseCase]/
     * [RejectMediaRequestUseCase]'s KDoc. A 403 here (the caller isn't
     * really an admin) surfaces through [toRequestsErrorMessage] like any other
     * [StreamarrError.Http].
     */
    private fun decide(requestId: String, action: suspend (String, String?) -> StreamarrResult<MediaRequest>) {
        viewModelScope.launch {
            _actionError.value = null
            when (val result = action(requestId, null)) {
                is StreamarrResult.Success -> refresh()
                is StreamarrResult.Failure -> _actionError.value = result.error.toRequestsErrorMessage()
            }
        }
    }
}

/** `internal` (rather than `private`) so this module's unit tests can exercise the 401/403 mapping directly. */
internal fun StreamarrError.toRequestsErrorMessage(): String = when (this) {
    is StreamarrError.Network -> "Can't reach the Streamarr server. Check the server address in Settings."
    is StreamarrError.Http -> when (code) {
        401 -> "Sign in again to continue."
        403 -> "You don't have permission to approve or reject requests."
        409 -> "This request was already decided."
        else -> "Server error ($code)."
    }
    is StreamarrError.Unknown -> "Something went wrong loading requests."
}

private fun requestTargetLabel(request: MediaRequest): String = when (val target = request.target) {
    is RequestTarget.ExistingWork -> "${request.kind} – ${target.workId}"
    is RequestTarget.External -> "${request.kind} – ${target.externalRef.provider} ${target.externalRef.externalId}"
}

@Composable
fun RequestsScreen(
    modifier: Modifier = Modifier,
    viewModel: RequestsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val actionError by viewModel.actionError.collectAsState()

    Box(modifier = modifier.fillMaxSize()) {
        when (val current = uiState) {
            is RequestsUiState.Loading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            is RequestsUiState.Failure -> Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Text(text = current.message, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.error)
            }
            is RequestsUiState.Content -> RequestsContent(
                content = current,
                actionError = actionError,
                onApprove = viewModel::approve,
                onReject = viewModel::reject,
            )
        }
    }
}

@Composable
private fun RequestsContent(
    content: RequestsUiState.Content,
    actionError: String?,
    onApprove: (String) -> Unit,
    onReject: (String) -> Unit,
) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        actionError?.let { message ->
            item {
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(16.dp),
                )
            }
        }

        item { SectionHeader(title = stringResource(R.string.requests_pending_approval)) }
        if (content.pendingApproval.isEmpty()) {
            item {
                Text(
                    text = stringResource(R.string.requests_empty_pending),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(16.dp),
                )
            }
        } else {
            items(content.pendingApproval, key = { "pending-${it.id}" }) { request ->
                PendingRequestRow(
                    request = request,
                    onApprove = { onApprove(request.id) },
                    onReject = { onReject(request.id) },
                )
            }
        }

        item { SectionHeader(title = stringResource(R.string.requests_my_requests)) }
        if (content.myRequests.isEmpty()) {
            item {
                Text(
                    text = stringResource(R.string.requests_empty_mine),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(16.dp),
                )
            }
        } else {
            items(content.myRequests, key = { "mine-${it.id}" }) { request ->
                ListItem(
                    headlineContent = { Text(requestTargetLabel(request)) },
                    supportingContent = { Text(stringResource(R.string.requests_status, request.status.wireLabel())) },
                )
            }
        }
    }
}

@Composable
private fun PendingRequestRow(request: MediaRequest, onApprove: () -> Unit, onReject: () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        ListItem(
            headlineContent = { Text(requestTargetLabel(request)) },
            supportingContent = { Text(stringResource(R.string.requests_status, request.status.wireLabel())) },
        )
        if (request.status == RequestStatus.Pending) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                Button(onClick = onApprove) { Text(stringResource(R.string.requests_approve)) }
                OutlinedButton(onClick = onReject) { Text(stringResource(R.string.requests_reject)) }
            }
        }
    }
}

private fun RequestStatus.wireLabel(): String = when (this) {
    RequestStatus.Pending -> "Pending"
    RequestStatus.Approved -> "Approved"
    RequestStatus.Rejected -> "Rejected"
    RequestStatus.Submitted -> "Submitted"
    RequestStatus.Available -> "Available"
    RequestStatus.Failed -> "Failed"
}
