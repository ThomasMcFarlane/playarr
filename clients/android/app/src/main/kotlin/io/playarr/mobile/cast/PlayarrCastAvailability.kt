package io.playarr.mobile.cast

/**
 * Pure predicate for whether the cast entry point (button, options
 * provider wiring, everything in this package) should be offered at all --
 * follows this project's existing testable-predicate style (see
 * `io.playarr.mobile.isTelevision`'s primitive-typed overload): every
 * real Android/Play-services/BuildConfig input is resolved once at the
 * call site and passed in as a plain [Boolean], so this stays unit
 * testable with no Android runtime and no mocking framework.
 *
 * - [isTelevision]: casting FROM a television TO another device makes no
 *   sense for this pass -- Cast Connect/Android TV receiver support is
 *   explicitly out of scope (see this build's task notes).
 * - [playServicesAvailable]: whether `di/CastModule.kt`'s `CastContext?`
 *   resolved non-null (television, missing Play services, or a
 *   `ModuleUnavailableException` all collapse to `false` there).
 * - [receiverAppIdConfigured]: `BuildConfig.CAST_RECEIVER_APP_ID` is
 *   non-blank -- an unconfigured build has nowhere to cast to.
 * - A plain `http://` Playarr Server is never a reason to hide the button: Playarr never
 *   blocks a user's http server. If the Chromecast cannot reach it the receiver reports
 *   `insecure_server` with the one-step remedy, which the sender surfaces.
 */
fun shouldOfferPlayarrCast(
    isTelevision: Boolean,
    playServicesAvailable: Boolean,
    receiverAppIdConfigured: Boolean,
): Boolean = !isTelevision && playServicesAvailable && receiverAppIdConfigured
