package io.playarr.mobile.di

import android.content.Context
import android.os.Looper
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.playarr.mobile.isTelevision
import javax.inject.Singleton

/**
 * Provides a NULLABLE [CastContext]: null on television (casting FROM the
 * device being cast TO makes no sense), wherever Google Play services is
 * unavailable, or wherever `CastContext.getSharedInstance` throws (most
 * commonly a `ModuleUnavailableException` when the Cast dynamic module
 * can't load) -- every caller downstream (`PlayarrCastSession`,
 * `PlayarrCastAvailability`) treats a null [CastContext] as "no cast on
 * this device" rather than a crash.
 *
 * Every [CastContext] method is main-thread-only and throws off it, so
 * this bails out to `null` rather than calling `getSharedInstance` unless
 * it can confirm it is already on the main thread -- in practice this
 * binding is always first resolved from a `hiltViewModel()` call inside
 * Compose composition, which is itself always main-thread, but the check
 * costs nothing and removes any doubt.
 */
@Module
@InstallIn(SingletonComponent::class)
object CastModule {

    @Provides
    @Singleton
    fun provideCastContext(@ApplicationContext context: Context): CastContext? {
        if (Looper.myLooper() != Looper.getMainLooper()) return null
        if (isTelevision(context)) return null
        val playServicesAvailable = GoogleApiAvailability.getInstance()
            .isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
        if (!playServicesAvailable) return null
        return try {
            CastContext.getSharedInstance(context)
        } catch (_: Exception) {
            // Most commonly com.google.android.gms.dynamite.DynamiteModule's
            // ModuleUnavailableException when the Cast dynamic module isn't
            // installed/available -- always "no cast here", never a crash.
            null
        }
    }
}
