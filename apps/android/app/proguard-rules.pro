# OpenComms ProGuard rules (debug build placeholder)
# Production rules will be added when Play Store release is in scope.

# Keep kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.opencomms.**$$serializer { *; }
-keepclassmembers class com.opencomms.** {
    *** Companion;
}
-keepclasseswithmembers class com.opencomms.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Keep OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }
