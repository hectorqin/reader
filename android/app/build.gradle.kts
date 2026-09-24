plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "cool.cnb.reader"
    compileSdk = 35

    defaultConfig {
        applicationId = "cool.cnb.reader"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        /*
         * Where the WebView points on first launch.
         *
         * Left empty on purpose. Baking in an address would produce an app that
         * cannot be used by anyone but its author, and the reader does not know
         * the IP it will be reached at (product design §8.1: deployment friction
         * is the biggest adoption barrier). The login screen asks for it once and
         * remembers it.
         *
         * `DEFAULT_SERVER_URL` can be set at build time for a preconfigured
         * personal build: ./gradlew assembleDebug -PdefaultServerUrl=http://nas:5888
         */
        buildConfigField(
            "String",
            "DEFAULT_SERVER_URL",
            "\"${(project.findProperty("defaultServerUrl") as String?) ?: ""}\"",
        )
    }

    buildFeatures {
        buildConfig = true
        viewBinding = false
    }

    buildTypes {
        debug {
            // Same applicationId as release so a debug build upgrades over a
            // release one and keeps the reader's session and offline books.
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Signed with the debug key unless a keystore is provided. An
            // unsigned release APK cannot be side-loaded at all, and this project
            // has no signing infrastructure to promise (product design §7).
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    sourceSets {
        getByName("main") {
            /*
             * The shared web client is built by Vite into `web/dist` and packed
             * into assets. This is the single mechanism that keeps the Android
             * and H5 clients from becoming two implementations: one bundle, two
             * hosts.
             *
             * `src/main/assets/web-assets` is where
             * android/scripts/build-web-assets.sh stages that bundle, and the
             * directory is gitignored except for a README.txt placeholder.
             *
             * The placeholder is not decoration. Without it the directory is
             * absent from a clean checkout, and the previous version of this line
             * pointed at a *third* path (`android/app/web-assets`) that nothing
             * ever created — so the staged bundle was silently not an asset
             * source, and the APK built fine with no client inside it. That is a
             * worse failure than a red build: nothing points at it.
             */
            assets.srcDirs("src/main/assets", "src/main/assets/web-assets")
        }
    }

    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    // WebViewAssetLoader: serves the bundled web client over an https:// origin
    // instead of file://, which is what makes fetch() to the reader server work
    // without disabling web security. See WebHost.kt.
    implementation("androidx.webkit:webkit:1.12.1")
}
