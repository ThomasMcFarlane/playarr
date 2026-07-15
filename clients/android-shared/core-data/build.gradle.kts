plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "io.streamarr.shared.data"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
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
    // streamarr-model equivalents (Work, MediaFile, ...) live in this module.
    // `api` (not `implementation`): the StreamarrApi interface's method
    // signatures are Retrofit/kotlinx.serialization types, and core-domain
    // (and the app modules) consume StreamarrApi directly, so those types
    // need to be on their compile classpath transitively.
    api(libs.bundles.networking)
    api(libs.kotlinx.coroutines.core)

    // Lets classes here declare `@Inject constructor(...)` so the app
    // modules' Hilt graphs can construct them, without this module itself
    // depending on Hilt or running annotation processing.
    implementation(libs.javax.inject)

    testImplementation(libs.junit4)
    testImplementation(libs.kotlinx.coroutines.core)
}
