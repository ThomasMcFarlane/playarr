package io.streamarr.mobile

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

/** Hilt entry point for the mobile app; every `@Inject`/`@AndroidEntryPoint` site roots here. */
@HiltAndroidApp
class StreamarrMobileApp : Application()
