package io.playarr.mobile.ui

import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import androidx.compose.foundation.text.KeyboardOptions
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.core.graphics.createBitmap
import androidx.core.graphics.set
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import dagger.hilt.android.lifecycle.HiltViewModel
import io.playarr.mobile.BuildConfig
import io.playarr.mobile.R
import io.playarr.shared.auth.TokenStore
import io.playarr.shared.auth.DeviceAuthClient
import io.playarr.shared.auth.HostedDeviceLinkClient
import io.playarr.shared.auth.KnownServerGroupStore
import io.playarr.shared.auth.model.ClientPlatform
import io.playarr.shared.auth.model.DevicePollResult
import io.playarr.shared.auth.model.HostedLinkCodeResponse
import io.playarr.shared.auth.model.HostedLinkPollResult
import io.playarr.shared.auth.model.KnownServer
import io.playarr.shared.auth.model.KnownServerGroup
import io.playarr.shared.auth.model.LoginRequest
import io.playarr.shared.auth.model.toTokenResponse
import io.playarr.shared.auth.remote.LoginApi
import io.playarr.shared.data.config.ServerConfigStore
import io.playarr.shared.data.remote.PlayarrApi
import java.net.URI
import javax.inject.Inject
import kotlin.math.max
import kotlin.math.min
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

private val PlayarrBackground get() = WebBackground
private val PlayarrPanel get() = WebSurfaceStrong
private val PlayarrViolet get() = WebPink

sealed interface RootState {
    data object Loading : RootState
    data class SignedOut(
        val savedServerUrl: String,
        val showProfiles: Boolean,
        val canReturnToProfiles: Boolean,
    ) : RootState
    data class SignedIn(
        val serverUrl: String,
        val initialRoute: String,
        val accessToken: String,
        val refreshToken: String,
        val userId: String,
        val userName: String,
    ) : RootState
}

@HiltViewModel
class PlayarrRootViewModel @Inject constructor(
    private val tokenStore: TokenStore,
    private val serverConfigStore: ServerConfigStore,
) : ViewModel() {
    private val loginRequested = MutableStateFlow(false)
    private val postAuthRoute = MutableStateFlow("home")
    private val sessionState = combine(
        combine(
            tokenStore.accessToken,
            tokenStore.refreshToken,
            tokenStore.currentUserId,
            tokenStore.currentUserName,
            serverConfigStore.baseUrl,
        ) { accessToken, refreshToken, userId, userName, savedServerUrl ->
            SessionSnapshot(
                accessToken = accessToken,
                refreshToken = refreshToken,
                userId = userId,
                userName = userName,
                savedServerUrl = savedServerUrl,
                savedProfiles = emptyList(),
            )
        },
        tokenStore.savedProfiles,
    ) { partial, savedProfiles ->
        partial.copy(savedProfiles = savedProfiles)
    }
    private val navigationState = combine(loginRequested, postAuthRoute, ::Pair)

    val state: StateFlow<RootState> = combine(sessionState, navigationState) { session, navigation ->
        val (showLogin, initialRoute) = navigation
        val serverUrl = session.savedServerUrl.takeIf { it.isNotBlank() }
            ?.let { runCatching { normaliseServerUrl(it) }.getOrDefault(it) }
            .orEmpty()
        if (serverUrl != session.savedServerUrl) serverConfigStore.setBaseUrl(serverUrl)
        val access = session.accessToken
        if (access.isNullOrBlank() || serverUrl.isBlank()) {
            val hasProfiles = session.savedProfiles.any { it.serverUrl == serverUrl }
            RootState.SignedOut(
                savedServerUrl = serverUrl,
                showProfiles = hasProfiles && !showLogin,
                canReturnToProfiles = hasProfiles,
            )
        } else {
            tokenStore.bindCurrentServer(serverUrl)
            RootState.SignedIn(
                serverUrl = serverUrl,
                initialRoute = initialRoute,
                accessToken = access,
                refreshToken = session.refreshToken.orEmpty(),
                userId = session.userId.orEmpty(),
                userName = session.userName.orEmpty(),
            )
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), RootState.Loading)

    init {
        viewModelScope.launch {
            tokenStore.accessToken.filterNotNull().collect { loginRequested.value = false }
        }
    }

    fun addProfile() {
        viewModelScope.launch {
            loginRequested.value = true
            tokenStore.clearCurrent()
        }
    }

    fun returnToProfiles() {
        loginRequested.value = false
    }

    fun resumeAfterProfile() {
        loginRequested.value = false
    }

    fun openAfterProfile(route: String) {
        postAuthRoute.value = route
        loginRequested.value = false
    }

    fun rememberRoute(route: String) {
        postAuthRoute.value = route
    }
}

private data class SessionSnapshot(
    val accessToken: String?,
    val refreshToken: String?,
    val userId: String?,
    val userName: String?,
    val savedServerUrl: String,
    val savedProfiles: List<io.playarr.shared.auth.SavedProfile>,
)

sealed interface LoginState {
    data object Idle : LoginState
    data object Submitting : LoginState
    data class Failed(val failure: LoginFailure) : LoginState
}

enum class LoginFailure {
    InvalidServer,
    MissingCredentials,
    Rejected,
    Forbidden,
    Connection,
}

internal sealed interface PairingState {
    data object Idle : PairingState
    data object Requesting : PairingState
    data class Waiting(val code: HostedLinkCodeResponse) : PairingState
    data class Failed(val failure: PairingFailure) : PairingState
}

internal sealed interface PairingFailure {
    data class Localized(val key: PlayarrString) : PairingFailure
    data class Message(val text: String) : PairingFailure
}

@HiltViewModel
internal class LoginViewModel @Inject constructor(
    private val loginApi: LoginApi,
    private val deviceAuthClient: DeviceAuthClient,
    private val hostedDeviceLinkClient: HostedDeviceLinkClient,
    private val tokenStore: TokenStore,
    private val serverConfigStore: ServerConfigStore,
    private val knownServerGroupStore: KnownServerGroupStore,
    private val api: PlayarrApi,
) : ViewModel() {
    private val _state = MutableStateFlow<LoginState>(LoginState.Idle)
    val state: StateFlow<LoginState> = _state.asStateFlow()
    private val _pairing = MutableStateFlow<PairingState>(PairingState.Idle)
    val pairing: StateFlow<PairingState> = _pairing.asStateFlow()

    fun login(serverUrl: String, username: String, password: String, isTelevision: Boolean) {
        if (_state.value == LoginState.Submitting) return
        viewModelScope.launch {
            val normalisedUrl = runCatching { normaliseServerUrl(serverUrl) }.getOrElse {
                _state.value = LoginState.Failed(LoginFailure.InvalidServer)
                return@launch
            }
            _state.value = LoginState.Submitting
            try {
                serverConfigStore.setBaseUrl(normalisedUrl)
                tokenStore.clearCurrent()
                val response = loginApi.login(
                    LoginRequest(
                        deviceId = tokenStore.getOrCreateDeviceId(),
                        deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                        clientPlatform = if (isTelevision) ClientPlatform.AndroidTv else ClientPlatform.AndroidMobile,
                        clientVersion = BuildConfig.VERSION_NAME,
                        username = username.trim().ifBlank { null },
                        password = password.ifBlank { null },
                    ),
                )
                tokenStore.save(response.toTokenResponse())
                tokenStore.saveIdentity(response.userId, username.trim().ifBlank { null }, normalisedUrl)
                _state.value = LoginState.Idle
            } catch (error: Exception) {
                _state.value = LoginState.Failed(loginFailure(error))
            }
        }
    }

    fun pairTelevision() {
        if (_pairing.value == PairingState.Requesting) return
        viewModelScope.launch {
            _pairing.value = PairingState.Requesting
            runCatching {
                hostedDeviceLinkClient.requestCode(ClientPlatform.AndroidTv)
            }.onFailure {
                _pairing.value = PairingState.Failed(
                    PairingFailure.Localized(PlayarrString.DeviceLoginStartFailed),
                )
            }.onSuccess { code ->
                _pairing.value = PairingState.Waiting(code)
                hostedDeviceLinkClient.pollUntilResolved(code).collect { result ->
                    // Ignore stale polls after a manual/auto refresh started a new code.
                    if (_pairing.value !is PairingState.Waiting) return@collect
                    when (result) {
                        HostedLinkPollResult.AuthorizationPending -> Unit
                        HostedLinkPollResult.Expired -> {
                            // Match web /login/qr: renew immediately instead of trapping the user.
                            pairTelevision()
                        }
                        is HostedLinkPollResult.Failed -> {
                            _pairing.value = PairingState.Failed(PairingFailure.Message(result.message))
                        }
                        is HostedLinkPollResult.Approved -> completeHostedPairing(result)
                    }
                }
            }
        }
    }

    private suspend fun completeHostedPairing(result: HostedLinkPollResult.Approved) {
        val claim = result.claim
        serverConfigStore.setBaseUrl(claim.serverUrl)
        tokenStore.clearCurrent()
        val urls = (listOf(claim.serverUrl) + claim.serverUrls).distinct()
        deviceAuthClient.pollUntilResolved(claim.serverDeviceCode, 1).collect { tokenResult ->
            when (tokenResult) {
                is DevicePollResult.Approved -> {
                    tokenStore.save(tokenResult.token)
                    knownServerGroupStore.rememberGroup(
                        KnownServerGroup(
                            servers = urls.map { KnownServer(url = it) },
                            lastGoodUrl = claim.serverUrl,
                        ),
                    )
                    val current = runCatching { api.listAvailableProfiles().firstOrNull { it.isCurrent } }.getOrNull()
                    current?.let { tokenStore.saveIdentity(it.id, it.displayName, claim.serverUrl) }
                    _pairing.value = PairingState.Idle
                }
                DevicePollResult.AuthorizationPending, DevicePollResult.SlowDown -> Unit
                DevicePollResult.Expired -> {
                    _pairing.value = PairingState.Failed(
                        PairingFailure.Localized(PlayarrString.DeviceLoginSessionExpired),
                    )
                }
                DevicePollResult.Denied -> {
                    _pairing.value = PairingState.Failed(
                        PairingFailure.Localized(PlayarrString.DeviceLoginDeclined),
                    )
                }
                is DevicePollResult.Failed -> {
                    _pairing.value = PairingState.Failed(PairingFailure.Message(tokenResult.message))
                }
            }
        }
    }
}

internal fun normaliseServerUrl(value: String): String {
    val trimmed = value.trim()
    require(trimmed.isNotEmpty())
    val candidate = if (SCHEME_PATTERN.containsMatchIn(trimmed)) trimmed else "http://$trimmed"
    val uri = runCatching { URI(candidate) }.getOrElse { throw IllegalArgumentException("Invalid server URL", it) }
    require(uri.scheme == "http" || uri.scheme == "https")
    require(!uri.host.isNullOrBlank())
    return publicIpv4RelayUrl(uri) ?: candidate.trimEnd('/')
}

private val SCHEME_PATTERN = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://")
private val RELAY_HOST_PATTERN = Regex(
    "^v4-(\\d{1,3})-(\\d{1,3})-(\\d{1,3})-(\\d{1,3})\\.relay\\.playarr\\.app$",
    RegexOption.IGNORE_CASE,
)
private const val RELAY_DOMAIN = "relay.playarr.app"
private const val PLAYARR_PORT = 8484

private fun publicIpv4RelayUrl(uri: URI): String? {
    val hostname = uri.host ?: return null
    val encodedAddress = RELAY_HOST_PATTERN.matchEntire(hostname)
        ?.groupValues
        ?.drop(1)
        ?.joinToString(".")
    val octets = publicIpv4Octets(encodedAddress ?: hostname) ?: return null
    val suffix = buildString {
        uri.rawPath?.takeUnless { it.isEmpty() || it == "/" }?.let(::append)
        uri.rawQuery?.let { append('?').append(it) }
        uri.rawFragment?.let { append('#').append(it) }
    }
    return "https://v4-${octets.joinToString("-")}.$RELAY_DOMAIN:$PLAYARR_PORT$suffix"
}

private fun publicIpv4Octets(hostname: String): List<Int>? {
    val octets = hostname.split('.').mapNotNull { it.toIntOrNull() }
    if (octets.size != 4 || octets.any { it !in 0..255 }) return null
    val (first, second, third) = octets
    if (
        first == 0 ||
        first == 10 ||
        first == 127 ||
        (first == 100 && second in 64..127) ||
        (first == 169 && second == 254) ||
        (first == 172 && second in 16..31) ||
        (first == 192 && second == 0 && third in setOf(0, 2)) ||
        (first == 192 && second == 88 && third == 99) ||
        (first == 192 && second == 168) ||
        (first == 198 && second in 18..19) ||
        (first == 198 && second == 51 && third == 100) ||
        (first == 203 && second == 0 && third == 113) ||
        first >= 224
    ) return null
    return octets
}

private fun loginFailure(error: Exception): LoginFailure = when {
    error.message?.contains("400") == true -> LoginFailure.MissingCredentials
    error.message?.contains("401") == true -> LoginFailure.Rejected
    error.message?.contains("403") == true -> LoginFailure.Forbidden
    else -> LoginFailure.Connection
}

private val LoginFailure.messageKey: PlayarrString get() = when (this) {
    LoginFailure.InvalidServer -> PlayarrString.LoginInvalidServer
    LoginFailure.MissingCredentials -> PlayarrString.LoginMissingCredentials
    LoginFailure.Rejected -> PlayarrString.LoginRejected
    LoginFailure.Forbidden -> PlayarrString.LoginForbidden
    LoginFailure.Connection -> PlayarrString.LoginConnectionFailed
}

@Composable
fun PlayarrApp(
    isTelevision: Boolean,
    rootViewModel: PlayarrRootViewModel = hiltViewModel(),
) {
    val state by rootViewModel.state.collectAsState()
    val display = LocalPlayarrDisplayPreferences.current
    val language = rememberPlayarrLanguageState(display.language)
    val systemDark = isSystemInDarkTheme()
    val darkTheme = when (display.theme) {
        PlayarrThemePreference.System -> systemDark
        PlayarrThemePreference.Light -> false
        PlayarrThemePreference.Dark -> true
    }
    CompositionLocalProvider(LocalPlayarrLanguage provides language) {
        Surface(modifier = Modifier.fillMaxSize(), color = PlayarrBackground, contentColor = Color.White) {
            when (val current = state) {
                RootState.Loading -> LoadingScreen()
                is RootState.SignedOut -> if (current.showProfiles) {
                    ExperienceProfilesScreen(
                        isTelevision = isTelevision,
                        currentUserId = "",
                        currentAvatar = null,
                        onHome = rootViewModel::resumeAfterProfile,
                        onSettings = { rootViewModel.openAfterProfile("settings") },
                        onAddProfile = rootViewModel::addProfile,
                    )
                } else {
                    LoginScreen(
                        savedServerUrl = current.savedServerUrl,
                        isTelevision = isTelevision,
                        onBack = (rootViewModel::returnToProfiles).takeIf { current.canReturnToProfiles },
                    )
                }
                is RootState.SignedIn -> {
                    val initialRoute = remember(current.serverUrl) { current.initialRoute }
                    // Fully native on every form factor (phone, tablet, TV).
                    // Never mount a WebView shell for television "parity".
                    // Policy: docs/architecture/client-principles.md and
                    // clients/android/AGENTS.md.
                    PlayarrExperience(
                        serverUrl = current.serverUrl,
                        isTelevision = isTelevision,
                        initialRoute = initialRoute,
                        onAddProfile = rootViewModel::addProfile,
                        onRouteChanged = rootViewModel::rememberRoute,
                    )
                }
            }
        }
    }
}

@Composable
private fun LoadingScreen() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            PlayarrMark()
            Spacer(Modifier.height(28.dp))
            CircularProgressIndicator(color = PlayarrViolet)
        }
    }
}

@Composable
private fun LoginScreen(
    savedServerUrl: String,
    isTelevision: Boolean,
    onBack: (() -> Unit)?,
    viewModel: LoginViewModel = hiltViewModel(),
) {
    BackHandler(enabled = onBack != null) { onBack?.invoke() }
    val loginState by viewModel.state.collectAsState()
    val pairingState by viewModel.pairing.collectAsState()
    var serverUrl by remember(savedServerUrl) { mutableStateOf(savedServerUrl) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    // Web /login/qr ↔ /login toggle: TV starts on hosted QR, can switch to credentials.
    var televisionManualLogin by remember { mutableStateOf(false) }

    if (isTelevision) {
        // TV auth uses AuthDark (web dark theme). QR plate stays white for scan.
        LaunchedEffect(Unit) { viewModel.pairTelevision() }

        if (televisionManualLogin) {
            TelevisionManualLoginScreen(
                serverUrl = serverUrl,
                onServerUrlChange = { serverUrl = it },
                username = username,
                onUsernameChange = { username = it },
                password = password,
                onPasswordChange = { password = it },
                state = loginState,
                onSubmit = { viewModel.login(serverUrl, username, password, isTelevision = true) },
                onBackToQr = { televisionManualLogin = false },
                onBack = onBack,
            )
        } else {
            TelevisionPairingScreen(
                state = pairingState,
                onStart = viewModel::pairTelevision,
                onManualLogin = { televisionManualLogin = true },
                onBack = onBack,
            )
        }
        return
    }

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.radialGradient(
                    colors = listOf(Color(0x332D1B69), PlayarrBackground),
                    radius = 1_100f,
                ),
            )
            .safeDrawingPadding(),
    ) {
        val compact = maxHeight < 600.dp
        MobileLoginScreen(
            serverUrl = serverUrl,
            onServerUrlChange = { serverUrl = it },
            username = username,
            onUsernameChange = { username = it },
            password = password,
            onPasswordChange = { password = it },
            state = loginState,
            onSubmit = { viewModel.login(serverUrl, username, password, false) },
            compact = compact,
            onBack = onBack,
        )
    }
}

/**
 * Dark auth tokens matching web `:root[data-theme="dark"]`.
 * Android TV is always a dark ten-foot shell; only the QR plate stays white
 * so phones can scan it (same as web `.device-login-qr` background: #fff).
 */
private object AuthDark {
    val bg = Color(0xFF151315)
    val surface = Color(0xFF1B181B)
    val surfaceStrong = Color(0xFF211D21)
    val ink = Color(0xFFF4F0F1)
    val inkSoft = Color(0xFFC5B8BD)
    val inkMuted = Color(0xFF887A82)
    val lineStrong = Color(0x3BDFDCDD) // ~23% white line
    val rose = Color(0xFFCF3157)
    val qrPlate = Color.White
}

@Composable
private fun MobileLoginScreen(
    serverUrl: String,
    onServerUrlChange: (String) -> Unit,
    username: String,
    onUsernameChange: (String) -> Unit,
    password: String,
    onPasswordChange: (String) -> Unit,
    state: LoginState,
    onSubmit: () -> Unit,
    compact: Boolean,
    onBack: (() -> Unit)?,
) {
    val language = LocalPlayarrLanguage.current
    Box(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().zIndex(1f).padding(horizontal = 22.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                painterResource(R.drawable.playarr_mark),
                contentDescription = "Playarr",
                tint = Color.Unspecified,
                modifier = Modifier.size(30.dp),
            )
            onBack?.let {
                IconButton(onClick = it, modifier = Modifier.padding(start = 14.dp)) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = playarrString(PlayarrString.CommonBack))
                }
            }
            Spacer(Modifier.weight(1f))
            PlayarrLanguageDropdown()
        }
        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(
                start = 22.dp,
                end = 22.dp,
                top = if (compact) 96.dp else 188.dp,
                bottom = 48.dp,
            ),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(playarrString(PlayarrString.LoginKicker).uppercase(language.locale), color = WebInkMuted, fontSize = 9.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.7.sp)
            Text(
                playarrString(PlayarrString.LoginHeading),
                color = WebInk,
                fontSize = if (compact) 40.sp else 48.sp,
                fontWeight = FontWeight.Normal,
                letterSpacing = (-2.5).sp,
                maxLines = 1,
                modifier = Modifier.padding(top = 7.dp),
            )
            Text(
                playarrString(PlayarrString.LoginDescription),
                color = WebInkMuted,
                fontSize = 13.sp,
                lineHeight = 19.sp,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.padding(top = 14.dp, bottom = 30.dp),
            )
            LoginField(playarrString(PlayarrString.LoginServerUrl).uppercase(language.locale), serverUrl, onServerUrlChange, KeyboardType.Uri, ImeAction.Next)
            Text(playarrString(PlayarrString.LoginDirectConnectionHint), color = WebInkMuted, fontSize = 8.sp, modifier = Modifier.fillMaxWidth().padding(top = 5.dp, bottom = 18.dp))
            LoginField(playarrString(PlayarrString.LoginUsername).uppercase(language.locale), username, onUsernameChange, KeyboardType.Text, ImeAction.Next)
            Spacer(Modifier.height(18.dp))
            LoginField(playarrString(PlayarrString.LoginPassword).uppercase(language.locale), password, onPasswordChange, KeyboardType.Password, ImeAction.Done, password = true)
            if (state is LoginState.Failed) {
                Text(playarrString(state.failure.messageKey), color = MaterialTheme.colorScheme.error, fontSize = 12.sp, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
            }
            Button(
                onClick = onSubmit,
                enabled = state != LoginState.Submitting && serverUrl.isNotBlank(),
                modifier = Modifier.fillMaxWidth().padding(top = 24.dp).height(48.dp),
                shape = CircleShape,
            ) {
                if (state == LoginState.Submitting) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                else Text(playarrString(PlayarrString.LoginSubmit), fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
internal fun PlayarrLanguageDropdown(modifier: Modifier = Modifier) {
    val display = LocalPlayarrDisplayPreferences.current
    var expanded by remember { mutableStateOf(false) }
    val selected = playarrUiLanguageOptions.firstOrNull { it.preference == display.language }
        ?: playarrUiLanguageOptions.first()
    Box(modifier) {
        TextButton(onClick = { expanded = true }) {
            Text(
                "◎  ${selected.label()}",
                color = WebInk,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
            )
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            playarrUiLanguageOptions.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.label()) },
                    onClick = {
                        display.setLanguage(option.preference)
                        expanded = false
                    },
                    enabled = option.preference != display.language,
                )
            }
        }
    }
}

@Composable
private fun LoginField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    keyboardType: KeyboardType,
    imeAction: ImeAction,
    password: Boolean = false,
) {
    Column(Modifier.fillMaxWidth()) {
        Text(label, color = WebInkMuted, fontSize = 9.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 0.8.sp, modifier = Modifier.padding(bottom = 6.dp))
        OutlinedTextField(
            value,
            onValueChange,
            singleLine = true,
            visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
            modifier = Modifier.fillMaxWidth().height(60.dp).playarrSingleLineArrowNavigation(),
            shape = RoundedCornerShape(0.dp),
        )
    }
}

/**
 * Television pairing UI matches web `https://playarr.example.com/login/qr`.
 *
 * Sized to fit a 1920×1080 stage without scroll: decorative QR glow does not
 * inflate layout height, and vertical padding scales with available height.
 */
@Composable
private fun TelevisionPairingScreen(
    state: PairingState,
    onStart: () -> Unit,
    onManualLogin: () -> Unit,
    onBack: (() -> Unit)?,
) {
    val language = LocalPlayarrLanguage.current
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(
                    colors = listOf(AuthDark.surface, AuthDark.bg),
                ),
            )
            .background(
                Brush.radialGradient(
                    colors = listOf(AuthDark.rose.copy(alpha = 0.13f), Color.Transparent),
                    radius = 900f,
                ),
            )
            .safeDrawingPadding(),
    ) {
        AuthStageChrome(onBack = onBack)

        BoxWithConstraints(
            modifier = Modifier
                .fillMaxSize()
                .padding(top = 88.dp, bottom = 28.dp, start = 64.dp, end = 64.dp),
            contentAlignment = Alignment.Center,
        ) {
            // Scale type/QR slightly on short stages so nothing clips.
            val tight = maxHeight < 920.dp
            val titleSp = if (tight) 48.sp else 56.sp
            val codeSp = if (tight) 40.sp else 48.sp
            val qrMatrix = if (tight) 200.dp else 240.dp
            val gap = if (tight) 10.dp else 14.dp

            Column(
                modifier = Modifier
                    .widthIn(max = 560.dp)
                    .fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    playarrString(PlayarrString.LoginKicker).uppercase(language.locale),
                    color = AuthDark.inkMuted,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = 2.6.sp,
                )
                Text(
                    playarrString(PlayarrString.LoginHeading),
                    color = AuthDark.ink,
                    fontSize = titleSp,
                    fontWeight = FontWeight.Medium,
                    letterSpacing = (-3.6).sp,
                    lineHeight = titleSp * 0.95f,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    modifier = Modifier.padding(top = 6.dp),
                )
                Text(
                    playarrString(PlayarrString.LoginQrDescription),
                    color = AuthDark.inkMuted,
                    fontSize = if (tight) 14.sp else 16.sp,
                    lineHeight = if (tight) 20.sp else 22.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .widthIn(max = 420.dp)
                        .padding(top = 10.dp, bottom = gap + 6.dp),
                )

                when (state) {
                    PairingState.Idle, PairingState.Requesting -> {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(14.dp),
                        ) {
                            CircularProgressIndicator(
                                color = AuthDark.rose,
                                modifier = Modifier.size(28.dp),
                                strokeWidth = 2.5.dp,
                            )
                            Text(
                                playarrString(PlayarrString.DeviceLoginCreatingCode),
                                color = AuthDark.inkMuted,
                                fontSize = 15.sp,
                            )
                        }
                    }
                    is PairingState.Waiting -> {
                        val pairingDescription = playarrString(
                            PlayarrString.DeviceLoginPairingCode,
                            "code" to state.code.userCode,
                        )
                        val lifetimeSeconds = min(
                            5 * 60L,
                            max(1L, state.code.expiresIn),
                        ).toInt()
                        var secondsRemaining by remember(state.code.deviceCode) {
                            mutableIntStateOf(lifetimeSeconds)
                        }
                        LaunchedEffect(state.code.deviceCode) {
                            secondsRemaining = lifetimeSeconds
                            while (secondsRemaining > 0) {
                                delay(1_000)
                                secondsRemaining -= 1
                            }
                            onStart()
                        }

                        PlayarrQrCode(
                            value = state.code.verificationUriComplete,
                            contentDescription = playarrString(PlayarrString.DeviceLoginQrLabel),
                            matrixSize = qrMatrix,
                        )
                        Spacer(Modifier.height(gap))
                        Text(
                            playarrString(PlayarrString.DeviceLoginScanQr),
                            color = AuthDark.inkMuted,
                            fontSize = 14.sp,
                            textAlign = TextAlign.Center,
                        )
                        Text(
                            state.code.verificationUri,
                            color = AuthDark.ink,
                            fontSize = if (tight) 18.sp else 20.sp,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                        Text(
                            playarrString(PlayarrString.DeviceLoginEnterCode),
                            color = AuthDark.inkMuted,
                            fontSize = 14.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                        Text(
                            state.code.userCode,
                            color = AuthDark.ink,
                            fontSize = codeSp,
                            fontWeight = FontWeight.ExtraBold,
                            fontFamily = FontFamily.Monospace,
                            letterSpacing = (0.12f * codeSp.value).sp,
                            maxLines = 1,
                            textAlign = TextAlign.Center,
                            modifier = Modifier
                                .padding(top = 4.dp)
                                .semantics { contentDescription = pairingDescription },
                        )
                        Text(
                            playarrString(PlayarrString.DeviceLoginWaitingApproval),
                            color = AuthDark.inkMuted,
                            fontSize = 12.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                        Text(
                            playarrString(
                                PlayarrString.DeviceLoginRefreshesIn,
                                "time" to formatDeviceCodeCountdown(secondsRemaining),
                            ),
                            color = AuthDark.inkSoft,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                    }
                    is PairingState.Failed -> {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(14.dp),
                            modifier = Modifier.widthIn(max = 420.dp),
                        ) {
                            Text(
                                when (val failure = state.failure) {
                                    is PairingFailure.Localized -> playarrString(failure.key)
                                    is PairingFailure.Message -> failure.text
                                },
                                color = Color(0xFFA8464C),
                                textAlign = TextAlign.Center,
                                fontSize = 15.sp,
                            )
                            Button(
                                onClick = onStart,
                                shape = CircleShape,
                                colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                                    containerColor = AuthDark.inkSoft,
                                    contentColor = Color.White,
                                ),
                            ) {
                                Text(playarrString(PlayarrString.DeviceLoginTryAgain))
                            }
                        }
                    }
                }

                Surface(
                    onClick = onManualLogin,
                    shape = CircleShape,
                    color = AuthDark.surfaceStrong,
                    border = androidx.compose.foundation.BorderStroke(1.dp, AuthDark.lineStrong),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = if (tight) 16.dp else 22.dp)
                        .height(48.dp),
                ) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            playarrString(PlayarrString.DeviceLoginSignInManually),
                            color = AuthDark.inkSoft,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TelevisionManualLoginScreen(
    serverUrl: String,
    onServerUrlChange: (String) -> Unit,
    username: String,
    onUsernameChange: (String) -> Unit,
    password: String,
    onPasswordChange: (String) -> Unit,
    state: LoginState,
    onSubmit: () -> Unit,
    onBackToQr: () -> Unit,
    onBack: (() -> Unit)?,
) {
    val language = LocalPlayarrLanguage.current
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(listOf(AuthDark.surface, AuthDark.bg)),
            )
            .background(
                Brush.radialGradient(
                    colors = listOf(AuthDark.rose.copy(alpha = 0.13f), Color.Transparent),
                    radius = 900f,
                ),
            )
            .safeDrawingPadding(),
    ) {
        AuthStageChrome(onBack = onBackToQr)
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(top = 88.dp, bottom = 28.dp, start = 64.dp, end = 64.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                modifier = Modifier
                    .widthIn(max = 520.dp)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    playarrString(PlayarrString.LoginKicker).uppercase(language.locale),
                    color = AuthDark.inkMuted,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = 2.6.sp,
                )
                Text(
                    playarrString(PlayarrString.LoginHeading),
                    color = AuthDark.ink,
                    fontSize = 48.sp,
                    fontWeight = FontWeight.Medium,
                    letterSpacing = (-3.2).sp,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    modifier = Modifier.padding(top = 8.dp, bottom = 22.dp),
                )
                LoginField(
                    playarrString(PlayarrString.LoginServerUrl).uppercase(language.locale),
                    serverUrl,
                    onServerUrlChange,
                    KeyboardType.Uri,
                    ImeAction.Next,
                )
                Text(
                    playarrString(PlayarrString.LoginDirectConnectionHint),
                    color = AuthDark.inkMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 18.dp),
                )
                LoginField(
                    playarrString(PlayarrString.LoginUsername).uppercase(language.locale),
                    username,
                    onUsernameChange,
                    KeyboardType.Text,
                    ImeAction.Next,
                )
                Spacer(Modifier.height(16.dp))
                LoginField(
                    playarrString(PlayarrString.LoginPassword).uppercase(language.locale),
                    password,
                    onPasswordChange,
                    KeyboardType.Password,
                    ImeAction.Done,
                    password = true,
                )
                if (state is LoginState.Failed) {
                    Text(
                        playarrString(state.failure.messageKey),
                        color = Color(0xFFA8464C),
                        fontSize = 13.sp,
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    )
                }
                Button(
                    onClick = onSubmit,
                    enabled = state != LoginState.Submitting && serverUrl.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().padding(top = 24.dp).height(52.dp),
                    shape = CircleShape,
                    colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                        containerColor = AuthDark.inkSoft,
                        contentColor = Color.White,
                    ),
                ) {
                    if (state == LoginState.Submitting) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Color.White)
                    } else {
                        Text(playarrString(PlayarrString.LoginSubmit), fontWeight = FontWeight.Bold)
                    }
                }
                Surface(
                    onClick = onBackToQr,
                    shape = CircleShape,
                    color = AuthDark.surfaceStrong,
                    border = androidx.compose.foundation.BorderStroke(1.dp, AuthDark.lineStrong),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 16.dp)
                        .height(54.dp),
                ) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            playarrString(PlayarrString.LoginQrSubmit),
                            color = AuthDark.inkSoft,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    }
}

/** Web `tv-stage-chrome`: logo left, optional circular back, language right. */
@Composable
private fun AuthStageChrome(onBack: (() -> Unit)?) {
    val display = LocalPlayarrDisplayPreferences.current
    var languageExpanded by remember { mutableStateOf(false) }
    val selectedLanguage = playarrUiLanguageOptions.firstOrNull { it.preference == display.language }
        ?: playarrUiLanguageOptions.first()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .zIndex(2f)
            .padding(horizontal = 36.dp, vertical = 36.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painter = painterResource(R.drawable.playarr_mark),
            contentDescription = "Playarr",
            tint = Color.Unspecified,
            modifier = Modifier.size(40.dp),
        )
        onBack?.let { back ->
            Spacer(Modifier.width(16.dp))
            Surface(
                onClick = back,
                shape = CircleShape,
                color = AuthDark.surfaceStrong.copy(alpha = 0.7f),
                border = androidx.compose.foundation.BorderStroke(1.dp, AuthDark.lineStrong.copy(alpha = 0.66f)),
                modifier = Modifier.size(48.dp),
            ) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = playarrString(PlayarrString.CommonBack),
                        tint = AuthDark.inkSoft,
                        modifier = Modifier.size(22.dp),
                    )
                }
            }
        }
        Spacer(Modifier.weight(1f))
        Box {
            Surface(
                onClick = { languageExpanded = true },
                shape = RoundedCornerShape(12.dp),
                color = AuthDark.surfaceStrong,
                border = androidx.compose.foundation.BorderStroke(1.dp, AuthDark.lineStrong),
                modifier = Modifier.height(44.dp),
            ) {
                Row(
                    Modifier.padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("◎", color = AuthDark.inkSoft, fontSize = 14.sp)
                    Text(
                        selectedLanguage.label(),
                        color = AuthDark.ink,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
            DropdownMenu(
                expanded = languageExpanded,
                onDismissRequest = { languageExpanded = false },
            ) {
                playarrUiLanguageOptions.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option.label()) },
                        onClick = {
                            display.setLanguage(option.preference)
                            languageExpanded = false
                        },
                        enabled = option.preference != display.language,
                    )
                }
            }
        }
    }
}

/** Matches web `formatDeviceCodeCountdown` (`m:ss`). */
internal fun formatDeviceCodeCountdown(seconds: Int): String {
    val clamped = max(0, seconds)
    val minutes = clamped / 60
    val remainder = clamped % 60
    return "$minutes:${remainder.toString().padStart(2, '0')}"
}

/**
 * Matches live `/login/qr` `.device-login-qr`:
 * white 12dp frame, r=18, ECC M + quiet-zone margin 2, soft shadow.
 * [matrixSize] is the outer border-box (default 240dp). Layout height is only
 * the card — no decorative glow plate that could push the stage off-screen.
 */
@Composable
internal fun PlayarrQrCode(
    value: String,
    contentDescription: String,
    modifier: Modifier = Modifier,
    matrixSize: androidx.compose.ui.unit.Dp = 240.dp,
) {
    val frame = 12.dp
    val contentDp = matrixSize - frame * 2
    val contentPx = contentDp.value.toInt().coerceAtLeast(96)
    val bitmap = remember(value, contentPx) {
        val matrix = QRCodeWriter().encode(
            value,
            BarcodeFormat.QR_CODE,
            contentPx,
            contentPx,
            mapOf(
                EncodeHintType.MARGIN to 2,
                EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
            ),
        )
        createBitmap(contentPx, contentPx).apply {
            for (y in 0 until contentPx) {
                for (x in 0 until contentPx) {
                    this[x, y] = if (matrix[x, y]) {
                        android.graphics.Color.BLACK
                    } else {
                        android.graphics.Color.WHITE
                    }
                }
            }
        }
    }
    Surface(
        color = AuthDark.qrPlate,
        shape = RoundedCornerShape(18.dp),
        modifier = modifier
            .size(matrixSize)
            .shadow(
                // web dark: box-shadow 0 24px 72px rgba(0,0,0,0.3)
                elevation = 28.dp,
                shape = RoundedCornerShape(18.dp),
                ambientColor = Color.Black.copy(alpha = 0.30f),
                spotColor = Color.Black.copy(alpha = 0.30f),
            ),
    ) {
        Image(
            bitmap = bitmap.asImageBitmap(),
            contentDescription = contentDescription,
            contentScale = ContentScale.FillBounds,
            filterQuality = FilterQuality.None,
            modifier = Modifier
                .padding(frame)
                .size(contentDp),
        )
    }
}

@Composable
private fun PlayarrMark() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            painter = painterResource(R.drawable.playarr_mark),
            contentDescription = null,
            tint = Color.Unspecified,
            modifier = Modifier.size(48.dp),
        )
        Spacer(Modifier.width(14.dp))
        Text("Playarr", color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.SemiBold)
    }
}
