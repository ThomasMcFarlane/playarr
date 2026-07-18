/*
 * Root Gradle settings for the Streamarr / Playarr Android client tree.
 *
 * Layout note: this file lives in `clients/android-shared/` rather than at
 * the repo root or at `clients/` because this task's write scope is limited
 * to `clients/mobile-android/` and `clients/android-shared/`. It produces one Gradle build that
 * includes the single responsive Playarr Android application as a sibling
 * project via an explicit `projectDir` override below.
 *
 * To build everything:
 *   cd clients/android-shared && ./gradlew build
 *
 * To build just one app:
 *   cd clients/android-shared && ./gradlew :mobile-android:assembleDebug
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
