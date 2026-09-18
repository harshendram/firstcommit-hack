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
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Thin WebSocket client for the Care orchestrator (`/care`).
 * Role: "watch" — daily voice check-in (not emergency /ws).
 *
 * Auto-reconnects with backoff when the backend restarts or the hotspot drops
 * the socket (OkHttp surfaces that as "Broken pipe").
 *
 * If [BuildConfig.ORCHESTRATOR_WS] still ends with `/ws`, it is rewritten to `/care`.
 */
class OrchestratorClient(
    private val url: String = resolveCareWsUrl(BuildConfig.ORCHESTRATOR_WS),
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        // Large patient_audio frames over hotspot; default 10s write can fail.
        .writeTimeout(60, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private val wantConnected = AtomicBoolean(false)
    private val connecting = AtomicBoolean(false)
    private val reconnectAttempt = AtomicInteger(0)
    private val scheduler = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "rakshak-ws-reconnect").apply { isDaemon = true }
    }
    private var reconnectFuture: ScheduledFuture<*>? = null

    @Volatile
    private var socket: WebSocket? = null

    private val _events = MutableSharedFlow<WatchInbound>(
        extraBufferCapacity = 32,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val events: SharedFlow<WatchInbound> = _events.asSharedFlow()

    @Volatile
    var connected: Boolean = false
        private set

    fun connect() {
        wantConnected.set(true)
        openSocket()
    }

    fun disconnect() {
        wantConnected.set(false)
        cancelReconnect()
        connecting.set(false)
        val ws = socket
        socket = null
        connected = false
        ws?.close(1000, "bye")
    }

    fun sendStartCheckIn() {
        send(JSONObject().put("type", "start_checkin").toString())
    }

    /**
     * Live Galaxy Watch vitals for the active check-in.
     * Omit null fields — never send fabricated SpO₂.
     */
    fun sendWatchVitals(restingHr: Double?, spo2: Int?, steps: Long?) {
        val json = JSONObject().put("type", "watch_vitals")
        if (restingHr != null && restingHr.isFinite() && restingHr in 35.0..220.0) {
            json.put("resting_hr", restingHr)
        }
        if (spo2 != null && spo2 in 70..100) {
            json.put("spo2", spo2)
        }
        if (steps != null && steps >= 200) {
            json.put("steps", steps)
        }
        // Nothing real to send — skip so backend never stores fabricated zeros.
        if (!json.has("resting_hr") && !json.has("spo2") && !json.has("steps")) return
        send(json.toString())
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

    fun sendFinishCheckIn() {
        send(JSONObject().put("type", "finish_checkin").toString())
    }

    fun sendReset() {
        send(JSONObject().put("type", "reset").toString())
    }

    /** HTTP origin matching the WS host (for `audio_url` TTS fetches). */
    fun httpOrigin(): String = wsUrlToHttpOrigin(url)

    private fun openSocket() {
        if (!wantConnected.get()) return
        if (connected || connecting.get()) return
        if (socket != null) return
        if (!connecting.compareAndSet(false, true)) return

        val request = try {
            Request.Builder().url(url).build()
        } catch (e: Exception) {
            connecting.set(false)
            _events.tryEmit(
                WatchInbound.Error("Bad orchestrator.ws URL: ${e.message}")
            )
            return
        }
        socket = client.newWebSocket(request, Listener())
    }

    private fun send(text: String) {
        val ws = socket
        if (ws == null || !connected) {
            _events.tryEmit(WatchInbound.Error("Watch offline — reconnecting…"))
            if (wantConnected.get()) scheduleReconnect()
            return
        }
        val ok = ws.send(text)
        if (!ok) {
            _events.tryEmit(
                WatchInbound.Error("Send buffer full — wait a moment and try again")
            )
        }
    }

    private fun clearSocket() {
        connecting.set(false)
        connected = false
        socket = null
    }

    private fun scheduleReconnect() {
        if (!wantConnected.get()) return
        cancelReconnect()
        val attempt = reconnectAttempt.getAndIncrement().coerceAtMost(4)
        val delayMs = (500L * (1L shl attempt)).coerceAtMost(8_000L)
        _events.tryEmit(WatchInbound.Error("Connection lost — retrying…"))
        reconnectFuture = scheduler.schedule({
            openSocket()
        }, delayMs, TimeUnit.MILLISECONDS)
    }

    private fun cancelReconnect() {
        reconnectFuture?.cancel(false)
        reconnectFuture = null
    }

    private fun friendlyFailure(t: Throwable, response: Response?): String {
        val raw = t.message.orEmpty()
        val lower = raw.lowercase()
        return when {
            lower.contains("broken pipe") ||
                lower.contains("connection reset") ||
                lower.contains("software caused connection abort") ->
                "Link dropped (backend restart or hotspot). Reconnecting…"
            lower.contains("failed to connect") ||
                lower.contains("timeout") ||
                lower.contains("unable to resolve") ->
                "Cannot reach $url — check hotspot IP / firewall"
            response != null && response.code == 400 ->
                "Care WS rejected upgrade (HTTP 400) — is /care routed?"
            raw.isNotBlank() -> raw
            else -> "connection failed"
        }
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            connecting.set(false)
            connected = true
            reconnectAttempt.set(0)
            cancelReconnect()
            webSocket.send(
                JSONObject()
                    .put("type", "hello")
                    .put("role", "watch")
                    .toString()
            )
            _events.tryEmit(WatchInbound.Connected)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            try {
                val json = JSONObject(text)
                when (json.optString("type")) {
                    "care_session" -> {
                        val s = json.getJSONObject("session")
                        _events.tryEmit(
                            WatchInbound.Session(
                                CareSessionSnapshot(
                                    sessionId = s.optString("session_id"),
                                    phase = s.optString("phase", "idle"),
                                )
                            )
                        )
                    }
                    "care_tts" -> {
                        val urlPath = json.optString("audio_url").takeIf { it.isNotBlank() }
                        val absoluteUrl = urlPath?.let { resolveAudioUrl(it) }
                        val b64 = json.optString("audio_base64").takeIf { it.isNotBlank() }
                        if (absoluteUrl == null && b64 == null) {
                            _events.tryEmit(WatchInbound.Error("TTS missing audio"))
                            return
                        }
                        _events.tryEmit(
                            WatchInbound.TtsAudio(
                                base64 = b64,
                                audioUrl = absoluteUrl,
                                mimeType = json.optString("mime_type", "audio/wav"),
                                text = json.optString("text"),
                            )
                        )
                    }
                    "care_error" -> {
                        _events.tryEmit(WatchInbound.Error(json.optString("message")))
                    }
                    // care_doctor / care_turn — doctor dashboard only; ignore on watch
                }
            } catch (e: Exception) {
                _events.tryEmit(WatchInbound.Error(e.message ?: "parse error"))
            }
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            // unused — protocol is JSON text
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            clearSocket()
            _events.tryEmit(WatchInbound.Disconnected)
            scheduleReconnect()
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            clearSocket()
            _events.tryEmit(WatchInbound.Disconnected)
            _events.tryEmit(WatchInbound.Error(friendlyFailure(t, response)))
            scheduleReconnect()
        }
    }

    private fun resolveAudioUrl(pathOrUrl: String): String {
        if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
            return pathOrUrl
        }
        val origin = httpOrigin()
        return if (pathOrUrl.startsWith("/")) origin + pathOrUrl else "$origin/$pathOrUrl"
    }

    companion object {
        /** Map legacy `/ws` (or bare host:port) to Care `/care`. */
        fun resolveCareWsUrl(raw: String): String {
            val trimmed = raw.trim()
            if (trimmed.endsWith("/care")) return trimmed
            if (trimmed.endsWith("/ws")) {
                return trimmed.removeSuffix("/ws") + "/care"
            }
            return trimmed.trimEnd('/') + "/care"
        }

        fun wsUrlToHttpOrigin(wsUrl: String): String {
            val secure = wsUrl.startsWith("wss://", ignoreCase = true)
            val rest = wsUrl
                .removePrefix("wss://")
                .removePrefix("WSS://")
                .removePrefix("ws://")
                .removePrefix("WS://")
            val hostPort = rest.substringBefore('/')
            return if (secure) "https://$hostPort" else "http://$hostPort"
        }
    }
}
