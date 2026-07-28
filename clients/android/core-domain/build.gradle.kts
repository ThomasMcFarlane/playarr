plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "io.playarr.shared.domain"
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
    // Business logic operates on core-data's model + API contract types
    // directly. This project's module split puts the domain model and the
    // Retrofit contract in core-data (per this task's spec) rather than
    // here, so core-domain depends "up" onto it instead of the other way
    // around a stricter clean-architecture layering would use -- see the
    // KDoc on WorkRepository for the fuller rationale.
    api(project(":core-data"))

    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.javax.inject)

    testImplementation(libs.junit4)
    testImplementation(libs.kotlinx.coroutines.core)
}
