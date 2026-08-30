# App-specific R8/ProGuard rules for the universal application. Library modules
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

# Playarr Cast: PlayarrCastOptionsProvider is reflectively instantiated by
# the Cast framework via AndroidManifest.xml's OPTIONS_PROVIDER_CLASS_NAME
# meta-data. Without this, R8 (isMinifyEnabled/isShrinkResources are both on
# for the Play release, see app/build.gradle.kts) can strip or rename the class
# or its no-arg constructor, and Cast init then fails only in release,
# silently, never in debug.
#
# Verified by inspecting the play-services-cast-framework-22.3.1.aar's own
# bundled proguard.txt (automatically merged by AGP's consumerProguardFiles
# for any AAR, no opt-in needed): it already ships
#   -keep public class * implements com.google.android.gms.cast.framework.OptionsProvider { public <methods>; }
# which is a name-agnostic wildcard, so it *does* generically cover this
# app's PlayarrCastOptionsProvider's public methods on its own. This rule
# is kept anyway, explicitly, as defense-in-depth for the no-arg
# constructor specifically (reflective instantiation needs the
# constructor, and it is not obviously covered by a "<methods>" keep) and
# so this class's protection does not depend on a third-party AAR's rule
# never changing.
-keep public class io.playarr.mobile.cast.PlayarrCastOptionsProvider {
    public <init>();
}
