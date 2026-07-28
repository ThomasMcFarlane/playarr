package io.streamarr.mobile.cast

import android.content.Context
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionProvider
import io.streamarr.mobile.BuildConfig

/**
 * Reflectively instantiated by the Cast framework via
 * `AndroidManifest.xml`'s `OPTIONS_PROVIDER_CLASS_NAME` meta-data --
 * requires a public, no-arg-constructor class exactly like this one (see
 * `proguard-rules.pro`'s matching `-keep` rule; a release build's
 * shrinker/obfuscator would otherwise strip or rename this class, and Cast
 * init would then fail only in release, silently, never in debug).
 *
 * [PLAYARR_CAST_NAMESPACE] must be declared here (as well as per-session,
 * see `PlayarrCastSession`) or the custom-namespace channel silently never
 * delivers a single message.
 */
class PlayarrCastOptionsProvider : OptionsProvider {
    override fun getCastOptions(context: Context): CastOptions =
        CastOptions.Builder()
            .setReceiverApplicationId(BuildConfig.CAST_RECEIVER_APP_ID)
            .setSupportedNamespaces(listOf(PLAYARR_CAST_NAMESPACE))
            .build()

    override fun getAdditionalSessionProviders(context: Context): List<SessionProvider>? = null
}
