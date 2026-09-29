plugins {
    id("com.android.application")
}

android {
    namespace = "it.agentbridge.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "it.agentbridge.app"
        minSdk = 26
        targetSdk = 37
        versionCode = 5
        versionName = "1.3.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
