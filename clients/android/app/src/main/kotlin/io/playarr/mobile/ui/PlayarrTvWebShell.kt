package io.playarr.mobile.ui

import android.annotation.SuppressLint
import android.graphics.Color as AndroidColor
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import io.playarr.mobile.BuildConfig

/**
 * Television presentation shell that hosts the Playarr Web TV surface at a
 * fixed 1920×1080 stage so Android TV can share Chromium layout, tokens,
 * focus motion, and artwork decode with `playarr.example.com`.
 *
 * The native Compose phone/tablet paths are unchanged. Auth is injected from
 * the already-redeemed device session into the web profile store so the SPA
 * boots signed-in against the same server URL the native shell would use.
 */
@Composable
fun PlayarrTvWebShell(
    serverUrl: String,
    accessToken: String,
    refreshToken: String,
    userId: String,
    userName: String,
    webOrigin: String = BuildConfig.TV_WEB_ORIGIN,
    darkTheme: Boolean = true,
    modifier: Modifier = Modifier,
) {
    val apiBase = serverUrl.trimEnd('/')
    val bootstrap = remember(apiBase, accessToken, refreshToken, userId, userName, darkTheme) {
        buildTvWebBootstrapScript(
            apiBaseUrl = apiBase,
            accessToken = accessToken,
            refreshToken = refreshToken,
            userId = userId,
            userName = userName,
            darkTheme = darkTheme,
        )
    }
    val entryUrl = remember(webOrigin, apiBase) {
        val origin = webOrigin.trimEnd('/')
        "$origin/?apiBaseUrl=${android.net.Uri.encode(apiBase)}"
    }
    val safeName = remember(userName) { userName.replace("\\", "\\\\").replace("'", "\\'") }

    DisposableEffect(Unit) {
        WebView.setWebContentsDebuggingEnabled(true)
        onDispose { }
    }

    AndroidView(
        modifier = modifier.fillMaxSize(),
        factory = { ctx ->
            @SuppressLint("SetJavaScriptEnabled")
            WebView(ctx).apply {
                setBackgroundColor(AndroidColor.BLACK)
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false
                settings.cacheMode = WebSettings.LOAD_DEFAULT
                settings.useWideViewPort = true
                settings.loadWithOverviewMode = false
                settings.builtInZoomControls = false
                settings.displayZoomControls = false
                settings.setSupportZoom(false)
                // Force 1 CSS-px = 1 physical-px on the TV 1920×1080 stage
                // (matches MainActivity's density-160 television context).
                setInitialScale(100)
                // SPA is served over HTTPS while operator servers are often
                // plain HTTP on the LAN; allow mixed content so catalogue
                // fetches to the injected apiBaseUrl succeed.
                settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                CookieManager.getInstance().setAcceptCookie(true)
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                webChromeClient = WebChromeClient()
                webViewClient = object : WebViewClient() {
                    override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                        // Inject as early as possible so the SPA session store is
                        // populated before React hydrates profile state.
                        view.evaluateJavascript(bootstrap, null)
                        view.evaluateJavascript(TV_VIEWPORT_SCRIPT, null)
                        view.evaluateJavascript(TV_LAYOUT_PARITY_SCRIPT, null)
                    }

                    override fun onPageFinished(view: WebView, url: String) {
                        view.evaluateJavascript(bootstrap, null)
                        view.evaluateJavascript(TV_VIEWPORT_SCRIPT, null)
                        view.evaluateJavascript(TV_LAYOUT_PARITY_SCRIPT, null)
                        // Auto-select the injected profile when the SPA lands on
                        // the "Who's watching?" gate.
                        view.evaluateJavascript(
                            """
                            (function(){
                              const btn=[...document.querySelectorAll('button.profile-avatar-button')]
                                .find(b => /$safeName/i.test(b.getAttribute('aria-label')||b.textContent||''));
                              if (btn) { btn.focus(); btn.click(); }
                            })();
                            """.trimIndent(),
                            null,
                        )
                    }
                }
                loadUrl(entryUrl)
            }
        },
        update = { webView ->
            // Re-inject when session inputs change; navigation stays put.
            webView.evaluateJavascript(bootstrap, null)
        },
    )
}

/**
 * Lock the SPA to the 1920×1080 TV canvas with a device-pixel-ratio of 1 so
 * Chromium paints the same stage geometry as the desktop web reference.
 */
private const val TV_VIEWPORT_SCRIPT = """
(function() {
  var meta = document.querySelector('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'viewport';
    document.head.appendChild(meta);
  }
  meta.content = 'width=1920, height=1080, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no';
  document.documentElement.style.width = '1920px';
  document.documentElement.style.height = '1080px';
  document.documentElement.style.overflow = 'hidden';
  if (document.body) {
    document.body.style.width = '1920px';
    document.body.style.height = '1080px';
    document.body.style.overflow = 'hidden';
    document.body.style.margin = '0';
  }
})();
"""

/**
 * Neutralise layout deltas between Android WebView and desktop Chromium that
 * pure SPA freezes expose: scrollbar-gutter:stable reserves ~15px on desktop
 * only (settings option width 465 vs 480), and hide platform scrollbars on
 * TV so content width matches the live web-ref freeze stage.
 */
private const val TV_LAYOUT_PARITY_SCRIPT = """
(function() {
  var id = 'playarr-tv-layout-parity';
  if (document.getElementById(id)) return;
  var style = document.createElement('style');
  style.id = id;
  style.textContent = [
    '*, *::before, *::after { scrollbar-gutter: auto !important; scrollbar-width: none !important; }',
    '*::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }',
    '.settings-options-panel, .settings-detail-scroll, .settings-options-list {',
    '  scrollbar-gutter: auto !important;',
    '}',
  ].join('\\n');
  (document.head || document.documentElement).appendChild(style);
})();
"""

/** Escape a string as a JSON string literal (double-quoted). */
internal fun jsonStringLiteral(value: String): String = buildString {
    append('"')
    value.forEach { ch ->
        when (ch) {
            '\\' -> append("\\\\")
            '"' -> append("\\\"")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            else -> if (ch.code < 0x20) append("\\u%04x".format(ch.code)) else append(ch)
        }
    }
    append('"')
}

internal fun buildTvWebBootstrapScript(
    apiBaseUrl: String,
    accessToken: String,
    refreshToken: String,
    userId: String,
    userName: String,
    darkTheme: Boolean,
    expiresAtMs: Long = System.currentTimeMillis() + 86_400_000L * 10,
): String {
    val displayName = userName.ifBlank { "Viewer" }
    val theme = if (darkTheme) "dark" else "light"
    val sessionJson = buildString {
        append('{')
        append("\"accessToken\":").append(jsonStringLiteral(accessToken)).append(',')
        append("\"refreshToken\":").append(jsonStringLiteral(refreshToken)).append(',')
        append("\"tokenType\":\"Bearer\",")
        append("\"expiresAt\":").append(expiresAtMs)
        append('}')
    }
    val profilesJson = buildString {
        append("[{")
        append("\"profileKey\":").append(jsonStringLiteral("android-tv:$userId")).append(',')
        append("\"apiBaseUrl\":").append(jsonStringLiteral(apiBaseUrl)).append(',')
        append("\"userId\":").append(jsonStringLiteral(userId)).append(',')
        append("\"name\":").append(jsonStringLiteral(displayName)).append(',')
        append("\"deviceId\":\"android-tv-device\",")
        append("\"session\":").append(sessionJson)
        append("}]")
    }
    // language=JavaScript
    return """
        (function() {
          try {
            // TokenStore key is `playarr:session` (device-auth package).
            localStorage.setItem('playarr:session', ${jsonStringLiteral(sessionJson)});
            localStorage.setItem('streamarr:session', ${jsonStringLiteral(sessionJson)});
            localStorage.setItem('playarr.profileSessions.v4', ${jsonStringLiteral(profilesJson)});
            localStorage.setItem('playarr.currentUserName', ${jsonStringLiteral(displayName)});
            localStorage.setItem('playarr-theme', ${jsonStringLiteral(theme)});
            document.documentElement.dataset.theme = ${jsonStringLiteral(theme)};
            document.documentElement.style.colorScheme = ${jsonStringLiteral(theme)};
          } catch (e) {}
        })();
    """.trimIndent()
}
