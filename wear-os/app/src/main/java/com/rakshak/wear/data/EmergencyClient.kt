package com.rakshak.wear.data

import com.rakshak.wear.BuildConfig
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Emergency orchestrator client (`/ws`) — fall / SOS voice triage.
 * Kept separate from the Care `/care` check-in socket.
 */
class EmergencyClient(
    private val url: String = resolveEmergencyWsUrl(BuildConfig.ORCHESTRATOR_WS),
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private val connecting = AtomicBoolean(false)

    @Volatile
    private var socket: WebSocket? = null

    private val _events = MutableSharedFlow<EmergencyInbound>(
        extraBufferCapacity = 32,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val events: SharedFlow<EmergencyInbound> = _events.asSharedFlow()

    @Volatile
    var connected: Boolean = false
        private set

    fun connect() {
        if (connected || connecting.get()) return
        if (!connecting.compareAndSet(false, true)) return
        val request = try {
            Request.Builder().url(url).build()
        } catch (e: Exception) {
            connecting.set(false)
            _events.tryEmit(EmergencyInbound.Error("Bad emergency WS URL: ${e.message}"))
            return
        }
        socket = client.newWebSocket(request, Listener())
    }

    fun disconnect() {
        connecting.set(false)
        val ws = socket
        socket = null
        connected = false
        ws?.close(1000, "bye")
    }

    fun sendTrigger(triggerType: String = "simulated_fall") {
        send(
            JSONObject()
                .put("type", "trigger")
                .put("trigger_type", triggerType)
                .toString()
        )
    }

    fun sendAudio(base64: String, mimeType: String = "audio/wav") {
        send(
            JSONObject()
                .put("type", "patient_audio")
                .put("audio_base64", base64)
                .put("mime_type", mimeType)
                .toString()
        )
    }

    fun sendReset() {
        send(JSONObject().put("type", "reset").toString())
    }

    /** Fire the fall even if the WS is slow — HTTP is the safety net. */
    fun httpTriggerOrigin(): String = OrchestratorClient.wsUrlToHttpOrigin(url)

    private fun send(text: String) {
        val ws = socket
        if (ws == null || !connected) {
            _events.tryEmit(EmergencyInbound.Error("Emergency link offline"))
            return
        }
        ws.send(text)
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            connecting.set(false)
            connected = true
            // Hello BEFORE Connected — hub defaults new sockets to "dashboard",
            // and TTS is only pushed to role=watch. Trigger must not race ahead.
            webSocket.send(
                JSONObject()
                    .put("type", "hello")
                    .put("role", "watch")
                    .toString()
            )
            _events.tryEmit(EmergencyInbound.Connected)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            try {
                val json = JSONObject(text)
                when (json.optString("type")) {
                    "session" -> {
                        val s = json.getJSONObject("session")
                        _events.tryEmit(
                            EmergencyInbound.Session(
                                EmergencySessionSnapshot(
                                    sessionId = s.optString("session_id"),
                                    state = s.optString("state", "idle"),
                                    severity = s.optString("severity").takeIf { it.isNotBlank() },
                                )
                            )
                        )
                    }
                    "tts_audio" -> {
                        val urlPath = json.optString("audio_url").takeIf { it.isNotBlank() }
                        val absoluteUrl = urlPath?.let { resolveAudioUrl(it) }
                        val b64 = json.optString("audio_base64").takeIf { it.isNotBlank() }
                        if (absoluteUrl == null && b64 == null) {
                            _events.tryEmit(EmergencyInbound.Error("TTS missing audio"))
                            return
                        }
                        _events.tryEmit(
                            EmergencyInbound.TtsAudio(
                                base64 = b64,
                                audioUrl = absoluteUrl,
                                mimeType = json.optString("mime_type", "audio/wav"),
                                text = json.optString("text"),
                            )
                        )
                    }
                    "error" -> {
                        _events.tryEmit(EmergencyInbound.Error(json.optString("message")))
                    }
                }
            } catch (e: Exception) {
                _events.tryEmit(EmergencyInbound.Error(e.message ?: "parse error"))
            }
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) = Unit

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            connecting.set(false)
            connected = false
            socket = null
            _events.tryEmit(EmergencyInbound.Disconnected)
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            connecting.set(false)
            connected = false
            socket = null
            _events.tryEmit(EmergencyInbound.Disconnected)
            _events.tryEmit(
                EmergencyInbound.Error(t.message ?: "emergency connection failed")
            )
        }
    }

    private fun resolveAudioUrl(pathOrUrl: String): String {
        if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
            return pathOrUrl
        }
        val origin = httpTriggerOrigin()
        return if (pathOrUrl.startsWith("/")) origin + pathOrUrl else "$origin/$pathOrUrl"
    }

    companion object {
        fun resolveEmergencyWsUrl(raw: String): String {
            val trimmed = raw.trim()
            if (trimmed.endsWith("/ws")) return trimmed
            if (trimmed.endsWith("/care")) {
                return trimmed.removeSuffix("/care") + "/ws"
            }
            return trimmed.trimEnd('/') + "/ws"
        }
    }
}
