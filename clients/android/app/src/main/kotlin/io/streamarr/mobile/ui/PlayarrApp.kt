package io.streamarr.mobile.ui

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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import androidx.compose.foundation.text.KeyboardOptions
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.core.graphics.createBitmap
import androidx.core.graphics.set
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.mobile.BuildConfig
import io.streamarr.mobile.R
import io.streamarr.shared.auth.TokenStore
import io.streamarr.shared.auth.DeviceAuthClient
import io.streamarr.shared.auth.HostedDeviceLinkClient
import io.streamarr.shared.auth.KnownServerGroupStore
import io.streamarr.shared.auth.model.ClientPlatform
import io.streamarr.shared.auth.model.DevicePollResult
import io.streamarr.shared.auth.model.HostedLinkCodeResponse
import io.streamarr.shared.auth.model.HostedLinkPollResult
import io.streamarr.shared.auth.model.KnownServer
import io.streamarr.shared.auth.model.KnownServerGroup
import io.streamarr.shared.auth.model.LoginRequest
import io.streamarr.shared.auth.model.toTokenResponse
import io.streamarr.shared.auth.remote.LoginApi
import io.streamarr.shared.data.config.ServerConfigStore
import io.streamarr.shared.data.remote.StreamarrApi
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import java.net.URI
import javax.inject.Inject
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
    data class SignedIn(val serverUrl: String, val initialRoute: String) : RootState
}

@HiltViewModel
class PlayarrRootViewModel @Inject constructor(
    private val tokenStore: TokenStore,
    private val serverConfigStore: ServerConfigStore,
) : ViewModel() {
    private val loginRequested = MutableStateFlow(false)
    private val postAuthRoute = MutableStateFlow("home")
    private val sessionState = combine(
        tokenStore.accessToken,
        serverConfigStore.baseUrl,
        tokenStore.savedProfiles,
    ) { token, savedServerUrl, savedProfiles ->
        Triple(token, savedServerUrl, savedProfiles)
    }
    private val navigationState = combine(loginRequested, postAuthRoute, ::Pair)

    val state: StateFlow<RootState> = combine(sessionState, navigationState) { session, navigation ->
        val (token, savedServerUrl, savedProfiles) = session
        val (showLogin, initialRoute) = navigation
        val serverUrl = savedServerUrl.takeIf { it.isNotBlank() }
            ?.let { runCatching { normaliseServerUrl(it) }.getOrDefault(it) }
            .orEmpty()
        if (serverUrl != savedServerUrl) serverConfigStore.setBaseUrl(serverUrl)
        if (token.isNullOrBlank() || serverUrl.isBlank()) {
            val hasProfiles = savedProfiles.any { it.serverUrl == serverUrl }
            RootState.SignedOut(
                savedServerUrl = serverUrl,
                showProfiles = hasProfiles && !showLogin,
                canReturnToProfiles = hasProfiles,
            )
        } else {
            tokenStore.bindCurrentServer(serverUrl)
            RootState.SignedIn(serverUrl, initialRoute)
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
    private val api: StreamarrApi,
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
        if (_pairing.value == PairingState.Requesting || _pairing.value is PairingState.Waiting) return
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
                    when (result) {
                        HostedLinkPollResult.AuthorizationPending -> Unit
                        HostedLinkPollResult.Expired -> {
                            _pairing.value = PairingState.Failed(
                                PairingFailure.Localized(PlayarrString.DeviceLoginCodeExpired),
                            )
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
private const val STREAMARR_PORT = 8484

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
    return "https://v4-${octets.joinToString("-")}.$RELAY_DOMAIN:$STREAMARR_PORT$suffix"
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
        if (isTelevision) {
            LaunchedEffect(Unit) { viewModel.pairTelevision() }
            TelevisionPairingScreen(
                state = pairingState,
                onStart = viewModel::pairTelevision,
            )
            return@BoxWithConstraints
        }
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
            modifier = Modifier.fillMaxWidth().height(60.dp),
            shape = RoundedCornerShape(0.dp),
        )
    }
}

@Composable
private fun TelevisionPairingScreen(
    state: PairingState,
    onStart: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxSize(),
    ) {
        Box(
            modifier = Modifier
                .weight(0.55f)
                .fillMaxHeight()
                .background(
                    Brush.radialGradient(
                        colors = listOf(WebPink.copy(alpha = 0.08f), WebSurface),
                        radius = 740f,
                    ),
                ),
        )
        Box(
            modifier = Modifier.weight(1.45f).fillMaxHeight(),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                modifier = Modifier.widthIn(max = 880.dp).fillMaxWidth().padding(70.dp),
                horizontalAlignment = Alignment.Start,
            ) {
                PlayarrPairingBrand()
                Spacer(Modifier.height(70.dp))
                Text(
                    playarrString(PlayarrString.DeviceLoginKicker).uppercase(LocalPlayarrLanguage.current.locale),
                    color = WebInkMuted,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = 2.sp,
                )
                Text(
                    playarrString(PlayarrString.DeviceLoginTitle),
                    color = WebInk,
                    fontSize = 82.sp,
                    fontWeight = FontWeight.Normal,
                    letterSpacing = (-4).sp,
                    lineHeight = 86.sp,
                    modifier = Modifier.padding(top = 8.dp),
                )
                Spacer(Modifier.height(52.dp))
                when (state) {
                    PairingState.Idle, PairingState.Requesting -> {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(18.dp),
                        ) {
                            CircularProgressIndicator(color = WebPink)
                            Text(playarrString(PlayarrString.DeviceLoginCreatingCode), color = WebInkMuted)
                        }
                    }
                    is PairingState.Waiting -> {
                        val pairingDescription = playarrString(
                            PlayarrString.DeviceLoginPairingCode,
                            "code" to state.code.userCode,
                        )
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(72.dp),
                        ) {
                            PlayarrQrCode(
                                state.code.verificationUriComplete,
                                playarrString(PlayarrString.DeviceLoginQrLabel),
                                Modifier.size(240.dp),
                            )
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                Text(playarrString(PlayarrString.DeviceLoginScanQr), color = WebInkMuted, fontSize = 18.sp)
                                Text(
                                    state.code.verificationUri,
                                    color = WebInk,
                                    fontSize = 24.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                                Text(playarrString(PlayarrString.DeviceLoginEnterCode), color = WebInkMuted, fontSize = 18.sp)
                                Text(
                                    state.code.userCode,
                                    color = WebInk,
                                    fontSize = 68.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    letterSpacing = 9.sp,
                                    maxLines = 1,
                                    modifier = Modifier.semantics { contentDescription = pairingDescription },
                                )
                                Text(
                                    playarrString(PlayarrString.DeviceLoginWaitingApproval),
                                    color = WebInkMuted,
                                    fontSize = 12.sp,
                                )
                            }
                        }
                    }
                    is PairingState.Failed -> {
                        Column(
                            modifier = Modifier.widthIn(max = 520.dp),
                            verticalArrangement = Arrangement.spacedBy(18.dp),
                        ) {
                            Text(
                                when (val failure = state.failure) {
                                    is PairingFailure.Localized -> playarrString(failure.key)
                                    is PairingFailure.Message -> failure.text
                                },
                                color = MaterialTheme.colorScheme.error,
                            )
                            Button(onClick = onStart) { Text(playarrString(PlayarrString.DeviceLoginTryAgain)) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlayarrPairingBrand() {
    Column(horizontalAlignment = Alignment.Start, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(
            painter = painterResource(R.drawable.playarr_mark),
            contentDescription = null,
            tint = Color.Unspecified,
            modifier = Modifier.size(48.dp),
        )
        Text("Playarr", color = WebInkSoft, fontSize = 24.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
internal fun PlayarrQrCode(
    value: String,
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    val bitmap = remember(value) {
        val size = 260
        val matrix = QRCodeWriter().encode(
            value,
            BarcodeFormat.QR_CODE,
            size,
            size,
            mapOf(EncodeHintType.MARGIN to 1),
        )
        createBitmap(size, size).apply {
            for (y in 0 until size) {
                for (x in 0 until size) {
                    this[x, y] = if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE
                }
            }
        }
    }
    Surface(color = Color.White, shape = RoundedCornerShape(12.dp)) {
        Image(
            bitmap = bitmap.asImageBitmap(),
            contentDescription = contentDescription,
            modifier = modifier.padding(8.dp),
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
