package com.rakshak.wear.data

/**
 * Minimal models for Care (`/care`) and Emergency (`/ws`) watch protocols.
 */
data class CareSessionSnapshot(
    val sessionId: String = "",
    val phase: String = "idle",
)

data class EmergencySessionSnapshot(
    val sessionId: String = "",
    val state: String = "idle",
    val severity: String? = null,
)

sealed interface WatchInbound {
    data object Connected : WatchInbound
    data object Disconnected : WatchInbound
    data class Session(val snapshot: CareSessionSnapshot) : WatchInbound
    data class TtsAudio(
        val base64: String? = null,
        val audioUrl: String? = null,
        val mimeType: String,
        val text: String,
    ) : WatchInbound
    data class Error(val message: String) : WatchInbound
}

sealed interface EmergencyInbound {
    data object Connected : EmergencyInbound
    data object Disconnected : EmergencyInbound
    data class Session(val snapshot: EmergencySessionSnapshot) : EmergencyInbound
    data class TtsAudio(
        val base64: String? = null,
        val audioUrl: String? = null,
        val mimeType: String,
        val text: String,
    ) : EmergencyInbound
    data class Error(val message: String) : EmergencyInbound
}
