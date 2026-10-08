/*
 * Root build script. Declares plugin versions once (via `apply false`) so
 * every module below applies them without re-resolving/re-declaring a
 * version, and centralises the couple of convention settings (Kotlin JVM
 * target, Java compatibility) that all modules need to agree on.
 */
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.hilt.android) apply false
    alias(libs.plugins.roborazzi) apply false
}

tasks.register("clean", Delete::class) {
    delete(rootProject.layout.buildDirectory)
}
