# R8 rules for the release build.

# The JavaScript bridge. Kotlin never calls it; the page calls its methods by
# name (window.AndroidBars.setBars), so without this R8 strips it and the call
# fails at runtime with no build error to warn anyone.
-keep class com.alekstudios.sleepcalculator.MainActivity$BarsBridge { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keeps line numbers in a crash report meaningful after shrinking.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
