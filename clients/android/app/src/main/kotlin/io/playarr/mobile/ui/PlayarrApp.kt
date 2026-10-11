package io.playarr.mobile.ui

import io.playarr.shared.designsystem.page.LocalPlayarrFormFactor
import io.playarr.shared.designsystem.page.LocalPlayarrPhoneInsets
import io.playarr.shared.designsystem.page.LocalPlayarrWebTextStyle
import io.playarr.shared.designsystem.page.PlayarrFormFactor
import io.playarr.shared.designsystem.component.PlayarrButton
import io.playarr.shared.designsystem.component.PlayarrButtonVariant
import io.playarr.shared.designsystem.component.PlayarrIconButton
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.isSystemInDarkTheme
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import androidx.compose.ui.zIndex
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
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
import io.playarr.shared.auth.QrPairingFlow
import io.playarr.shared.auth.QrPairingUpdate
import io.playarr.shared.auth.KnownServerGroupStore
import io.playarr.shared.auth.model.ClientPlatform
import io.playarr.shared.auth.model.HostedLinkCodeResponse
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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.Job
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
private val PlayarrViolet get() = WebAccent

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
            // Hosted QR leaves server URL blank until a link completes, so do not
            // require an exact server match — any saved session is enough to
            // show the profiles picker and the chrome back control (web always
            // exposes back → /profiles from /login/qr).
            val hasProfiles = session.savedProfiles.isNotEmpty()
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
    private var pairingJob: Job? = null

    fun login(serverUrl: String, username: String, password: String, isTelevision: Boolean) {
        if (_state.value == LoginState.Submitting) return
        viewModelScope.launch {
            val normalisedUrl = runCatching { normaliseServerUrl(serverUrl) }.getOrElse {
                _state.value = LoginState.Failed(LoginFailure.InvalidServer)
                return@launch
            }
            _state.value = LoginState.Submitting
            try {
                val trimmedUsername = username.trim().ifBlank { null }
                // Add, never replace: other saved accounts stay in TokenStore. A new
                // account gets its own device id (the server keeps one refresh family
                // per device id, so sharing one would revoke the previous account).
                val deviceId = tokenStore.deviceIdForLogin(normalisedUrl, trimmedUsername)
                serverConfigStore.setBaseUrl(normalisedUrl)
                val response = loginApi.login(
                    LoginRequest(
                        deviceId = deviceId,
                        deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                        clientPlatform = if (isTelevision) ClientPlatform.AndroidTv else ClientPlatform.AndroidMobile,
                        clientVersion = BuildConfig.VERSION_NAME,
                        username = trimmedUsername,
                        password = password.ifBlank { null },
                    ),
                )
                tokenStore.signIn(response.toTokenResponse(), response.userId, trimmedUsername, normalisedUrl, deviceId)
                syncProfileDisplayName(
                    savedName = trimmedUsername,
                    listProfiles = { api.listAvailableProfiles() },
                    saveIdentity = { id, name -> tokenStore.saveIdentity(id, name, normalisedUrl) },
                )
                _state.value = LoginState.Idle
            } catch (error: Exception) {
                _state.value = LoginState.Failed(loginFailure(error))
            }
        }
    }

    fun pairTelevision() {
        if (pairingJob?.isActive == true) return
        val flow = QrPairingFlow(
            hosted = hostedDeviceLinkClient,
            device = deviceAuthClient,
            clientPlatform = ClientPlatform.AndroidTv,
            prepareServer = { claim ->
                // The token poll goes to the server the phone chose; no URL is ever typed.
                serverConfigStore.setBaseUrl(claim.serverUrl)
                tokenStore.clearCurrent()
            },
        )
        val job = viewModelScope.launch {
            // Expiry, "session expired" and network blips renew the code inside the flow.
            flow.run().collect { update ->
                when (update) {
                    QrPairingUpdate.Requesting -> _pairing.value = PairingState.Requesting
                    is QrPairingUpdate.ShowCode -> _pairing.value = PairingState.Waiting(update.code)
                    QrPairingUpdate.Declined -> _pairing.value = PairingState.Failed(
                        PairingFailure.Localized(PlayarrString.DeviceLoginDeclined),
                    )
                    is QrPairingUpdate.Linked -> completeHostedPairing(update)
                }
            }
        }
        pairingJob = job
        job.invokeOnCompletion {
            if (pairingJob === job) pairingJob = null
        }
    }

    fun cancelTelevisionPairing() {
        pairingJob?.cancel()
        pairingJob = null
        if (_pairing.value is PairingState.Requesting || _pairing.value is PairingState.Waiting) {
            _pairing.value = PairingState.Idle
        }
    }

    private suspend fun completeHostedPairing(linked: QrPairingUpdate.Linked) {
        val claim = linked.claim
        val urls = (listOf(claim.serverUrl) + claim.serverUrls).distinct()
        tokenStore.save(linked.token)
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
    val port = if (uri.port == PLAYARR_PORT) ":$PLAYARR_PORT" else ""
    return "https://v4-${octets.joinToString("-")}.$RELAY_DOMAIN$port$suffix"
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
    // Static locals recompose their whole subtree when the value changes, so the insets provider is created once.
    val phoneInsets: @Composable () -> androidx.compose.foundation.layout.WindowInsets = remember { { webPhoneInsets() } }
    CompositionLocalProvider(
        LocalPlayarrLanguage provides language,
        LocalPlayarrFormFactor provides if (isTelevision) PlayarrFormFactor.Tv else PlayarrFormFactor.Phone,
        LocalPlayarrPhoneInsets provides phoneInsets,
        LocalPlayarrWebTextStyle provides WebTextStyle,
    ) {
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
                    val initialRoute = remember(current.serverUrl) { parityRoute ?: current.initialRoute }
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
        LaunchedEffect(televisionManualLogin) {
            if (televisionManualLogin) viewModel.cancelTelevisionPairing()
            else viewModel.pairTelevision()
        }
        LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
            if (!televisionManualLogin) viewModel.pairTelevision()
        }
        LifecycleEventEffect(Lifecycle.Event.ON_STOP) {
            viewModel.cancelTelevisionPairing()
        }
        DisposableEffect(viewModel) {
            onDispose(viewModel::cancelTelevisionPairing)
        }
        AuthTokensProvider {
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
 * Auth page tokens mirroring web `:root` / `:root[data-theme="dark"]`.
 * QR plate is always white (scannable), matching `.device-login-qr`.
 */
private data class AuthTokens(
    val bg: Color,
    val surface: Color,
    val surfaceStrong: Color,
    val surfaceSoft: Color,
    val ink: Color,
    val inkSoft: Color,
    val inkMuted: Color,
    val line: Color,
    val lineStrong: Color,
    val accent: Color,
    val rose: Color,
    val danger: Color,
    val qrPlate: Color = Color.White,
)

private val AuthTokensLight = AuthTokens(
    bg = Color(0xFFF5F3F2),
    surface = Color(0xFFFBFAF9),
    surfaceStrong = Color.White,
    surfaceSoft = Color(0xFFDFDCDD),
    ink = Color(0xFF382621),
    inkSoft = Color(0xFF675961),
    inkMuted = Color(0xFFA5969E),
    line = Color(0x24382621),
    lineStrong = Color(0x47382621),
    accent = Color(0xFF675961),
    rose = Color(0xFFCF3157),
    danger = Color(0xFFA8464C),
)

private val AuthTokensDark = AuthTokens(
    bg = Color(0xFF151315),
    surface = Color(0xFF1B181B),
    surfaceStrong = Color(0xFF211D21),
    surfaceSoft = Color(0xFF312A30),
    ink = Color(0xFFF4F0F1),
    inkSoft = Color(0xFFC5B8BD),
    inkMuted = Color(0xFF887A82),
    line = Color(0x1CDFDCDD),
    lineStrong = Color(0x3BDFDCDD),
    accent = Color(0xFFDFDCDD),
    rose = Color(0xFFCF3157),
    danger = Color(0xFFEE9297),
)

private val LocalAuthTokens = staticCompositionLocalOf { AuthTokensDark }

@Composable
private fun rememberAuthTokens(): AuthTokens {
    val display = LocalPlayarrDisplayPreferences.current
    val dark = when (display.theme) {
        PlayarrThemePreference.System -> isSystemInDarkTheme()
        PlayarrThemePreference.Light -> false
        PlayarrThemePreference.Dark -> true
    }
    // Keep the global Compose palette in lockstep with the auth chrome selector.
    androidx.compose.runtime.SideEffect { setPlayarrWebPalette(dark) }
    return if (dark) AuthTokensDark else AuthTokensLight
}

@Composable
private fun AuthTokensProvider(content: @Composable () -> Unit) {
    val tokens = rememberAuthTokens()
    CompositionLocalProvider(LocalAuthTokens provides tokens, content = content)
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
                PlayarrIconButton(onClick = it, contentDescription = playarrString(PlayarrString.CommonBack), modifier = Modifier.padding(start = 14.dp)) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = null)
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
            PlayarrButton(
                onClick = onSubmit,
                enabled = state != LoginState.Submitting && serverUrl.isNotBlank(),
                modifier = Modifier.fillMaxWidth().padding(top = 24.dp).height(48.dp),
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
        PlayarrButton(onClick = { expanded = true }, variant = PlayarrButtonVariant.Ghost) {
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
 * Television pairing UI matches web `https://playarr.app/login/qr`.
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
                    colors = listOf(LocalAuthTokens.current.surface, LocalAuthTokens.current.bg),
                ),
            )
            .background(
                Brush.radialGradient(
                    colors = listOf(LocalAuthTokens.current.rose.copy(alpha = 0.13f), Color.Transparent),
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
                    color = LocalAuthTokens.current.inkMuted,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = 2.6.sp,
                )
                Text(
                    playarrString(PlayarrString.LoginHeading),
                    color = LocalAuthTokens.current.ink,
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
                    color = LocalAuthTokens.current.inkMuted,
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
                                color = LocalAuthTokens.current.rose,
                                modifier = Modifier.size(28.dp),
                                strokeWidth = 2.5.dp,
                            )
                            Text(
                                playarrString(PlayarrString.DeviceLoginCreatingCode),
                                color = LocalAuthTokens.current.inkMuted,
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
                        }

                        PlayarrQrCode(
                            value = state.code.verificationUriComplete,
                            contentDescription = playarrString(PlayarrString.DeviceLoginQrLabel),
                            matrixSize = qrMatrix,
                        )
                        Spacer(Modifier.height(gap))
                        Text(
                            playarrString(PlayarrString.DeviceLoginScanQr),
                            color = LocalAuthTokens.current.inkMuted,
                            fontSize = 14.sp,
                            textAlign = TextAlign.Center,
                        )
                        Text(
                            state.code.verificationUri,
                            color = LocalAuthTokens.current.ink,
                            fontSize = if (tight) 18.sp else 20.sp,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                        Text(
                            playarrString(PlayarrString.DeviceLoginEnterCode),
                            color = LocalAuthTokens.current.inkMuted,
                            fontSize = 14.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                        Text(
                            state.code.userCode,
                            color = LocalAuthTokens.current.ink,
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
                            color = LocalAuthTokens.current.inkMuted,
                            fontSize = 12.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                        Text(
                            playarrString(
                                PlayarrString.DeviceLoginRefreshesIn,
                                "time" to formatDeviceCodeCountdown(secondsRemaining),
                            ),
                            color = LocalAuthTokens.current.inkSoft,
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
                                color = LocalAuthTokens.current.danger,
                                textAlign = TextAlign.Center,
                                fontSize = 15.sp,
                            )
                            // Error/recovery state: D-pad focus lands on the primary action
                            // (as on web TV), not on the theme dropdown in the stage chrome.
                            val tryAgainFocus = remember { FocusRequester() }
                            LaunchedEffect(Unit) { runCatching { tryAgainFocus.requestFocus() } }
                            PlayarrButton(
                                onClick = onStart,
                                modifier = Modifier.focusRequester(tryAgainFocus),
                                containerColor = LocalAuthTokens.current.inkSoft,
                                contentColor = LocalAuthTokens.current.surfaceStrong,
                            ) {
                                Text(playarrString(PlayarrString.DeviceLoginTryAgain))
                            }
                        }
                    }
                }

                // web `.btn.btn-secondary.device-login-manual` pill
                Surface(
                    onClick = onManualLogin,
                    shape = CircleShape,
                    color = LocalAuthTokens.current.surface,
                    border = androidx.compose.foundation.BorderStroke(1.dp, LocalAuthTokens.current.lineStrong),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = if (tight) 16.dp else 22.dp)
                        .height(48.dp),
                ) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            playarrString(PlayarrString.DeviceLoginSignInManually),
                            color = LocalAuthTokens.current.inkSoft,
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
                Brush.linearGradient(listOf(LocalAuthTokens.current.surface, LocalAuthTokens.current.bg)),
            )
            .background(
                Brush.radialGradient(
                    colors = listOf(LocalAuthTokens.current.rose.copy(alpha = 0.13f), Color.Transparent),
                    radius = 900f,
                ),
            )
            .safeDrawingPadding(),
    ) {
        // Web chrome back always returns to profiles; QR toggle is the in-form pill.
        AuthStageChrome(onBack = onBack ?: onBackToQr)
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
                    color = LocalAuthTokens.current.inkMuted,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = 2.6.sp,
                )
                Text(
                    playarrString(PlayarrString.LoginHeading),
                    color = LocalAuthTokens.current.ink,
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
                    color = LocalAuthTokens.current.inkMuted,
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
                PlayarrButton(
                    onClick = onSubmit,
                    enabled = state != LoginState.Submitting && serverUrl.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().padding(top = 24.dp).height(52.dp),
                    containerColor = LocalAuthTokens.current.inkSoft,
                    contentColor = Color.White,
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
                    color = LocalAuthTokens.current.surfaceStrong,
                    border = androidx.compose.foundation.BorderStroke(1.dp, LocalAuthTokens.current.lineStrong),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 16.dp)
                        .height(54.dp),
                ) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            playarrString(PlayarrString.LoginQrSubmit),
                            color = LocalAuthTokens.current.inkSoft,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    }
}

/**
 * Web `tv-stage-chrome`: logo left, optional circular back, then theme + language
 * dropdowns on the right (`ThemeDropdown` + `LanguageDropdown` styling).
 */
@Composable
private fun AuthStageChrome(onBack: (() -> Unit)?) {
    val tokens = LocalAuthTokens.current
    val display = LocalPlayarrDisplayPreferences.current
    var themeExpanded by remember { mutableStateOf(false) }
    var languageExpanded by remember { mutableStateOf(false) }
    var languageQuery by remember { mutableStateOf("") }
    val selectedLanguage = playarrUiLanguageOptions.firstOrNull { it.preference == display.language }
        ?: playarrUiLanguageOptions.first()
    val themeLabel = when (display.theme) {
        PlayarrThemePreference.System -> playarrString(PlayarrString.SettingsThemeSystem)
        PlayarrThemePreference.Light -> playarrString(PlayarrString.SettingsThemeLight)
        PlayarrThemePreference.Dark -> playarrString(PlayarrString.SettingsThemeDark)
    }
    val filteredLanguages = remember(languageQuery, display.language) {
        val q = languageQuery.trim().lowercase()
        if (q.isEmpty()) {
            playarrUiLanguageOptions
        } else {
            playarrUiLanguageOptions.filter { option ->
                val label = option.nativeName ?: "auto"
                label.lowercase().contains(q) ||
                    option.preference.lowercase().contains(q) ||
                    when (option.preference) {
                        "en" -> "english".contains(q)
                        "th" -> "thai".contains(q)
                        "ja" -> "japanese".contains(q)
                        "system" -> "auto".contains(q) || "system".contains(q)
                        else -> false
                    }
            }
        }
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .zIndex(2f)
            .padding(horizontal = 36.dp, vertical = 34.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painter = painterResource(R.drawable.playarr_mark),
            contentDescription = "Playarr",
            tint = Color.Unspecified,
            modifier = Modifier.size(40.dp),
        )
        onBack?.let { back ->
            Spacer(Modifier.width(18.dp))
            // web `.tv-page-back.tv-stage-chrome-back` — circle with centred stroke arrow
            val backLabel = playarrString(PlayarrString.CommonBack)
            Surface(
                onClick = back,
                shape = CircleShape,
                color = tokens.surfaceStrong.copy(alpha = 0.7f),
                border = BorderStroke(1.dp, tokens.lineStrong.copy(alpha = 0.66f)),
                modifier = Modifier
                    .size(48.dp)
                    .semantics { contentDescription = backLabel },
            ) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    // Geometric arrow (Text "←" baseline sits off-centre).
                    Canvas(Modifier.size(18.dp)) {
                        val stroke = Stroke(
                            width = 2.2.dp.toPx(),
                            cap = StrokeCap.Round,
                            join = StrokeJoin.Round,
                        )
                        val midY = size.height / 2f
                        val left = size.width * 0.18f
                        val right = size.width * 0.82f
                        val head = size.width * 0.32f
                        drawLine(tokens.inkSoft, Offset(right, midY), Offset(left, midY), stroke.width, StrokeCap.Round)
                        drawLine(tokens.inkSoft, Offset(left + head, midY - head * 0.85f), Offset(left, midY), stroke.width, StrokeCap.Round)
                        drawLine(tokens.inkSoft, Offset(left + head, midY + head * 0.85f), Offset(left, midY), stroke.width, StrokeCap.Round)
                    }
                }
            }
        }
        Spacer(Modifier.weight(1f))
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Theme — web `ThemeDropdown` / `.theme-dropdown-trigger` (min-width 144)
            AuthChromeDropdown(
                label = themeLabel,
                expanded = themeExpanded,
                minWidth = 144.dp,
                alignMenuEnd = false,
                tokens = tokens,
                leadingIcon = { AuthThemeIcon(color = tokens.inkMuted) },
                onToggle = {
                    themeExpanded = !themeExpanded
                    languageExpanded = false
                    languageQuery = ""
                },
                onDismiss = { themeExpanded = false },
            ) {
                PlayarrThemePreference.entries.forEach { option ->
                    val optionLabel = when (option) {
                        PlayarrThemePreference.System -> playarrString(PlayarrString.SettingsThemeSystem)
                        PlayarrThemePreference.Light -> playarrString(PlayarrString.SettingsThemeLight)
                        PlayarrThemePreference.Dark -> playarrString(PlayarrString.SettingsThemeDark)
                    }
                    AuthChromeDropdownOption(
                        label = optionLabel,
                        selected = option == display.theme,
                        tokens = tokens,
                        onClick = {
                            display.setTheme(option)
                            themeExpanded = false
                        },
                    )
                }
            }

            // Language — web `LanguageDropdown` / `.language-dropdown-trigger` (min-width 168)
            AuthChromeDropdown(
                label = selectedLanguage.label(),
                expanded = languageExpanded,
                minWidth = 168.dp,
                alignMenuEnd = true,
                tokens = tokens,
                leadingIcon = { AuthGlobeIcon(color = tokens.inkMuted) },
                onToggle = {
                    val next = !languageExpanded
                    languageExpanded = next
                    themeExpanded = false
                    languageQuery = ""
                },
                onDismiss = {
                    languageExpanded = false
                    languageQuery = ""
                },
                menuHeader = {
                    // web `.language-dropdown-search`
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        AuthSearchIcon(color = tokens.inkMuted)
                        Box(Modifier.weight(1f)) {
                            if (languageQuery.isEmpty()) {
                                Text(
                                    playarrString(PlayarrString.LanguageDropdownSearch),
                                    color = tokens.inkMuted,
                                    fontSize = 12.sp,
                                )
                            }
                            BasicTextField(
                                value = languageQuery,
                                onValueChange = { languageQuery = it },
                                singleLine = true,
                                textStyle = TextStyle(
                                    color = tokens.ink,
                                    fontSize = 12.sp,
                                ),
                                cursorBrush = SolidColor(tokens.accent),
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(1.dp)
                            .background(tokens.line),
                    )
                },
            ) {
                if (filteredLanguages.isEmpty()) {
                    Text(
                        playarrString(PlayarrString.LanguageDropdownNoResults),
                        color = tokens.inkMuted,
                        fontSize = 11.5.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 11.dp, vertical = 16.dp),
                    )
                } else {
                    filteredLanguages.forEach { option ->
                        AuthChromeDropdownOption(
                            label = option.label(),
                            selected = option.preference == display.language,
                            tokens = tokens,
                            onClick = {
                                display.setLanguage(option.preference)
                                languageExpanded = false
                                languageQuery = ""
                            },
                        )
                    }
                }
            }
        }
    }
}

/**
 * Web `.language-dropdown` composite: square trigger + absolute square menu.
 * Menus use custom Surfaces (not Material `DropdownMenu`) so radius, border,
 * type, and check colour match `global.css`.
 */
@Composable
private fun AuthChromeDropdown(
    label: String,
    expanded: Boolean,
    minWidth: Dp,
    alignMenuEnd: Boolean,
    tokens: AuthTokens,
    leadingIcon: @Composable () -> Unit,
    onToggle: () -> Unit,
    onDismiss: () -> Unit,
    menuHeader: (@Composable () -> Unit)? = null,
    menuContent: @Composable () -> Unit,
) {
    val density = LocalDensity.current
    Box {
        AuthChromeDropdownTrigger(
            label = label,
            expanded = expanded,
            onClick = onToggle,
            minWidth = minWidth,
            tokens = tokens,
            leadingIcon = leadingIcon,
        )
        if (expanded) {
            Popup(
                alignment = if (alignMenuEnd) Alignment.TopEnd else Alignment.TopStart,
                offset = IntOffset(0, with(density) { (48.dp + 6.dp).roundToPx() }),
                onDismissRequest = onDismiss,
                properties = PopupProperties(focusable = true, dismissOnBackPress = true, dismissOnClickOutside = true),
            ) {
                Surface(
                    shape = RoundedCornerShape(0.dp),
                    color = tokens.surfaceStrong,
                    border = BorderStroke(1.dp, tokens.lineStrong),
                    shadowElevation = 24.dp,
                    // web `.language-dropdown-menu`: width max(240px, 100% of trigger)
                    modifier = Modifier.width(maxOf(minWidth, 240.dp)),
                ) {
                    Column {
                        menuHeader?.invoke()
                        Column(
                            modifier = Modifier
                                .heightIn(max = 260.dp)
                                .verticalScroll(rememberScrollState())
                                .padding(vertical = 6.dp, horizontal = 6.dp),
                        ) {
                            menuContent()
                        }
                    }
                }
            }
        }
    }
}

/** Square-edged chrome control matching web `.language-dropdown-trigger`. */
@Composable
private fun AuthChromeDropdownTrigger(
    label: String,
    expanded: Boolean,
    onClick: () -> Unit,
    minWidth: Dp,
    tokens: AuthTokens,
    leadingIcon: @Composable () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(0.dp),
        color = if (expanded) tokens.surfaceStrong else tokens.bg,
        border = BorderStroke(1.dp, if (expanded) tokens.accent else tokens.lineStrong),
        modifier = Modifier
            .widthIn(min = minWidth)
            .height(48.dp)
            .scale(if (expanded) 1.02f else 1f),
    ) {
        Row(
            Modifier.padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            leadingIcon()
            Text(
                label,
                color = tokens.ink,
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                modifier = Modifier.weight(1f, fill = false),
            )
            AuthChevronIcon(
                color = tokens.inkMuted,
                modifier = Modifier.rotate(if (expanded) 180f else 0f),
            )
        }
    }
}

/** Web `.language-dropdown-option` (+ `.is-selected` check). */
@Composable
private fun AuthChromeDropdownOption(
    label: String,
    selected: Boolean,
    tokens: AuthTokens,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(0.dp),
        color = Color.Transparent,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 11.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                label,
                color = tokens.ink,
                fontSize = 12.sp,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (selected) {
                Text(
                    "✓",
                    color = tokens.accent,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(start = 16.dp),
                )
            }
        }
    }
}

/** Web `ThemeIcon` (sun with rays), 16×16 stroke. */
@Composable
private fun AuthThemeIcon(color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier.size(16.dp)) {
        val stroke = Stroke(width = 1.8.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
        val cx = size.width / 2f
        val cy = size.height / 2f
        val s = size.width / 24f
        drawCircle(color = color, radius = 4f * s, center = Offset(cx, cy), style = stroke)
        val rays = listOf(
            Offset(12f, 3f) to Offset(12f, 5f),
            Offset(12f, 19f) to Offset(12f, 21f),
            Offset(3f, 12f) to Offset(5f, 12f),
            Offset(19f, 12f) to Offset(21f, 12f),
            Offset(5.64f, 5.64f) to Offset(7.06f, 7.06f),
            Offset(16.94f, 16.94f) to Offset(18.36f, 18.36f),
            Offset(18.36f, 5.64f) to Offset(16.94f, 7.06f),
            Offset(7.06f, 16.94f) to Offset(5.64f, 18.36f),
        )
        rays.forEach { (a, b) ->
            drawLine(
                color = color,
                start = Offset(a.x * s, a.y * s),
                end = Offset(b.x * s, b.y * s),
                strokeWidth = stroke.width,
                cap = StrokeCap.Round,
            )
        }
    }
}

/** Web `LanguageGlobeIcon`, 16×16 stroke. */
@Composable
private fun AuthGlobeIcon(color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier.size(16.dp)) {
        val stroke = Stroke(width = 1.8.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
        val s = size.width / 24f
        drawCircle(
            color = color,
            radius = 8.5f * s,
            center = Offset(12f * s, 12f * s),
            style = stroke,
        )
        drawLine(
            color = color,
            start = Offset(3.5f * s, 12f * s),
            end = Offset(20.5f * s, 12f * s),
            strokeWidth = stroke.width,
            cap = StrokeCap.Round,
        )
        // Meridians approximated as vertical ellipses via cubic-ish paths.
        val left = Path().apply {
            moveTo(12f * s, 3.5f * s)
            cubicTo(9.8f * s, 5.8f * s, 8.7f * s, 8.6f * s, 8.7f * s, 12f * s)
            cubicTo(8.7f * s, 15.4f * s, 9.8f * s, 18.2f * s, 12f * s, 20.5f * s)
        }
        val right = Path().apply {
            moveTo(12f * s, 3.5f * s)
            cubicTo(14.2f * s, 5.8f * s, 15.3f * s, 8.6f * s, 15.3f * s, 12f * s)
            cubicTo(15.3f * s, 15.4f * s, 14.2f * s, 18.2f * s, 12f * s, 20.5f * s)
        }
        drawPath(left, color = color, style = stroke)
        drawPath(right, color = color, style = stroke)
    }
}

/** Web chevron (12×12), path `m6 9 6 6 6-6` in 24 viewBox. */
@Composable
private fun AuthChevronIcon(color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier.size(12.dp)) {
        val stroke = Stroke(width = 1.8.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
        val s = size.width / 24f
        val path = Path().apply {
            moveTo(6f * s, 9f * s)
            lineTo(12f * s, 15f * s)
            lineTo(18f * s, 9f * s)
        }
        drawPath(path, color = color, style = stroke)
    }
}

/** Web search glyph for language menu header. */
@Composable
private fun AuthSearchIcon(color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier.size(14.dp)) {
        val stroke = Stroke(width = 1.8.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
        val s = size.width / 24f
        drawCircle(
            color = color,
            radius = 6.5f * s,
            center = Offset(10.5f * s, 10.5f * s),
            style = stroke,
        )
        drawLine(
            color = color,
            start = Offset(15.5f * s, 15.5f * s),
            end = Offset(20f * s, 20f * s),
            strokeWidth = stroke.width,
            cap = StrokeCap.Round,
        )
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
        color = LocalAuthTokens.current.qrPlate,
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
