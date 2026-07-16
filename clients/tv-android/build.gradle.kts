plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt.android)
}

val playarrBaseUrl = providers
    .gradleProperty("playarrBaseUrl")
    .orElse("http://10.0.2.2:18080")

android {
    namespace = "io.streamarr.tv"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.streamarr.tv"
        // Android TV / Google TV, per docs/architecture/overview.md's client table.
        minSdk = 28
        targetSdk = 37
        versionCode = 3
        versionName = "0.1.2"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Override with -PplayarrBaseUrl=http://<development-host>:18080 when
        // deploying to a physical TV. The default is Android's emulator host.
        buildConfigField("String", "PLAYARR_BASE_URL", "\"${playarrBaseUrl.get()}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":core-data"))
    implementation(project(":core-domain"))
    implementation(project(":core-designsystem"))
    implementation(project(":core-player"))
    implementation(project(":core-auth"))
    implementation(project(":core-update"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)

    implementation(platform(libs.androidx.compose.bom))
    // Compose Test Series H/UI (layout, graphics, gestures) is shared with
    // mobile, but Material *components* come from androidx.tv.material3
    // below, not androidx.compose.material3 -- see ui/theme/TvTheme.kt.
    // The one exception is CircularProgressIndicator: tv-material3 doesn't
    // ship one, so this pulls the plain Compose Material 3 version in for
    // that single widget only (it is never themed via
    // androidx.compose.material3.MaterialTheme here).
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.media3.ui)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.androidx.tv.foundation)
    implementation(libs.androidx.tv.material)

    implementation(libs.hilt.android)
    ksp(libs.hilt.android.compiler)
    implementation(libs.hilt.navigation.compose)

    testImplementation(libs.junit4)
    testImplementation(libs.kotlinx.coroutines.core)
    androidTestImplementation(libs.androidx.test.ext.junit)
}
