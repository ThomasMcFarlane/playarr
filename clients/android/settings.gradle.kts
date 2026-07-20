/* Root Gradle settings for the single Playarr Android project. */

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

rootProject.name = "playarr-android"

include(":app")
include(":core-data")
include(":core-domain")
include(":core-designsystem")
include(":core-player")
include(":core-auth")
include(":core-update")
include(":core-download")
