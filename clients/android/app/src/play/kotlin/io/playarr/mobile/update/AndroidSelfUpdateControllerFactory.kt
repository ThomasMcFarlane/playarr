package io.playarr.mobile.update

import android.app.Activity
import kotlinx.coroutines.CoroutineScope

@Suppress("UNUSED_PARAMETER")
internal fun createAndroidSelfUpdateController(
    activity: Activity,
    scope: CoroutineScope,
    onEvent: (AndroidUpdateEvent) -> Unit,
): AndroidSelfUpdateController? = null
