# App-specific R8/ProGuard rules for tv-android. See core-data's
# consumer-rules.pro for the kotlinx.serialization rules every module
# consuming @Serializable types contributes automatically.

-keep class dagger.hilt.internal.aggregatedroot.codegen.* { *; }
-keep class hilt_aggregated_deps.* { *; }

-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile

# Methods exposed to the co-hosted Playarr Web profile page.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
