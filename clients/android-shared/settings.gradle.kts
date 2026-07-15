/*
 * Root Gradle settings for the Streamarr / Playarr Android client tree.
 *
 * Layout note: this file lives in `clients/android-shared/` rather than at
 * the repo root or at `clients/` because this task's write scope is limited
 * to `clients/mobile-android/`, `clients/tv-android/`, and
 * `clients/android-shared/` (see the READMEs in the sibling app modules for
 * the full rationale). It still produces exactly one Gradle build that
 * includes every Android module — `mobile-android` and `tv-android` are
 * pulled in as sibling projects via an explicit `projectDir` override below,
 * the same mechanism composite-friendly monorepos use when a module's
 * source directory doesn't nest under the settings file that declares it.
 *
 * To build everything:
 *   cd clients/android-shared && ./gradlew build
 *
 * To build just one app:
 *   cd clients/android-shared && ./gradlew :mobile-android:assembleDebug
 *   cd clients/android-shared && ./gradlew :tv-android:assembleDebug
 */

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "streamarr-android"

// --- android-shared: core Kotlin/Android library modules ---------------
// These nest naturally under this settings file's own directory.
include(":core-data")
include(":core-domain")
include(":core-designsystem")
include(":core-player")
include(":core-auth")
include(":core-update")

// --- App modules: siblings of android-shared, included by relative path -
include(":mobile-android")
project(":mobile-android").projectDir = file("../mobile-android")

include(":tv-android")
project(":tv-android").projectDir = file("../tv-android")
