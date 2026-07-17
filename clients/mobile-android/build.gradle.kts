plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt.android)
}

val firebaseApiKey = providers.gradleProperty("firebaseApiKey").orElse("")
val firebaseApplicationId = providers.gradleProperty("firebaseMobileApplicationId").orElse("")
val firebaseProjectId = providers.gradleProperty("firebaseProjectId").orElse("")
val firebaseSenderId = providers.gradleProperty("firebaseSenderId").orElse("")

android {
    namespace = "io.streamarr.mobile"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.streamarr.mobile"
        // Android 8.0+, per docs/architecture/overview.md's client table.
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"

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
    implementation(libs.androidx.media3.ui)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    implementation(libs.hilt.android)
    ksp(libs.hilt.android.compiler)
    implementation(libs.hilt.navigation.compose)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    testImplementation(libs.junit4)
    testImplementation(libs.kotlinx.coroutines.core)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
}
