package io.streamarr.mobile.ui.web

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.ValueCallback
import android.widget.FrameLayout
import androidx.annotation.Keep
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.mobile.BuildConfig
import io.streamarr.shared.auth.TokenStore
import io.streamarr.shared.auth.model.TokenResponse
import io.streamarr.shared.data.config.ServerConfigStore
import java.net.URI
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Thin Android host for the same responsive React application used by
 * Playarr Web and Android TV. Android owns lifecycle and recovery UI; the
 * shared web bundle owns every visible media, profile, settings, and player
 * surface so phone and television layouts cannot drift into separate apps.
 */
@Composable
fun MobileWebAppScreen(
    modifier: Modifier = Modifier,
    viewModel: MobileWebAppViewModel = hiltViewModel(),
) {
    val activity = checkNotNull(LocalActivity.current) {
        "MobileWebAppScreen must be hosted by an Activity."
    }
    val lifecycleOwner = LocalLifecycleOwner.current
    val baseUrl by viewModel.baseUrl.collectAsStateWithLifecycle()
    val appUrl = remember(baseUrl) { mobileAppUrl(baseUrl, BuildConfig.VERSION_CODE) }
    var addressDraft by remember(baseUrl) { mutableStateOf(baseUrl) }
    var addressError by remember { mutableStateOf<String?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var showServerEditor by remember { mutableStateOf(false) }
    var reloadGeneration by remember { mutableIntStateOf(0) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    var fullscreenView by remember { mutableStateOf<View?>(null) }
    var fullscreenCallback by remember {
        mutableStateOf<WebChromeClient.CustomViewCallback?>(null)
    }
    var fileChooserCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    val fileChooserLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        fileChooserCallback?.onReceiveValue(uri?.let { selected -> arrayOf(selected) })
        fileChooserCallback = null
    }

    LaunchedEffect(baseUrl) {
        addressDraft = baseUrl
        addressError = null
        loadError = null
        loading = true
        showServerEditor = false
    }

    fun closeFullscreen(notifyWebView: Boolean) {
        val callback = fullscreenCallback
        fullscreenView?.let { view -> (view.parent as? ViewGroup)?.removeView(view) }
        fullscreenCallback = null
        fullscreenView = null
        if (notifyWebView) callback?.onCustomViewHidden()
    }

    BackHandler {
        when {
            fullscreenView != null -> closeFullscreen(notifyWebView = true)
            showServerEditor -> {
                addressDraft = baseUrl
                addressError = null
                showServerEditor = false
            }
            else -> {
                val activeWebView = webView
                if (activeWebView == null) {
                    activity.finish()
                } else {
                    activeWebView.dispatchBackToWebApp { handled ->
                        if (!handled) {
                            if (activeWebView.canGoBack()) activeWebView.goBack()
                            else activity.finish()
                        }
                    }
                }
            }
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF151315)),
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize().safeDrawingPadding(),
            factory = { context ->
                createPlayarrMobileWebView(
                    context = context,
                    onWebViewReady = { webView = it },
                    onLoadingChanged = { loading = it },
                    onLoadError = { message ->
                        loadError = message
                        showServerEditor = true
                    },
                    onOpenServerEditor = {
                        addressDraft = baseUrl
                        addressError = null
                        showServerEditor = true
                    },
                    onSessionChanged = viewModel::syncWebSession,
                    onChooseFile = { callback ->
                        fileChooserCallback?.onReceiveValue(null)
                        fileChooserCallback = callback
                        fileChooserLauncher.launch("image/*")
                    },
                    onShowFullscreen = { view, callback ->
                        if (fullscreenView != null) closeFullscreen(notifyWebView = true)
                        fullscreenView = view
                        fullscreenCallback = callback
                    },
                    onHideFullscreen = { closeFullscreen(notifyWebView = false) },
                )
            },
            update = { view ->
                val request = MobileWebLoadRequest(appUrl, reloadGeneration)
                if (view.tag != request) {
                    view.tag = request
                    view.loadUrl(appUrl)
                }
            },
        )

        if (loading && !showServerEditor) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
        }

        fullscreenView?.let { customView ->
            FullscreenWebVideo(view = customView, modifier = Modifier.fillMaxSize())
        }

        if (showServerEditor) {
            ServerAddressEditor(
                address = addressDraft,
                error = addressError ?: loadError,
                onAddressChanged = {
                    addressDraft = it
                    addressError = null
                },
                onConnect = {
                    runCatching { normaliseServerUrl(addressDraft) }
                        .onSuccess { normalised ->
                            loadError = null
                            loading = true
                            showServerEditor = false
                            if (normalised == baseUrl) {
                                reloadGeneration += 1
                            } else {
                                viewModel.saveBaseUrl(normalised)
                            }
                        }
                        .onFailure {
                            addressError = it.message ?: "Enter a valid server address."
                        }
                },
                onCancel = if (loadError == null) {
                    {
                        addressDraft = baseUrl
                        addressError = null
                        showServerEditor = false
                    }
                } else {
                    null
                },
            )
        }
    }

    DisposableEffect(lifecycleOwner, webView) {
        val activeWebView = webView
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> activeWebView?.onResume()
                Lifecycle.Event.ON_PAUSE -> {
                    CookieManager.getInstance().flush()
                    activeWebView?.onPause()
                }
                Lifecycle.Event.ON_STOP -> CookieManager.getInstance().flush()
                Lifecycle.Event.ON_DESTROY -> {
                    CookieManager.getInstance().flush()
                    activeWebView?.stopLoading()
                    activeWebView?.destroy()
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            fileChooserCallback?.onReceiveValue(null)
            fileChooserCallback = null
        }
    }
}

@HiltViewModel
class MobileWebAppViewModel @Inject constructor(
    private val serverConfigStore: ServerConfigStore,
    private val tokenStore: TokenStore,
) : ViewModel() {
    val baseUrl = serverConfigStore.baseUrl.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = ServerConfigStore.DEFAULT_BASE_URL,
    )

    fun saveBaseUrl(url: String) {
        viewModelScope.launch { serverConfigStore.setBaseUrl(url) }
    }

    fun syncWebSession(serialisedSession: String) {
        viewModelScope.launch {
            if (serialisedSession.isBlank()) {
                tokenStore.clear()
                return@launch
            }

            runCatching {
                val session = JSONObject(serialisedSession)
                val expiresAt = session.getLong("expiresAt")
                TokenResponse(
                    accessToken = session.getString("accessToken"),
                    refreshToken = session.getString("refreshToken"),
                    tokenType = session.getString("tokenType"),
                    expiresIn = ((expiresAt - System.currentTimeMillis()) / 1_000).coerceAtLeast(0),
                )
            }.onSuccess { tokenStore.save(it) }
        }
    }
}

internal fun normaliseServerUrl(value: String): String {
    val trimmed = value.trim()
    require(trimmed.isNotEmpty()) { "Enter the address of your Streamarr server." }
    val candidate = if ("://" in trimmed) trimmed else "http://$trimmed"
    val parsed = URI(candidate)
    require(parsed.scheme == "http" || parsed.scheme == "https") {
        "The server address must start with http:// or https://."
    }
    require(!parsed.host.isNullOrBlank()) { "Enter a valid server address." }
    return candidate.trimEnd('/')
}

internal fun mobileAppUrl(baseUrl: String, versionCode: Int): String =
    "${baseUrl.trimEnd('/')}/?androidBuild=$versionCode"

@SuppressLint("SetJavaScriptEnabled")
private fun createPlayarrMobileWebView(
    context: android.content.Context,
    onWebViewReady: (WebView) -> Unit,
    onLoadingChanged: (Boolean) -> Unit,
    onLoadError: (String) -> Unit,
    onOpenServerEditor: () -> Unit,
    onSessionChanged: (String) -> Unit,
    onChooseFile: (ValueCallback<Array<Uri>>) -> Unit,
    onShowFullscreen: (View, WebChromeClient.CustomViewCallback) -> Unit,
    onHideFullscreen: () -> Unit,
): WebView = WebView(context).apply {
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    setBackgroundColor(android.graphics.Color.rgb(21, 19, 21))
    isFocusable = true
    isFocusableInTouchMode = true

    settings.apply {
        javaScriptEnabled = true
        domStorageEnabled = true
        mediaPlaybackRequiresUserGesture = false
        mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        useWideViewPort = true
        loadWithOverviewMode = false
        setSupportZoom(false)
        builtInZoomControls = false
        displayZoomControls = false
        setSupportMultipleWindows(false)
        allowFileAccess = false
        allowContentAccess = false
        safeBrowsingEnabled = true
        userAgentString = "$userAgentString PlayarrAndroidMobile/${BuildConfig.VERSION_NAME}"
    }

    val playarrWebView = this
    CookieManager.getInstance().apply {
        setAcceptCookie(true)
        setAcceptThirdPartyCookies(playarrWebView, false)
    }
    addJavascriptInterface(
        PlayarrAndroidMobileBridge(
            onOpenServerEditor = { playarrWebView.post(onOpenServerEditor) },
            onSessionChanged = onSessionChanged,
        ),
        "PlayarrAndroidMobile",
    )

    webViewClient = object : WebViewClient() {
        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            onLoadingChanged(true)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            onLoadingChanged(false)
            view.syncStoredWebSession()
            CookieManager.getInstance().flush()
        }

        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest,
        ): Boolean {
            if (!request.isForMainFrame) return false
            val configuredUrl = (view.tag as? MobileWebLoadRequest)?.appUrl ?: return false
            if (sameOrigin(request.url, configuredUrl.toUri())) return false

            runCatching {
                context.startActivity(Intent(Intent.ACTION_VIEW, request.url))
            }
            return true
        }

        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError,
        ) {
            if (request.isForMainFrame) {
                onLoadingChanged(false)
                onLoadError("Could not load Playarr: ${error.description}")
            }
        }

        override fun onReceivedHttpError(
            view: WebView,
            request: WebResourceRequest,
            errorResponse: WebResourceResponse,
        ) {
            if (request.isForMainFrame && errorResponse.statusCode >= 400) {
                onLoadingChanged(false)
                onLoadError(
                    "The server returned ${errorResponse.statusCode} instead of the Playarr app.",
                )
            }
        }
    }

    webChromeClient = object : WebChromeClient() {
        override fun onProgressChanged(view: WebView?, newProgress: Int) {
            onLoadingChanged(newProgress < 100)
        }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            onShowFullscreen(view, callback)
        }

        override fun onHideCustomView() {
            onHideFullscreen()
        }

        override fun onShowFileChooser(
            webView: WebView?,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams?,
        ): Boolean {
            onChooseFile(filePathCallback)
            return true
        }
    }

    onWebViewReady(this)
}

@Keep
private class PlayarrAndroidMobileBridge(
    private val onOpenServerEditor: () -> Unit,
    private val onSessionChanged: (String) -> Unit,
) {
    @android.webkit.JavascriptInterface
    fun openServerEditor() = onOpenServerEditor()

    @android.webkit.JavascriptInterface
    fun syncSession(serialisedSession: String) = onSessionChanged(serialisedSession)
}

private fun WebView.syncStoredWebSession() {
    evaluateJavascript(
        """
        (() => {
          try {
            window.PlayarrAndroidMobile?.syncSession(
              window.localStorage.getItem("streamarr:session") || ""
            );
          } catch (_) {
            window.PlayarrAndroidMobile?.syncSession("");
          }
        })();
        """.trimIndent(),
        null,
    )
}

private fun WebView.dispatchBackToWebApp(onResult: (Boolean) -> Unit) {
    evaluateJavascript(
        """
        (() => {
          const appEvent = new Event("playarr:back", { cancelable: true });
          window.dispatchEvent(appEvent);
          if (appEvent.defaultPrevented) return true;

          const event = new KeyboardEvent("keydown", {
            key: "Escape",
            code: "Escape",
            keyCode: 27,
            which: 27,
            bubbles: true,
            cancelable: true
          });
          window.dispatchEvent(event);
          return event.defaultPrevented;
        })();
        """.trimIndent(),
    ) { result -> onResult(result == "true") }
}

private fun sameOrigin(left: Uri, right: Uri): Boolean =
    left.scheme.equals(right.scheme, ignoreCase = true) &&
        left.host.equals(right.host, ignoreCase = true) &&
        effectivePort(left) == effectivePort(right)

private fun effectivePort(uri: Uri): Int = when {
    uri.port != -1 -> uri.port
    uri.scheme.equals("https", ignoreCase = true) -> 443
    else -> 80
}

private data class MobileWebLoadRequest(
    val appUrl: String,
    val generation: Int,
)

@Composable
private fun FullscreenWebVideo(view: View, modifier: Modifier = Modifier) {
    AndroidView(
        modifier = modifier.background(Color.Black),
        factory = { context ->
            (view.parent as? ViewGroup)?.removeView(view)
            FrameLayout(context).apply {
                setBackgroundColor(android.graphics.Color.BLACK)
                addView(
                    view,
                    FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    ),
                )
            }
        },
    )
}

@Composable
private fun ServerAddressEditor(
    address: String,
    error: String?,
    onAddressChanged: (String) -> Unit,
    onConnect: () -> Unit,
    onCancel: (() -> Unit)?,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xF2151315))
            .safeDrawingPadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 560.dp)
                .fillMaxWidth()
                .background(
                    color = MaterialTheme.colorScheme.surface,
                    shape = RoundedCornerShape(24.dp),
                )
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "Connect to Playarr",
                style = MaterialTheme.typography.headlineMedium,
            )
            Text(
                text = "Enter the address that serves the Streamarr API and Playarr web app.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
            )
            OutlinedTextField(
                value = address,
                onValueChange = onAddressChanged,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Server address") },
                singleLine = true,
                isError = error != null,
                supportingText = error?.let { message -> { Text(message) } },
            )
            Button(onClick = onConnect, modifier = Modifier.fillMaxWidth()) {
                Text("Connect")
            }
            onCancel?.let { cancel ->
                Button(onClick = cancel, modifier = Modifier.fillMaxWidth()) {
                    Text("Cancel")
                }
            }
        }
    }
}
