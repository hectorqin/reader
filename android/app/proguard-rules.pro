# The bridge methods are called from JavaScript by name via the @JavascriptInterface
# annotation. R8 cannot see those call sites, so without this the release build
# would strip them and the client would silently lose connectivity reporting and
# the device label.
-keepclassmembers class cool.cnb.reader.bridge.ReaderBridge {
    public *;
}
-keepattributes JavascriptInterface
-keepattributes *Annotation*
