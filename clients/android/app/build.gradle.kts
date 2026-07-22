plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt.android)
}

base {
    archivesName.set("playarr-android")
}

val firebaseApiKey = providers.gradleProperty("firebaseApiKey").orElse("")
val firebaseApplicationId = providers.gradleProperty("firebaseMobileApplicationId").orElse("")
val firebaseProjectId = providers.gradleProperty("firebaseProjectId").orElse("")
val firebaseSenderId = providers.gradleProperty("firebaseSenderId").orElse("")
val playarrVersionCode = providers.environmentVariable("PLAYARR_VERSION_CODE").map(String::toInt).orElse(1)
val playarrVersionName = providers.environmentVariable("PLAYARR_VERSION_NAME").orElse("0.1.0")
val releaseKeystorePath = providers.environmentVariable("ANDROID_KEYSTORE_PATH")
val releaseKeystorePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS")
val releaseKeyPassword = providers.environmentVariable("ANDROID_KEY_PASSWORD")
val releaseSigningReady = listOf(
    releaseKeystorePath,
    releaseKeystorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { it.isPresent }

android {
    namespace = "io.streamarr.mobile"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.streamarr.mobile"
        // Android 8.0+, per docs/architecture/overview.md's client table.
        minSdk = 26
        targetSdk = 37
        versionCode = playarrVersionCode.get()
        versionName = playarrVersionName.get()

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "FIREBASE_API_KEY", "\"${firebaseApiKey.get()}\"")
        buildConfigField("String", "FIREBASE_APPLICATION_ID", "\"${firebaseApplicationId.get()}\"")
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${firebaseProjectId.get()}\"")
        buildConfigField("String", "FIREBASE_SENDER_ID", "\"${firebaseSenderId.get()}\"")

        // No STREAMARR_BASE_URL buildConfigField: the server base URL is a
        // runtime-configurable, DataStore-backed setting now (see
        // core-data's ServerConfigStore + the Settings screen), not a
        // value baked into the build -- a client must be able to point at
        // an arbitrary operator-run instance.
    }

    signingConfigs {
        if (releaseSigningReady) {
            create("playarrRelease") {
                storeFile = file(releaseKeystorePath.get())
                storePassword = releaseKeystorePassword.get()
                keyAlias = releaseKeyAlias.get()
                keyPassword = releaseKeyPassword.get()
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (releaseSigningReady) {
                signingConfig = signingConfigs.getByName("playarrRelease")
            }
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
    implementation(project(":core-auth"))
    implementation(project(":core-player"))
    implementation(project(":core-update"))
    implementation(project(":core-download"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.bundles.compose)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.zxing.core)
    implementation(libs.androidx.media3.ui)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    implementation(libs.hilt.android)
    ksp(libs.hilt.android.compiler)
    implementation(libs.hilt.navigation.compose)

    // Offline downloads: Media3's own SimpleCache/StandaloneDatabaseProvider/
    // authenticated OkHttpDataSource/DownloadManager are wired in
    // di/DownloadModule.kt; androidx.media3.exoplayer(-offline) itself comes
    // in transitively via core-player's `api(libs.bundles.media3)`.
    implementation(libs.androidx.media3.database)
    implementation(libs.androidx.media3.datasource.okhttp)

    // Room: constructs StreamarrDownloadDatabase in di/DownloadModule.kt.
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    // WorkManager: KeepUntilSweepWorker's periodic Keep-until expiry sweep only.
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    testImplementation(libs.junit4)
    testImplementation(libs.kotlinx.coroutines.core)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
}
