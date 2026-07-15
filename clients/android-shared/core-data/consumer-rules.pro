# Consumer ProGuard/R8 rules contributed to any app that depends on core-data.
#
# kotlinx.serialization generates a synthetic `$serializer` companion for
# every @Serializable class via reflection-adjacent codegen; R8 needs to be
# told not to touch it. See:
# https://github.com/Kotlin/kotlinx.serialization/blob/master/rules/common.pro
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt

-keepclasseswithmembers class io.streamarr.shared.data.**$$serializer {
    *** serializer(...);
}
-keepclassmembers class io.streamarr.shared.data.** {
    *** Companion;
}
-keepclasseswithmembers class io.streamarr.shared.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}
