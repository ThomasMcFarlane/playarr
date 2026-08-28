package io.playarr.mobile.update

import android.app.Activity
import kotlinx.coroutines.CoroutineScope

internal fun createAndroidSelfUpdateController(
    activity: Activity,
    scope: CoroutineScope,
    onEvent: (AndroidUpdateEvent) -> Unit,
): AndroidSelfUpdateController = AndroidSelfUpdater(activity, scope, onEvent)
