plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "io.streamarr.shared.player"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // `api`: StreamarrPlayer's public surface (attachPlayer / the state
    // Flow) exposes androidx.media3.common types directly, so callers in
    // the app modules need those on their compile classpath too.
    api(libs.bundles.media3)

    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.javax.inject)

    testImplementation(libs.junit4)
    testImplementation(libs.kotlinx.coroutines.core)
}
