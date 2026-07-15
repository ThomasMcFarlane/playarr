# App-specific R8/ProGuard rules for mobile-android. Library modules
# contribute their own rules via consumerProguardFiles (see core-data's
# consumer-rules.pro for the kotlinx.serialization rules, for example) so
# this file only needs app-level concerns.

# Hilt-generated components are referenced reflectively by the Hilt Gradle
# plugin's bytecode transform; keep their generated names stable.
-keep class dagger.hilt.internal.aggregatedroot.codegen.* { *; }
-keep class hilt_aggregated_deps.* { *; }

# Retain line numbers for readable stack traces from release-build crash reports.
-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile
