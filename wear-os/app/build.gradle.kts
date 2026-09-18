import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

fun loadOrchestratorWs(): String {
    val props = Properties()
    val local = rootProject.file("local.properties")
    if (local.exists()) {
        local.inputStream().use { props.load(it) }
    }
    return props.getProperty("orchestrator.ws", "ws://10.0.2.2:3001/care")
}

fun loadAllyApi(): String {
    val props = Properties()
    val local = rootProject.file("local.properties")
    if (local.exists()) {
        local.inputStream().use { props.load(it) }
    }
    val explicit = props.getProperty("ally.api")
    if (!explicit.isNullOrBlank()) return explicit
    val ws = loadOrchestratorWs()
    return ws
        .replace("ws://", "http://")
        .replace("wss://", "https://")
        .replace(Regex(":3001/.*"), ":8002")
        .replace(Regex("/care$"), "")
        .replace(Regex("/ws$"), "")
        .let { if (it.endsWith("/")) it.dropLast(1) else it }
        .ifBlank { "http://10.0.2.2:8002" }
}

fun loadAllyDeviceKey(): String {
    val props = Properties()
    val local = rootProject.file("local.properties")
    if (local.exists()) {
        local.inputStream().use { props.load(it) }
    }
    return props.getProperty("ally.deviceKey", "")
}

android {
    namespace = "com.rakshak.wear"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.rakshak.wear"
        minSdk = 30
        targetSdk = 35
        versionCode = 9
        versionName = "2.1.5"
        buildConfigField("String", "ORCHESTRATOR_WS", "\"${loadOrchestratorWs()}\"")
        buildConfigField("String", "ALLY_API", "\"${loadAllyApi()}\"")
        buildConfigField("String", "ALLY_DEVICE_KEY", "\"${loadAllyDeviceKey()}\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.wear.compose:compose-material:1.4.0")
    implementation("androidx.wear.compose:compose-foundation:1.4.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-guava:1.9.0")

    // Heart rate + daily steps (Galaxy Watch / Wear OS)
    implementation("androidx.health:health-services-client:1.0.0")

    // Optional SpO₂: drop samsung-health-sensor-api.aar into app/libs/ (see libs/README.md)
    implementation(fileTree(mapOf("dir" to "libs", "include" to listOf("*.aar"))))

    debugImplementation("androidx.compose.ui:ui-tooling")
}
