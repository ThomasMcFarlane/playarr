plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "io.playarr.shared.update"
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
    // ClientPlatform/VersionEnvelope/CompatibilityEntry -- what
    // UpdateAvailabilityEvaluator compares the running build against.
    api(project(":core-data"))

    // AppUpdateCoordinator's public surface exposes AppUpdateManager/
    // AppUpdateInfo/InstallStateUpdatedListener types directly (mirrors
    // core-player's PlayarrPlayer exposing the raw Media3 Player) --
    // `api`, not `implementation`, so app modules see them too.
    api(libs.play.app.update)
    api(libs.play.app.update.ktx)

    // startUpdateFlowForResult's non-deprecated overload takes an
    // ActivityResultLauncher<IntentSenderRequest>, constructed via Compose's
    // rememberLauncherForActivityResult in the app modules.
    api(libs.androidx.activity.compose)

    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.javax.inject)

    testImplementation(libs.junit4)
    testImplementation(libs.kotlinx.coroutines.core)
}
