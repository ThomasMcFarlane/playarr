package io.streamarr.tv.ui.screens

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Bitmap
import android.view.KeyEvent
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
import android.widget.FrameLayout
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text as MaterialText
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.tv.material3.Button
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import io.streamarr.tv.BuildConfig
import io.streamarr.tv.R
import java.net.URI

/**
 * Normalises the operator-entered address without changing paths used by
 * reverse-proxy deployments. A missing scheme is treated as a home-LAN
 * HTTP address; everything else must be an absolute HTTP(S) URL.
 */
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

/**
 * Fullscreen Android-TV host for the co-hosted Playarr web client.
 *
 * Rendering the shipped web client is intentional: it gives Android TV
 * exactly the same React tree, CSS, routes, authentication, artwork,
 * playlists, profiles, playback controls, and future updates as Web,
 * while this native layer owns TV-launcher, lifecycle, update, remote,
 * fullscreen-video, and connection-bootstrap responsibilities.
 *
 * Pressing the remote Menu button opens the native server-address escape
 * hatch. It is also shown automatically when the initial page cannot load.
 */
@Composable
fun StreamarrWebAppScreen(
    modifier: Modifier = Modifier,
    openServerEditorRequest: Int = 0,
) {
    val context = LocalContext.current
    val activity = context as Activity
    val lifecycleOwner = LocalLifecycleOwner.current
    val baseUrl = BuildConfig.PLAYARR_BASE_URL
    val appUrl = remember(baseUrl) {
        "${baseUrl.trimEnd('/')}/?androidBuild=${BuildConfig.VERSION_CODE}"
    }
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

    LaunchedEffect(openServerEditorRequest) {
        if (openServerEditorRequest > 0) {
            addressDraft = baseUrl
            addressError = null
            showServerEditor = true
        }
    }

    fun closeFullscreen(notifyWebView: Boolean) {
        val callback = fullscreenCallback
        fullscreenView?.let { view ->
            (view.parent as? ViewGroup)?.removeView(view)
        }
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

    Box(modifier = modifier.fillMaxSize().background(Color(0xFF151315))) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { webContext ->
                createPlayarrWebView(
                    context = webContext,
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
                    onShowFullscreen = { view, callback ->
                        if (fullscreenView != null) {
                            closeFullscreen(notifyWebView = true)
                        }
                        fullscreenView = view
                        fullscreenCallback = callback
                    },
                    onHideFullscreen = {
                        closeFullscreen(notifyWebView = false)
                    },
                )
            },
            update = { view ->
                val request = WebLoadRequest(appUrl, reloadGeneration)
                if (view.tag != request) {
                    view.tag = request
                    // Version the document URL without changing its origin.
                    // This preserves cookies/localStorage while bypassing a
                    // stale service-worker-cached app shell after APK updates.
                    view.loadUrl(appUrl)
                }
            },
        )

        if (loading && !showServerEditor) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
        }

        fullscreenView?.let { customView ->
            FullscreenWebVideo(
                view = customView,
                modifier = Modifier.fillMaxSize(),
            )
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
                            if (normalised == baseUrl) {
                                loadError = null
                                loading = true
                                showServerEditor = false
                                reloadGeneration += 1
                            } else {
                                addressError =
                                    "This test build is temporarily fixed to $baseUrl."
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
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
}

@SuppressLint("SetJavaScriptEnabled")
private fun createPlayarrWebView(
    context: android.content.Context,
    onWebViewReady: (WebView) -> Unit,
    onLoadingChanged: (Boolean) -> Unit,
    onLoadError: (String) -> Unit,
    onOpenServerEditor: () -> Unit,
    onShowFullscreen: (View, WebChromeClient.CustomViewCallback) -> Unit,
    onHideFullscreen: () -> Unit,
): WebView = WebView(context).apply {
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    setBackgroundColor(android.graphics.Color.rgb(21, 19, 21))
    isFocusable = true
    isFocusableInTouchMode = true
    keepScreenOn = true

    settings.apply {
        javaScriptEnabled = true
        domStorageEnabled = true
        mediaPlaybackRequiresUserGesture = false
        mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        useWideViewPort = true
        loadWithOverviewMode = true
        setSupportZoom(false)
        builtInZoomControls = false
        displayZoomControls = false
        setSupportMultipleWindows(false)
        userAgentString = "$userAgentString PlayarrAndroidTV/${BuildConfig.VERSION_NAME}"
    }
    setInitialScale(TV_INITIAL_SCALE_PERCENT)

    val playarrWebView = this
    CookieManager.getInstance().apply {
        setAcceptCookie(true)
        setAcceptThirdPartyCookies(playarrWebView, false)
    }

    webViewClient = object : WebViewClient() {
        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            onLoadingChanged(true)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            onLoadingChanged(false)
            view.syncTvViewport()
            view.requestFocus()
            CookieManager.getInstance().flush()
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

        override fun onShowCustomView(
            view: View,
            callback: CustomViewCallback,
        ) {
            onShowFullscreen(view, callback)
        }

        override fun onHideCustomView() {
            onHideFullscreen()
        }
    }

    setOnKeyListener { _, keyCode, event ->
        if (keyCode != KeyEvent.KEYCODE_MENU) return@setOnKeyListener false

        // WebView consumes some remote keys on ACTION_DOWN. Intercept both
        // halves of the Menu press and open the editor on the first one so
        // the escape hatch works even while a page is still loading.
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            onOpenServerEditor()
        }
        true
    }

    addOnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
        (view as WebView).syncTvViewport()
    }

    onWebViewReady(this)
    requestFocus()
}

private fun WebView.syncTvViewport() {
    if (width <= 0 || height <= 0) return
    evaluateJavascript(
        """
        (() => {
          let viewport = document.querySelector('meta[name="viewport"]');
          if (!viewport) {
            viewport = document.createElement("meta");
            viewport.name = "viewport";
            document.head.appendChild(viewport);
          }
          viewport.content =
            "width=$TV_LAYOUT_WIDTH_CSS_PX, height=$TV_LAYOUT_HEIGHT_CSS_PX, " +
            "initial-scale=$TV_LAYOUT_SCALE, minimum-scale=$TV_LAYOUT_SCALE, " +
            "maximum-scale=$TV_LAYOUT_SCALE, user-scalable=no";
          document.documentElement.style.setProperty(
            "--viewport-height",
            "${TV_LAYOUT_HEIGHT_CSS_PX}px"
          );
          document.documentElement.style.setProperty(
            "--viewport-half-height",
            "${TV_LAYOUT_HEIGHT_CSS_PX / 2}px"
          );
        })();
        """.trimIndent(),
        null,
    )
}

/**
 * Gives Playarr first refusal on Android's Back action. The player route
 * clears its persisted/minimised playback session when handling Escape;
 * calling WebView.goBack() directly only changed the URL and left that
 * session playing over the previous page.
 */
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
    ) { result ->
        onResult(result == "true")
    }
}

private const val TV_LAYOUT_WIDTH_CSS_PX = 1920
private const val TV_LAYOUT_HEIGHT_CSS_PX = 1080
private const val TV_LAYOUT_SCALE = 0.5f
private const val TV_INITIAL_SCALE_PERCENT = 50

private data class WebLoadRequest(
    val baseUrl: String,
    val generation: Int,
)

@Composable
private fun FullscreenWebVideo(
    view: View,
    modifier: Modifier = Modifier,
) {
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
        modifier = Modifier.fillMaxSize().background(Color(0xF2151315)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 680.dp)
                .fillMaxWidth()
                .padding(48.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Text(
                text = "Connect to Playarr",
                style = MaterialTheme.typography.headlineLarge,
            )
            Text(
                text = "Enter the address that serves the Streamarr API and Playarr web app. Press the remote Menu button here at any time.",
                style = MaterialTheme.typography.bodyLarge,
            )
            OutlinedTextField(
                value = address,
                onValueChange = onAddressChanged,
                label = { MaterialText("Server address") },
                placeholder = { MaterialText("http://192.168.1.23:8080") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            error?.let {
                Text(
                    text = it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            androidx.compose.foundation.layout.Row(
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Button(onClick = onConnect) {
                    Text("Connect")
                }
                onCancel?.let { cancel ->
                    Button(onClick = cancel) {
                        Text("Cancel")
                    }
                }
            }
            Text(
                text = contextVersionLabel(),
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun contextVersionLabel(): String =
    androidx.compose.ui.res.stringResource(R.string.settings_version, BuildConfig.VERSION_NAME)
