package io.streamarr.tv

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

/** Hilt entry point for the TV app; every `@Inject`/`@AndroidEntryPoint` site roots here. */
@HiltAndroidApp
class StreamarrTvApp : Application()
