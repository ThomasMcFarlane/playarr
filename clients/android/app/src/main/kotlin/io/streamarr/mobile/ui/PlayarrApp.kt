package io.streamarr.mobile.ui

import android.os.Build
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.core.graphics.createBitmap
import androidx.core.graphics.set
import androidx.media3.ui.PlayerView
import androidx.compose.ui.viewinterop.AndroidView
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
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
import io.streamarr.shared.data.model.ImageKind
import io.streamarr.shared.data.model.PlaybackMode
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkChildren
import io.streamarr.shared.data.model.WorkDetail
import io.streamarr.shared.data.model.WorkKind
import io.streamarr.shared.data.remote.StreamarrApi
import io.streamarr.shared.designsystem.component.PosterCard
import io.streamarr.shared.domain.model.StreamarrError
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.usecase.BrowseLibraryUseCase
import io.streamarr.shared.domain.usecase.GetPlaybackInfoUseCase
import io.streamarr.shared.domain.usecase.GetWorkDetailsUseCase
import io.streamarr.shared.player.StreamFormat
import io.streamarr.shared.player.StreamarrPlayer
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
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

private val PlayarrBackground get() = WebBackground
private val PlayarrPanel get() = WebSurfaceStrong
private val PlayarrViolet get() = WebPink

sealed interface RootState {
    data object Loading : RootState
    data class SignedOut(val savedServerUrl: String) : RootState
    data class SignedIn(val serverUrl: String) : RootState
}

@HiltViewModel
class PlayarrRootViewModel @Inject constructor(
    tokenStore: TokenStore,
    private val serverConfigStore: ServerConfigStore,
) : ViewModel() {
    val state: StateFlow<RootState> = combine(
        tokenStore.accessToken,
        serverConfigStore.baseUrl,
    ) { token, savedServerUrl ->
        val serverUrl = savedServerUrl.takeIf { it.isNotBlank() }
            ?.let { runCatching { normaliseServerUrl(it) }.getOrDefault(it) }
            .orEmpty()
        if (serverUrl != savedServerUrl) serverConfigStore.setBaseUrl(serverUrl)
        if (token.isNullOrBlank() || serverUrl.isBlank()) {
            RootState.SignedOut(serverUrl)
        } else {
            RootState.SignedIn(serverUrl)
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), RootState.Loading)
}

sealed interface LoginState {
    data object Idle : LoginState
    data object Submitting : LoginState
    data class Failed(val message: String) : LoginState
}

sealed interface PairingState {
    data object Idle : PairingState
    data object Requesting : PairingState
    data class Waiting(val code: HostedLinkCodeResponse) : PairingState
    data class Failed(val message: String) : PairingState
}

@HiltViewModel
class LoginViewModel @Inject constructor(
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
                _state.value = LoginState.Failed("Enter a valid Streamarr server address.")
                return@launch
            }
            _state.value = LoginState.Submitting
            try {
                serverConfigStore.setBaseUrl(normalisedUrl)
                tokenStore.clear()
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
                tokenStore.saveIdentity(response.userId, username.trim().ifBlank { null })
                _state.value = LoginState.Idle
            } catch (error: Exception) {
                _state.value = LoginState.Failed(loginErrorMessage(error))
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
                _pairing.value = PairingState.Failed("Couldn’t reach playarr.app to start linking. Check the connection and try again.")
            }.onSuccess { code ->
                _pairing.value = PairingState.Waiting(code)
                hostedDeviceLinkClient.pollUntilResolved(code).collect { result ->
                    when (result) {
                        HostedLinkPollResult.AuthorizationPending -> Unit
                        HostedLinkPollResult.Expired -> _pairing.value = PairingState.Failed("That link code expired. Start again for a new code.")
                        is HostedLinkPollResult.Failed -> _pairing.value = PairingState.Failed(result.message)
                        is HostedLinkPollResult.Approved -> completeHostedPairing(result)
                    }
                }
            }
        }
    }

    private suspend fun completeHostedPairing(result: HostedLinkPollResult.Approved) {
        val claim = result.claim
        serverConfigStore.setBaseUrl(claim.serverUrl)
        tokenStore.clear()
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
                    current?.let { tokenStore.saveIdentity(it.id, it.displayName) }
                    _pairing.value = PairingState.Idle
                }
                DevicePollResult.AuthorizationPending, DevicePollResult.SlowDown -> Unit
                DevicePollResult.Expired -> _pairing.value = PairingState.Failed("The Streamarr session expired before it could be saved. Start again.")
                DevicePollResult.Denied -> _pairing.value = PairingState.Failed("This TV link request was declined.")
                is DevicePollResult.Failed -> _pairing.value = PairingState.Failed(tokenResult.message)
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

private fun loginErrorMessage(error: Exception): String = when {
    error.message?.contains("400") == true -> "This server requires a username and password."
    error.message?.contains("401") == true -> "The username or password was not accepted."
    error.message?.contains("403") == true -> "This account cannot sign in on this device."
    else -> "Couldn’t connect to that Streamarr server. Check the address and try again."
}

@Composable
fun PlayarrApp(
    isTelevision: Boolean,
    rootViewModel: PlayarrRootViewModel = hiltViewModel(),
) {
    val state by rootViewModel.state.collectAsState()
    Surface(modifier = Modifier.fillMaxSize(), color = PlayarrBackground, contentColor = Color.White) {
        when (val current = state) {
            RootState.Loading -> LoadingScreen()
            is RootState.SignedOut -> LoginScreen(
                savedServerUrl = current.savedServerUrl,
                isTelevision = isTelevision,
            )
            is RootState.SignedIn -> PlayarrExperience(
                serverUrl = current.serverUrl,
                isTelevision = isTelevision,
            )
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
    viewModel: LoginViewModel = hiltViewModel(),
) {
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
) {
    val display = LocalPlayarrDisplayPreferences.current
    Box(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                painterResource(R.drawable.playarr_mark),
                contentDescription = "Playarr",
                tint = Color.Unspecified,
                modifier = Modifier.size(30.dp),
            )
            Surface(
                onClick = {},
                color = Color.Transparent,
                border = androidx.compose.foundation.BorderStroke(1.dp, WebInkMuted.copy(alpha = 0.3f)),
                shape = CircleShape,
                modifier = Modifier.padding(start = 22.dp).size(42.dp),
            ) { Box(contentAlignment = Alignment.Center) { Text("←", color = WebInkSoft) } }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = {
                display.setLanguage(if (display.language == "en") "system" else "en")
            }) {
                Text("◎  ${if (display.language == "system") "Auto" else "English"}", color = WebInk, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
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
            Text("WELCOME HOME", color = WebInkMuted, fontSize = 9.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.7.sp)
            Text(
                "Sign in to Playarr",
                color = WebInk,
                fontSize = if (compact) 40.sp else 48.sp,
                fontWeight = FontWeight.Normal,
                letterSpacing = (-2.5).sp,
                maxLines = 1,
                modifier = Modifier.padding(top = 7.dp),
            )
            Text(
                "Choose your Streamarr server, then save this profile on the current device.",
                color = WebInkMuted,
                fontSize = 13.sp,
                lineHeight = 19.sp,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.padding(top = 14.dp, bottom = 30.dp),
            )
            LoginField("SERVER URL", serverUrl, onServerUrlChange, KeyboardType.Uri, ImeAction.Next)
            Text("Your device connects directly to this server. Playarr does not proxy your login.", color = WebInkMuted, fontSize = 8.sp, modifier = Modifier.fillMaxWidth().padding(top = 5.dp, bottom = 18.dp))
            LoginField("USERNAME", username, onUsernameChange, KeyboardType.Text, ImeAction.Next)
            Spacer(Modifier.height(18.dp))
            LoginField("PASSWORD", password, onPasswordChange, KeyboardType.Password, ImeAction.Done, password = true)
            if (state is LoginState.Failed) {
                Text(state.message, color = MaterialTheme.colorScheme.error, fontSize = 12.sp, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
            }
            Button(
                onClick = onSubmit,
                enabled = state != LoginState.Submitting && serverUrl.isNotBlank(),
                modifier = Modifier.fillMaxWidth().padding(top = 24.dp).height(48.dp),
                shape = CircleShape,
            ) {
                if (state == LoginState.Submitting) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                else Text("Sign in", fontWeight = FontWeight.Bold)
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
        modifier = Modifier.fillMaxSize().padding(horizontal = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        Column(Modifier.weight(0.9f).padding(50.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            PlayarrMark()
            Text("Link this TV", color = WebInk, fontSize = 42.sp, fontWeight = FontWeight.Medium)
            Text("Scan the QR code or enter the generated code at playarr.app/link, then choose the Playarr profile for this TV.", color = WebInkMuted, fontSize = 15.sp, lineHeight = 22.sp)
        }
        Surface(
            modifier = Modifier.weight(1.1f).padding(44.dp),
            color = WebSurfaceStrong.copy(alpha = 0.95f),
            shape = RoundedCornerShape(28.dp),
        ) {
            Column(Modifier.padding(32.dp), verticalArrangement = Arrangement.spacedBy(18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                when (state) {
                    PairingState.Idle, PairingState.Requesting -> CircularProgressIndicator(color = WebPink)
                    is PairingState.Waiting -> {
                        PlayarrQrCode(
                            state.code.verificationUriComplete,
                            "QR code for playarr.app/link",
                        )
                        Text(state.code.userCode, color = WebInk, fontSize = 42.sp, fontWeight = FontWeight.Bold, letterSpacing = 5.sp)
                        Text("Open playarr.app/link and enter this code", color = WebInkSoft, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                        Text("Waiting for approval…", color = WebPink, fontWeight = FontWeight.SemiBold)
                    }
                    is PairingState.Failed -> {
                        Text(state.message, color = MaterialTheme.colorScheme.error, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                        Button(onClick = onStart, modifier = Modifier.fillMaxWidth()) { Text("Try again") }
                    }
                }
            }
        }
    }
}

@Composable
internal fun PlayarrQrCode(
    value: String,
    contentDescription: String,
    modifier: Modifier = Modifier.size(220.dp),
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

@Composable
private fun LoginForm(
    serverUrl: String,
    onServerUrlChange: (String) -> Unit,
    username: String,
    onUsernameChange: (String) -> Unit,
    password: String,
    onPasswordChange: (String) -> Unit,
    state: LoginState,
    onSubmit: () -> Unit,
    compact: Boolean,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        color = PlayarrPanel.copy(alpha = 0.96f),
        contentColor = Color.White,
        shape = RoundedCornerShape(28.dp),
    ) {
        Column(
            modifier = Modifier.padding(if (compact) 16.dp else 28.dp),
            verticalArrangement = Arrangement.spacedBy(if (compact) 8.dp else 16.dp),
        ) {
            Text(
                "Sign in",
                style = if (compact) MaterialTheme.typography.titleLarge else MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
            )
            if (!compact) {
                Text("Connect this device to your Streamarr account.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            OutlinedTextField(
                value = serverUrl,
                onValueChange = onServerUrlChange,
                label = { Text("Server URL") },
                placeholder = { Text("192.168.1.20:8484") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = username,
                onValueChange = onUsernameChange,
                label = { Text("Username") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = onPasswordChange,
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth(),
            )
            if (state is LoginState.Failed) {
                Text(state.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            Button(
                onClick = onSubmit,
                enabled = state != LoginState.Submitting && serverUrl.isNotBlank(),
                modifier = Modifier.fillMaxWidth().height(if (compact) 46.dp else 52.dp),
            ) {
                if (state == LoginState.Submitting) {
                    CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
                } else {
                    Text("Continue")
                }
            }
            if (!compact) {
                Text(
                    "The server address is stored with this account on this device. Nothing is hardcoded into the app.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

private data class Destination(val route: String, val label: String, val mark: String)

private val mainDestinations = listOf(
    Destination("home", "Home", "H"),
    Destination("library", "Library", "L"),
    Destination("settings", "Settings", "S"),
)

@Composable
private fun SignedInApp(serverUrl: String, isTelevision: Boolean) {
    val navController = rememberNavController()
    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        val useRail = isTelevision || maxWidth >= 840.dp
        if (useRail) {
            Row(modifier = Modifier.fillMaxSize()) {
                AppNavigationRail(navController)
                AppNavHost(navController, serverUrl, isTelevision, Modifier.weight(1f))
            }
        } else {
            Scaffold(
                containerColor = PlayarrBackground,
                bottomBar = { AppBottomNavigation(navController) },
            ) { padding ->
                AppNavHost(navController, serverUrl, isTelevision, Modifier.padding(padding))
            }
        }
    }
}

@Composable
private fun AppNavigationRail(navController: NavHostController) {
    val entry by navController.currentBackStackEntryAsState()
    val current = entry?.destination?.route
    NavigationRail(
        modifier = Modifier.fillMaxHeight().width(104.dp).safeDrawingPadding(),
        containerColor = Color(0xFF0B0B19),
        header = { PlayarrMarkCompact() },
    ) {
        Spacer(Modifier.height(20.dp))
        mainDestinations.forEach { destination ->
            NavigationRailItem(
                selected = current == destination.route,
                onClick = { navController.openTopLevel(destination.route) },
                icon = { NavMark(destination.mark) },
                label = { Text(destination.label) },
            )
        }
    }
}

@Composable
private fun AppBottomNavigation(navController: NavHostController) {
    val entry by navController.currentBackStackEntryAsState()
    val current = entry?.destination?.route
    NavigationBar(modifier = Modifier.navigationBarsPadding(), containerColor = Color(0xFF0B0B19)) {
        mainDestinations.forEach { destination ->
            NavigationBarItem(
                selected = current == destination.route,
                onClick = { navController.openTopLevel(destination.route) },
                icon = { NavMark(destination.mark) },
                label = { Text(destination.label) },
            )
        }
    }
}

private fun NavHostController.openTopLevel(route: String) {
    navigate(route) {
        popUpTo("home") { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

@Composable
private fun NavMark(text: String) {
    Box(Modifier.size(28.dp).background(PlayarrViolet.copy(alpha = 0.22f), CircleShape), contentAlignment = Alignment.Center) {
        Text(text, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun PlayarrMarkCompact() {
    Icon(
        painter = painterResource(R.drawable.playarr_mark),
        contentDescription = "Playarr",
        tint = Color.Unspecified,
        modifier = Modifier.size(42.dp),
    )
}

@Composable
private fun AppNavHost(
    navController: NavHostController,
    serverUrl: String,
    isTelevision: Boolean,
    modifier: Modifier = Modifier,
) {
    NavHost(navController = navController, startDestination = "home", modifier = modifier) {
        composable("home") {
            HomeScreen(isTelevision = isTelevision, onWorkClick = { navController.navigate("detail/${it.id}") })
        }
        composable("library") {
            LibraryScreen(isTelevision = isTelevision, onWorkClick = { navController.navigate("detail/${it.id}") })
        }
        composable("detail/{workId}") { entry ->
            WorkDetailScreen(
                workId = entry.arguments?.getString("workId").orEmpty(),
                isTelevision = isTelevision,
                onBack = navController::popBackStack,
                onPlay = { navController.navigate("player/$it") },
            )
        }
        composable("player/{mediaFileId}") { entry ->
            PlayerScreen(
                mediaFileId = entry.arguments?.getString("mediaFileId").orEmpty(),
                onBack = navController::popBackStack,
            )
        }
        composable("settings") { SettingsScreen(serverUrl = serverUrl) }
    }
}

sealed interface CatalogState {
    data object Loading : CatalogState
    data class Content(val works: List<Work>) : CatalogState
    data class Failed(val message: String) : CatalogState
}

@HiltViewModel
class CatalogViewModel @Inject constructor(
    private val browseLibrary: BrowseLibraryUseCase,
) : ViewModel() {
    private val _state = MutableStateFlow<CatalogState>(CatalogState.Loading)
    val state: StateFlow<CatalogState> = _state.asStateFlow()

    init { reload() }

    fun reload() {
        viewModelScope.launch {
            _state.value = CatalogState.Loading
            _state.value = when (val result = browseLibrary(sort = "recent")) {
                is StreamarrResult.Success -> CatalogState.Content(result.value)
                is StreamarrResult.Failure -> CatalogState.Failed(result.error.userMessage("library"))
            }
        }
    }
}

@Composable
private fun HomeScreen(
    isTelevision: Boolean,
    onWorkClick: (Work) -> Unit,
    viewModel: CatalogViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 32.dp),
    ) {
        item {
            Column(Modifier.padding(horizontal = if (isTelevision) 48.dp else 20.dp, vertical = 28.dp)) {
                Text("PLAYARR", color = PlayarrViolet, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                Text("Home", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Black)
            }
        }
        when (val current = state) {
            CatalogState.Loading -> item { StatePanel { CircularProgressIndicator(color = PlayarrViolet) } }
            is CatalogState.Failed -> item { FailurePanel(current.message, viewModel::reload) }
            is CatalogState.Content -> {
                if (current.works.isEmpty()) {
                    item { StatePanel { Text("Your library is empty.") } }
                } else {
                    item { PosterShelf("Recently added", current.works.take(20), isTelevision, onWorkClick) }
                    WorkKind.entries.forEach { kind ->
                        val works = current.works.filter { it.kind == kind }
                        if (works.isNotEmpty()) item { PosterShelf(kind.sectionTitle(), works, isTelevision, onWorkClick) }
                    }
                }
            }
        }
    }
}

private fun WorkKind.sectionTitle(): String = when (this) {
    WorkKind.Movie -> "Movies"
    WorkKind.Series -> "TV"
    WorkKind.Site -> "Sites"
    WorkKind.Artist -> "Music"
    WorkKind.Author -> "Books"
}

@Composable
private fun PosterShelf(title: String, works: List<Work>, isTelevision: Boolean, onWorkClick: (Work) -> Unit) {
    Column(Modifier.padding(bottom = 28.dp)) {
        Text(
            title,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = if (isTelevision) 48.dp else 20.dp, vertical = 12.dp),
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = if (isTelevision) 48.dp else 20.dp),
            horizontalArrangement = Arrangement.spacedBy(if (isTelevision) 20.dp else 12.dp),
        ) {
            items(works, key = { it.id }) { work ->
                WorkPoster(work, isTelevision, onClick = { onWorkClick(work) })
            }
        }
    }
}

@Composable
private fun WorkPoster(work: Work, isTelevision: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.07f else 1f, label = "posterFocus")
    Column(modifier = modifier.width(if (isTelevision) 176.dp else 132.dp)) {
        PosterCard(
            title = work.title,
            imageUrl = work.images.firstOrNull { it.kind == ImageKind.Poster }?.url,
            onClick = onClick,
            modifier = Modifier.scale(scale).onFocusChanged { focused = it.isFocused },
        )
        Text(
            work.title,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

@Composable
private fun LibraryScreen(
    isTelevision: Boolean,
    onWorkClick: (Work) -> Unit,
    viewModel: CatalogViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    Column(modifier = Modifier.fillMaxSize()) {
        Text(
            "Library",
            style = MaterialTheme.typography.displaySmall,
            fontWeight = FontWeight.Black,
            modifier = Modifier.padding(horizontal = if (isTelevision) 48.dp else 20.dp, vertical = 28.dp),
        )
        when (val current = state) {
            CatalogState.Loading -> StatePanel { CircularProgressIndicator(color = PlayarrViolet) }
            is CatalogState.Failed -> FailurePanel(current.message, viewModel::reload)
            is CatalogState.Content -> LazyVerticalGrid(
                columns = GridCells.Adaptive(if (isTelevision) 176.dp else 132.dp),
                contentPadding = PaddingValues(horizontal = if (isTelevision) 48.dp else 20.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                items(current.works, key = { it.id }) { work ->
                    WorkPoster(work, isTelevision, onClick = { onWorkClick(work) }, modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }
}

@HiltViewModel
class WorkDetailViewModel @Inject constructor(
    private val getWorkDetails: GetWorkDetailsUseCase,
) : ViewModel() {
    private val _state = MutableStateFlow<DetailState>(DetailState.Loading)
    val state = _state.asStateFlow()

    fun load(id: String) {
        viewModelScope.launch {
            _state.value = DetailState.Loading
            _state.value = when (val result = getWorkDetails(id)) {
                is StreamarrResult.Success -> DetailState.Content(result.value)
                is StreamarrResult.Failure -> DetailState.Failed(result.error.userMessage("title"))
            }
        }
    }
}

sealed interface DetailState {
    data object Loading : DetailState
    data class Content(val detail: WorkDetail) : DetailState
    data class Failed(val message: String) : DetailState
}

@Composable
private fun WorkDetailScreen(
    workId: String,
    isTelevision: Boolean,
    onBack: () -> Unit,
    onPlay: (String) -> Unit,
    viewModel: WorkDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    LaunchedEffect(workId) { viewModel.load(workId) }
    when (val current = state) {
        DetailState.Loading -> LoadingScreen()
        is DetailState.Failed -> FailurePanel(current.message) { viewModel.load(workId) }
        is DetailState.Content -> DetailContent(current.detail, isTelevision, onBack, onPlay)
    }
}

@Composable
private fun DetailContent(detail: WorkDetail, isTelevision: Boolean, onBack: () -> Unit, onPlay: (String) -> Unit) {
    val side = if (isTelevision) 48.dp else 20.dp
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(side, 24.dp, side, 48.dp)) {
        item {
            OutlinedButton(onClick = onBack) { Text("Back") }
            Spacer(Modifier.height(24.dp))
            Text(detail.work.kind.sectionTitle().uppercase(), color = PlayarrViolet, fontWeight = FontWeight.Bold)
            Text(detail.work.title, style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Black)
            detail.work.overview?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 14.dp).fillMaxWidth(0.8f))
            }
            Spacer(Modifier.height(24.dp))
        }
        when (val children = detail.children) {
            WorkChildren.Movie -> detail.mediaFileId?.let { mediaFileId ->
                item { Button(onClick = { onPlay(mediaFileId) }) { Text("Play") } }
            }
            is WorkChildren.Series -> children.seasons.forEach { season ->
                item { Text("Season ${season.season.seasonNumber}", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(vertical = 14.dp)) }
                items(season.episodes, key = { it.episode.id }) { episode ->
                    PlayableRow(
                        title = episode.episode.title ?: "Episode ${episode.episode.episodeNumber}",
                        available = episode.mediaFileId != null,
                        onClick = { episode.mediaFileId?.let(onPlay) },
                    )
                }
            }
            is WorkChildren.Artist -> children.albums.forEach { album ->
                item { Text(album.album.title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(vertical = 14.dp)) }
                items(album.tracks, key = { it.track.id }) { track ->
                    PlayableRow(track.track.title, track.mediaFileId != null) { track.mediaFileId?.let(onPlay) }
                }
            }
            is WorkChildren.Author -> items(children.books, key = { it.book.id }) { book ->
                PlayableRow(book.book.title, book.mediaFileId != null) { book.mediaFileId?.let(onPlay) }
            }
        }
    }
}

@Composable
private fun PlayableRow(title: String, available: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        enabled = available,
        color = PlayarrPanel,
        contentColor = Color.White,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp),
    ) {
        Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(if (available) "Play" else "Unavailable", color = if (available) PlayarrViolet else Color.Gray)
        }
    }
}

sealed interface PlayerLoadState {
    data object Loading : PlayerLoadState
    data object Ready : PlayerLoadState
    data class Failed(val message: String) : PlayerLoadState
}

@HiltViewModel
class PlayerViewModel @Inject constructor(
    val player: StreamarrPlayer,
    private val getPlaybackInfo: GetPlaybackInfoUseCase,
) : ViewModel() {
    private val _loadState = MutableStateFlow<PlayerLoadState>(PlayerLoadState.Loading)
    val loadState = _loadState.asStateFlow()

    fun play(mediaFileId: String) {
        viewModelScope.launch {
            _loadState.value = PlayerLoadState.Loading
            when (val result = getPlaybackInfo(mediaFileId)) {
                is StreamarrResult.Success -> {
                    player.prepare(
                        result.value.url,
                        if (result.value.mode == PlaybackMode.Hls) StreamFormat.Hls else StreamFormat.Direct,
                    )
                    player.play()
                    _loadState.value = PlayerLoadState.Ready
                }
                is StreamarrResult.Failure -> _loadState.value = PlayerLoadState.Failed(result.error.userMessage("media"))
            }
        }
    }

    override fun onCleared() {
        player.pause()
    }
}

@Composable
private fun PlayerScreen(
    mediaFileId: String,
    onBack: () -> Unit,
    viewModel: PlayerViewModel = hiltViewModel(),
) {
    val state by viewModel.loadState.collectAsState()
    LaunchedEffect(mediaFileId) { viewModel.play(mediaFileId) }
    Box(modifier = Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        when (val current = state) {
            PlayerLoadState.Loading -> CircularProgressIndicator(color = PlayarrViolet)
            is PlayerLoadState.Failed -> FailurePanel(current.message) { viewModel.play(mediaFileId) }
            PlayerLoadState.Ready -> AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context -> PlayerView(context).apply { player = viewModel.player.rawPlayer; useController = true } },
            )
        }
        OutlinedButton(onClick = onBack, modifier = Modifier.align(Alignment.TopStart).safeDrawingPadding().padding(16.dp)) {
            Text("Back")
        }
    }
}

@HiltViewModel
class SettingsViewModel @Inject constructor(private val tokenStore: TokenStore) : ViewModel() {
    fun signOut() { viewModelScope.launch { tokenStore.clear() } }
}

@Composable
private fun SettingsScreen(serverUrl: String, viewModel: SettingsViewModel = hiltViewModel()) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(28.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Text("Settings", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Black)
        Surface(
            color = PlayarrPanel,
            contentColor = Color.White,
            shape = RoundedCornerShape(18.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(20.dp)) {
                Text("Connected server", style = MaterialTheme.typography.labelLarge, color = PlayarrViolet)
                Text(serverUrl, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 6.dp))
                Text("This address belongs to the signed-in account and can be changed from the sign-in screen.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
            }
        }
        Text("Playarr ${BuildConfig.VERSION_NAME}", color = MaterialTheme.colorScheme.onSurfaceVariant)
        HorizontalDivider()
        OutlinedButton(onClick = viewModel::signOut) { Text("Sign out") }
    }
}

@Composable
private fun StatePanel(content: @Composable () -> Unit) {
    Box(modifier = Modifier.fillMaxWidth().height(240.dp), contentAlignment = Alignment.Center) { content() }
}

@Composable
private fun FailurePanel(message: String, retry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(message, color = MaterialTheme.colorScheme.error)
        Button(onClick = retry) { Text("Try again") }
    }
}

private fun StreamarrError.userMessage(subject: String): String = when (this) {
    is StreamarrError.Network -> "Can’t reach the Streamarr server. Check the server address and network."
    is StreamarrError.Http -> when (code) {
        401 -> "Your session has expired. Sign in again."
        403 -> "This account cannot access that $subject."
        404 -> "That $subject could not be found."
        503 -> "The server cannot play that $subject right now."
        else -> "The server returned error $code."
    }
    is StreamarrError.Unknown -> "Something went wrong loading that $subject."
}
