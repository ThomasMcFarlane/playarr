plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.ksp)
}

android {
    namespace = "io.playarr.shared.download"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
        // Room schema export isn't wired to a checked-in schemas/ directory yet; schema 2's
        // explicit v1 migration is covered directly (see PlayarrDownloadDatabase's KDoc).
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
    // DownloadCandidate/DownloadQualityOption/DownloadTicketResponse and the
    // PlayarrApi download endpoints this module's repository calls.
    api(project(":core-data"))
    api(project(":core-domain"))
    // TokenStore isn't referenced directly here (the authenticated OkHttp
    // DataSource lives in the app module's DownloadModule, which already
    // has core-auth on its classpath) -- implementation, not api, kept only
    // for the device-id-stable download-request tagging this module may
    // grow later.
    implementation(project(":core-auth"))

    // Media3's real offline-download stack: androidx.media3.exoplayer.offline
    // (DownloadManager/DownloadService/DownloadIndex/DownloadRequest) lives
    // in media3-exoplayer; media3-database/media3-datasource back the
    // on-disk DownloadIndex + the Cache/CacheSpan lookup DownloadRepository.
    // localFile() uses. This is the same Media3 major version core-player
    // already depends on (kept in sync via the shared `media3` version
    // catalog entry) -- deliberately *not* a second, competing OkHttp+Range
    // downloader dependency.
    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.common)
    implementation(libs.androidx.media3.database)
    implementation(libs.androidx.media3.datasource)

    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    // KeepUntilSweepWorker's *interface* (sweepExpired() on DownloadRepository)
    // lives here; the actual CoroutineWorker/@HiltWorker class lives in the
    // app module (see that module's KeepUntilSweepWorker KDoc for why) --
    // only the plain WorkManager runtime is needed on this module's
    // classpath, not the Hilt integration artifacts.
    implementation(libs.androidx.work.runtime.ktx)

    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.javax.inject)

    testImplementation(libs.junit4)
    testImplementation(libs.kotlinx.coroutines.core)
}
