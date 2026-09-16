/*
 * Root build file.
 *
 * The Android shell is deliberately dependency-light. It has exactly two jobs —
 * host a WebView and copy the shared web bundle out of assets — and every extra
 * dependency is weight an open-source APK has to justify, plus another thing that
 * can be missing from F-Droid or a de-Googled device.
 */
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}
