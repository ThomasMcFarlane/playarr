package io.playarr.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.playarr.shared.data.model.DecideHouseholdApprovalRequest
import io.playarr.shared.data.model.HouseholdApproval
import io.playarr.shared.data.remote.PlayarrApi
import io.playarr.shared.data.remote.parseApiErrorBody
import io.playarr.shared.data.remote.pinLockSeconds
import io.playarr.shared.designsystem.component.PlayarrButton
import io.playarr.shared.designsystem.component.PlayarrButtonVariant
import java.time.Instant
import javax.inject.Inject
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import retrofit2.HttpException

/** The server's cap on bonus minutes (and grant length) for one approval. */
internal const val MaxGuardianBonusMinutes = 240
internal const val DefaultGuardianBonusMinutes = 30

/**
 * Pending requests this guardian may decide, newest first: requests from the
 * profiles in [guardianFor], not the guardian's own, still inside their
 * request window. The server re-checks every one of these on decision.
 */
internal fun pendingGuardianApprovals(
    approvals: List<HouseholdApproval>,
    selfId: String,
    guardianFor: Set<String>,
    now: Instant,
): List<HouseholdApproval> = approvals
    .filter { it.status == "pending" && it.profileUserId != selfId && it.profileUserId in guardianFor }
    .filter { approval ->
        val expiry = approval.requestExpiresAt?.let { runCatching { Instant.parse(it) }.getOrNull() }
        expiry == null || expiry.isAfter(now)
    }
    .sortedByDescending { runCatching { Instant.parse(it.requestedAt) }.getOrDefault(Instant.EPOCH) }

/** Whole bonus minutes from the text field, or `null` when outside 1..[MaxGuardianBonusMinutes]. */
internal fun parseBonusMinutes(text: String): Int? =
    text.trim().toIntOrNull()?.takeIf { it in 1..MaxGuardianBonusMinutes }

internal fun hasBonus(approval: HouseholdApproval): Boolean =
    approval.kind == "time" && approval.subject == "budget"

/** What the guardian chose on one card. */
internal data class GuardianDecision(val approve: Boolean, val pin: String?, val bonusMinutes: Int?)

/** The wire request: the PIN and bonus go only with an approval, the bonus only for budget requests. */
internal fun guardianDecisionRequest(
    approval: HouseholdApproval,
    approve: Boolean,
    pin: String?,
    bonusMinutes: Int?,
) = if (approve) {
    DecideHouseholdApprovalRequest(
        approve = true,
        pin = pin,
        bonusMinutes = bonusMinutes.takeIf { hasBonus(approval) },
    )
} else {
    DecideHouseholdApprovalRequest(approve = false)
}

/** Why a decision was refused. */
internal sealed interface GuardianDecisionError {
    data object WrongPin : GuardianDecisionError
    data object SelfApproval : GuardianDecisionError
    data object NotAllowed : GuardianDecisionError
    data object NoPin : GuardianDecisionError
    data object AlreadyDecided : GuardianDecisionError
    data class PinLocked(val retryAfterSeconds: Int) : GuardianDecisionError
    data object NotFound : GuardianDecisionError
    data object Failed : GuardianDecisionError
}

/** Stable server error codes for the refusals on the decision route (older servers send `forbidden` for all three). */
internal const val CODE_SELF_APPROVAL = "self_approval_forbidden"
internal const val CODE_GUARDIAN_PIN_NOT_SET = "guardian_pin_not_set"
internal const val CODE_NOT_GUARDIAN = "not_guardian"

/**
 * Maps the server's error code to a refusal. Returns null for codes it does not know (including the generic
 * `forbidden` that older servers use), so the caller falls back to the message text.
 */
internal fun guardianForbiddenByCode(code: String?): GuardianDecisionError? = when (code) {
    CODE_SELF_APPROVAL -> GuardianDecisionError.SelfApproval
    CODE_GUARDIAN_PIN_NOT_SET -> GuardianDecisionError.NoPin
    CODE_NOT_GUARDIAN -> GuardianDecisionError.NotAllowed
    else -> null
}

/** Message-text fallback for servers that predate the specific 403 codes. */
internal fun guardianForbiddenByMessage(message: String): GuardianDecisionError {
    val lower = message.lowercase()
    return when {
        "own request" in lower -> GuardianDecisionError.SelfApproval
        "set a profile pin" in lower -> GuardianDecisionError.NoPin
        else -> GuardianDecisionError.NotAllowed
    }
}

internal fun guardianDecisionError(failure: Throwable): GuardianDecisionError {
    if (failure !is HttpException) return GuardianDecisionError.Failed
    failure.pinLockSeconds()?.let { return GuardianDecisionError.PinLocked(it) }
    val body = runCatching {
        failure.response()?.errorBody()?.source()?.peek()?.readUtf8()
    }.getOrNull().let(::parseApiErrorBody)
    return when (failure.code()) {
        401 -> GuardianDecisionError.WrongPin
        403 -> guardianForbiddenByCode(body?.error) ?: guardianForbiddenByMessage(body?.message.orEmpty())
        404 -> GuardianDecisionError.NotFound
        409 -> GuardianDecisionError.AlreadyDecided
        else -> GuardianDecisionError.Failed
    }
}

/** The confirmation shown after a decision was recorded, from the status the server returned. */
internal fun guardianConfirmation(decided: HouseholdApproval): PlayarrString? = when (decided.status) {
    "approved" -> PlayarrString.GuardianApprovedConfirmation
    "denied" -> PlayarrString.GuardianDeniedConfirmation
    else -> null
}

internal fun guardianDecisionMessage(error: GuardianDecisionError): PlayarrMessage = when (error) {
    GuardianDecisionError.WrongPin -> PlayarrMessage.Localized(PlayarrString.GuardianWrongPin)
    GuardianDecisionError.SelfApproval -> PlayarrMessage.Localized(PlayarrString.GuardianSelfApproval)
    GuardianDecisionError.NotAllowed -> PlayarrMessage.Localized(PlayarrString.GuardianNotAllowed)
    GuardianDecisionError.NoPin -> PlayarrMessage.Localized(PlayarrString.GuardianNoPin)
    GuardianDecisionError.AlreadyDecided -> PlayarrMessage.Localized(PlayarrString.GuardianAlreadyDecided)
    is GuardianDecisionError.PinLocked -> PlayarrMessage.Localized(
        PlayarrString.ProfilesPinLocked,
        mapOf("minutes" to ((error.retryAfterSeconds + 59) / 60).coerceAtLeast(1)),
    )
    GuardianDecisionError.NotFound -> PlayarrMessage.Localized(PlayarrString.GuardianNotFound)
    GuardianDecisionError.Failed -> PlayarrMessage.Localized(PlayarrString.GuardianDecisionFailed)
}

internal fun guardianSubjectLabel(approval: HouseholdApproval): PlayarrString = when {
    approval.kind == "time" && approval.subject == "budget" -> PlayarrString.GuardianSubjectBudget
    approval.kind == "time" && approval.subject == "schedule" -> PlayarrString.GuardianSubjectSchedule
    approval.kind == "content" -> PlayarrString.GuardianSubjectContent
    else -> PlayarrString.GuardianSubjectOther
}

internal data class GuardianApprovalsSnapshot(
    val approvals: List<HouseholdApproval>,
    val names: Map<String, String>,
)

@HiltViewModel
internal class GuardianApprovalsViewModel @Inject constructor(
    private val api: PlayarrApi,
) : ViewModel() {
    private val _state = MutableStateFlow<ParityLoad<GuardianApprovalsSnapshot>>(ParityLoad.Loading)
    val state: StateFlow<ParityLoad<GuardianApprovalsSnapshot>> = _state.asStateFlow()
    private val _busyId = MutableStateFlow<String?>(null)
    val busyId: StateFlow<String?> = _busyId.asStateFlow()
    private val _errors = MutableStateFlow<Map<String, PlayarrMessage>>(emptyMap())
    val errors: StateFlow<Map<String, PlayarrMessage>> = _errors.asStateFlow()
    private val _confirmation = MutableStateFlow<PlayarrString?>(null)

    /** A one-shot confirmation (snackbar) for the last recorded decision; clear it with [confirmationShown]. */
    val confirmation: StateFlow<PlayarrString?> = _confirmation.asStateFlow()

    fun confirmationShown() {
        _confirmation.value = null
    }

    fun load() {
        viewModelScope.launch {
            _state.value = ParityLoad.Loading
            _errors.value = emptyMap()
            _state.value = try {
                val approvals = api.listHouseholdApprovals()
                val names = runCatching { api.listAvailableProfiles() }.getOrDefault(emptyList())
                    .associate { it.id to it.displayName.ifBlank { it.username } }
                ParityLoad.Ready(GuardianApprovalsSnapshot(approvals, names))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                ParityLoad.Failed(error.playarrMessage(PlayarrFailureSubject.Profiles))
            }
        }
    }

    /** Sends the decision; on success the decided request leaves the list, on failure the card shows why. */
    fun decide(approval: HouseholdApproval, decision: GuardianDecision) {
        if (_busyId.value != null) return
        viewModelScope.launch {
            _busyId.value = approval.id
            _errors.value = _errors.value - approval.id
            try {
                val decided = api.decideHouseholdApproval(
                    approval.id,
                    guardianDecisionRequest(approval, decision.approve, decision.pin, decision.bonusMinutes),
                )
                _confirmation.value = guardianConfirmation(decided)
                (_state.value as? ParityLoad.Ready)?.let { ready ->
                    _state.value = ParityLoad.Ready(
                        ready.value.copy(approvals = ready.value.approvals.map { if (it.id == decided.id) decided else it }),
                    )
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Throwable) {
                val error = guardianDecisionError(failure)
                _errors.value = _errors.value + (approval.id to guardianDecisionMessage(error))
            } finally {
                _busyId.value = null
            }
        }
    }
}

@Composable
internal fun ExperienceGuardianApprovalsScreen(
    isTelevision: Boolean,
    selfId: String,
    guardianFor: Set<String>,
    onBack: () -> Unit,
    viewModel: GuardianApprovalsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val busyId by viewModel.busyId.collectAsState()
    val errors by viewModel.errors.collectAsState()
    val confirmation by viewModel.confirmation.collectAsState()
    val snackbarHost = remember { SnackbarHostState() }
    val confirmationText = confirmation?.let { playarrString(it) }
    LaunchedEffect(Unit) { viewModel.load() }
    LaunchedEffect(confirmationText) {
        if (confirmationText != null) {
            snackbarHost.showSnackbar(confirmationText)
            viewModel.confirmationShown()
        }
    }
    Box(Modifier.fillMaxSize()) {
        PlayarrPageScaffold(
            title = playarrString(PlayarrString.GuardianApprovalsTitle),
            onBack = onBack,
            isTelevision = isTelevision,
        ) {
            when (val current = state) {
                ParityLoad.Loading -> ParityLoading(playarrString(PlayarrString.GuardianApprovalsLoading))
                is ParityLoad.Failed -> ParityFailure(current.message, viewModel::load)
                is ParityLoad.Ready -> {
                    val pending = pendingGuardianApprovals(
                        current.value.approvals,
                        selfId,
                        guardianFor,
                        Instant.now(),
                    )
                    if (pending.isEmpty()) {
                        ExperienceEmpty(
                            playarrString(PlayarrString.GuardianApprovalsEmptyTitle),
                            playarrString(PlayarrString.GuardianApprovalsEmptyDescription),
                        )
                    } else {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize().padding(top = 18.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                            contentPadding = PaddingValues(bottom = 104.dp),
                        ) {
                            items(pending, key = { it.id }) { approval ->
                                GuardianApprovalCard(
                                    approval = approval,
                                    profileName = current.value.names[approval.profileUserId].orEmpty()
                                        .ifBlank { playarrString(PlayarrString.ProfileViewerFallback) },
                                    busy = busyId != null,
                                    error = errors[approval.id],
                                    onDecide = { viewModel.decide(approval, it) },
                                )
                            }
                        }
                    }
                }
            }
        }
        SnackbarHost(
            hostState = snackbarHost,
            modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
        )
    }
}

/**
 * One request. Approving needs the guardian's own four-digit PIN; budget
 * requests also take the bonus minutes. Denying needs neither.
 */
@Composable
internal fun GuardianApprovalCard(
    approval: HouseholdApproval,
    profileName: String,
    busy: Boolean,
    error: PlayarrMessage?,
    onDecide: (GuardianDecision) -> Unit,
    modifier: Modifier = Modifier,
) {
    var pin by remember(approval.id) { mutableStateOf("") }
    var bonus by remember(approval.id) { mutableStateOf(DefaultGuardianBonusMinutes.toString()) }
    val bonusMinutes = parseBonusMinutes(bonus)
    val showBonus = hasBonus(approval)
    val canApprove = !busy && pin.length == 4 && (!showBonus || bonusMinutes != null)
    Surface(
        color = WebSurfaceStrong.copy(alpha = 0.6f),
        shape = RoundedCornerShape(14.dp),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                playarrString(
                    PlayarrString.GuardianRequestLine,
                    "name" to profileName,
                    "what" to playarrString(guardianSubjectLabel(approval)),
                ),
                color = WebInk,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp,
            )
            approval.note?.takeIf(String::isNotBlank)?.let { Text(it, color = WebInkMuted, fontSize = 12.sp) }
            OutlinedTextField(
                value = pin,
                onValueChange = { value -> if (value.length <= 4 && value.all(Char::isDigit)) pin = value },
                label = { Text(playarrString(PlayarrString.GuardianPinLabel)) },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                singleLine = true,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().testTag("guardian-pin").playarrSingleLineArrowNavigation(),
            )
            if (showBonus) {
                OutlinedTextField(
                    value = bonus,
                    onValueChange = { value -> if (value.length <= 3 && value.all(Char::isDigit)) bonus = value },
                    label = { Text(playarrString(PlayarrString.GuardianBonusLabel)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    isError = bonusMinutes == null,
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth().testTag("guardian-bonus").playarrSingleLineArrowNavigation(),
                )
            }
            error?.let {
                Text(
                    playarrText(it),
                    color = MaterialTheme.colorScheme.error,
                    fontSize = 12.sp,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PlayarrButton(
                    onClick = { onDecide(GuardianDecision(true, pin, bonusMinutes.takeIf { showBonus })) },
                    enabled = canApprove,
                    modifier = Modifier.testTag("guardian-approve"),
                ) { Text(playarrString(if (busy) PlayarrString.GuardianSending else PlayarrString.GuardianApprove)) }
                PlayarrButton(
                    onClick = { onDecide(GuardianDecision(false, null, null)) },
                    enabled = !busy,
                    variant = PlayarrButtonVariant.Secondary,
                    modifier = Modifier.testTag("guardian-deny"),
                ) { Text(playarrString(PlayarrString.GuardianDeny)) }
            }
        }
    }
}
