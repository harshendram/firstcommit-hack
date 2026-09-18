package com.rakshak.wear

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.rakshak.wear.audio.AudioBridge
import com.rakshak.wear.data.AllyHttp
import com.rakshak.wear.data.EmergencyClient
import com.rakshak.wear.data.EmergencyInbound
import com.rakshak.wear.data.OrchestratorClient
import com.rakshak.wear.data.WatchInbound
import com.rakshak.wear.health.FallDetector
import com.rakshak.wear.health.VitalsCollector
import com.rakshak.wear.health.WakeDetector
import com.rakshak.wear.health.WatchVitals
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

enum class WatchMode { CARE, SOS }

data class WatchUiState(
    val connected: Boolean = false,
    val mode: WatchMode = WatchMode.CARE,
    val phase: String = "idle",
    val severity: String? = null,
    val lastAiText: String = "",
    val statusMessage: String = "Connecting…",
    val recording: Boolean = false,
    /** Hands-free conversation active (care check-in or SOS triage). */
    val conversationLive: Boolean = false,
    val fallArmed: Boolean = true,
    /** True while HR / SpO₂ / steps are being sampled. */
    val measuringVitals: Boolean = false,
    /** Last successful vitals line for the watch face (null until measured). */
    val vitalsLine: String? = null,
)

/**
 * Dual-mode watch:
 *  - CARE: daily recovery check-in on `/care`
 *  - SOS: accelerometer fall → emergency triage on `/ws`
 */
class RakshakViewModel(app: Application) : AndroidViewModel(app) {
    private val care = OrchestratorClient()
    private val emergency = EmergencyClient()
    private val allyHttp = AllyHttp()
    private val audio = AudioBridge(app)
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val fallDetector = FallDetector(app) {
        viewModelScope.launch { onFallDetected() }
    }
    private val wakeDetector = WakeDetector(app) {
        viewModelScope.launch(Dispatchers.IO) {
            allyHttp.postWatch("wake")
        }
        viewModelScope.launch {
            _uiState.update { it.copy(statusMessage = "Good morning — first movement") }
        }
    }
    private val vitalsCollector = VitalsCollector(app)
    private var vitalsJob: Job? = null

    private val started = AtomicBoolean(false)
    private var autoStopMicJob: Job? = null
    private var listenAfterSpeakJob: Job? = null
    /** True once emergency session leaves idle — ignore the initial idle snapshot. */
    private var sosSawActive = false
    /** Prevents double trigger (WS + HTTP fallback). */
    private var sosTriggerSent = false

    private val _uiState = MutableStateFlow(WatchUiState())
    val uiState: StateFlow<WatchUiState> = _uiState.asStateFlow()

    fun connect() {
        care.connect()
        fallDetector.start()
        wakeDetector.start()

        if (!started.compareAndSet(false, true)) return

        viewModelScope.launch {
            care.events.collect { event ->
                if (_uiState.value.mode == WatchMode.SOS) return@collect
                when (event) {
                    is WatchInbound.Connected -> {
                        _uiState.update {
                            it.copy(
                                connected = true,
                                statusMessage = statusFor(it),
                            )
                        }
                    }
                    is WatchInbound.Disconnected -> {
                        _uiState.update { it.copy(connected = false) }
                    }
                    is WatchInbound.Session -> {
                        val phase = event.snapshot.phase
                        val live = isCareLive(phase)
                        if (live) fallDetector.disarm()
                        else if (!_uiState.value.conversationLive) fallDetector.rearm()
                        _uiState.update {
                            it.copy(
                                connected = true,
                                phase = phase,
                                conversationLive = live,
                                fallArmed = !live,
                                statusMessage = statusFor(
                                    it.copy(phase = phase, conversationLive = live, recording = it.recording)
                                ),
                            )
                        }
                        if (!live) {
                            cancelMicJobs()
                            if (_uiState.value.recording) {
                                withContext(Dispatchers.IO) { audio.stopRecordingToWavBase64() }
                                _uiState.update { it.copy(recording = false) }
                            }
                        }
                    }
                    is WatchInbound.TtsAudio -> handleTts(
                        text = event.text,
                        play = {
                            when {
                                !event.audioUrl.isNullOrBlank() -> audio.playUrl(event.audioUrl)
                                !event.base64.isNullOrBlank() -> audio.playBase64Wav(event.base64)
                            }
                        },
                    )
                    is WatchInbound.Error -> {
                        _uiState.update {
                            it.copy(statusMessage = event.message, connected = care.connected)
                        }
                    }
                }
            }
        }

        viewModelScope.launch {
            emergency.events.collect { event ->
                when (event) {
                    is EmergencyInbound.Connected -> {
                        sosSawActive = false
                        _uiState.update {
                            it.copy(
                                connected = true,
                                mode = WatchMode.SOS,
                                statusMessage = "Fall detected — calling…",
                            )
                        }
                        // If HTTP fallback already started triage, stay quiet —
                        // hub will replay last TTS on hello for late /ws joins.
                        if (!sosTriggerSent) {
                            sosTriggerSent = true
                            emergency.sendTrigger("simulated_fall")
                        }
                    }
                    is EmergencyInbound.Disconnected -> {
                        if (_uiState.value.mode == WatchMode.SOS) {
                            _uiState.update { it.copy(connected = false) }
                        }
                    }
                    is EmergencyInbound.Session -> {
                        val state = event.snapshot.state
                        // Hub pushes the current (often idle) session on connect.
                        // Ending SOS on that idle snapshot hung up before greeting TTS.
                        if (state == "idle" && !sosSawActive) {
                            return@collect
                        }
                        if (isSosLive(state)) sosSawActive = true
                        val live = isSosLive(state)
                        _uiState.update {
                            it.copy(
                                mode = WatchMode.SOS,
                                phase = state,
                                severity = event.snapshot.severity,
                                conversationLive = live,
                                fallArmed = false,
                                statusMessage = sosStatus(state, it.recording, event.snapshot.severity),
                            )
                        }
                        if (state == "resolved" || (state == "idle" && sosSawActive)) {
                            sosSawActive = false
                            endSosAndReturnToCare()
                        }
                    }
                    is EmergencyInbound.TtsAudio -> handleTts(
                        text = event.text,
                        play = {
                            when {
                                !event.audioUrl.isNullOrBlank() ->
                                    audio.playUrl(event.audioUrl)
                                !event.base64.isNullOrBlank() ->
                                    audio.playBase64Wav(event.base64)
                            }
                        },
                    )
                    is EmergencyInbound.Error -> {
                        _uiState.update { it.copy(statusMessage = event.message) }
                    }
                }
            }
        }
    }

    fun disconnect() {
        cancelMicJobs()
        vitalsJob?.cancel()
        vitalsJob = null
        fallDetector.stop()
        wakeDetector.stop()
        if (_uiState.value.recording) {
            audio.stopRecordingToWavBase64()
            _uiState.update { it.copy(recording = false) }
        }
        care.disconnect()
        emergency.disconnect()
    }

    override fun onCleared() {
        disconnect()
        started.set(false)
        super.onCleared()
    }

    fun startCheckIn() {
        if (_uiState.value.mode == WatchMode.SOS) return
        val phase = _uiState.value.phase
        if (phase != "idle" && phase != "complete") return
        fallDetector.disarm()
        _uiState.update {
            it.copy(
                conversationLive = true,
                fallArmed = false,
                measuringVitals = true,
                vitalsLine = null,
                statusMessage = "Measuring vitals…",
            )
        }
        care.sendStartCheckIn()
        collectAndSendVitals()
    }

    /** Spot HR / SpO₂ / steps; send watch_vitals (demo-filled when sensors miss). */
    private fun collectAndSendVitals() {
        vitalsJob?.cancel()
        vitalsJob = viewModelScope.launch {
            val raw = try {
                withContext(Dispatchers.Default) { vitalsCollector.collect() }
            } catch (_: Exception) {
                WatchVitals()
            }
            if (_uiState.value.mode == WatchMode.SOS) return@launch
            // Hardcode proper demo vitals when live samples are missing / zero.
            val vitals = WatchVitals.withDemoFallback(raw)
            val line = vitals.statusLine()
            _uiState.update {
                it.copy(
                    measuringVitals = false,
                    vitalsLine = line,
                    statusMessage = when {
                        it.recording -> it.statusMessage
                        else -> line
                    },
                )
            }
            care.sendWatchVitals(vitals.restingHr, vitals.spo2, vitals.steps)
            withContext(Dispatchers.IO) {
                // Ally only ever receives real readings (never the demo fallback values).
                allyHttp.postWatch("activity", steps = raw.steps?.toInt(), heartRate = raw.restingHr?.toInt())
            }
        }
    }

    fun imOkay() {
        viewModelScope.launch(Dispatchers.IO) { allyHttp.imOkay() }
        _uiState.update { it.copy(statusMessage = "I'm okay — Ally notified") }
    }

    /** Manual SOS for demos when a physical drop is awkward. */
    fun triggerFallManually() {
        viewModelScope.launch { onFallDetected() }
    }

    fun startMicCapture() {
        startMicCaptureInternal(auto = false)
    }

    fun stopMicCapture() {
        autoStopMicJob?.cancel()
        autoStopMicJob = null
        viewModelScope.launch { stopMicCaptureInternal() }
    }

    private suspend fun onFallDetected() {
        val s = _uiState.value
        if (s.mode == WatchMode.SOS) return
        if (s.conversationLive && s.mode == WatchMode.CARE) {
            // Don't interrupt an active check-in mid-sentence
            return
        }
        fallDetector.disarm()
        cancelMicJobs()
        if (s.recording) {
            withContext(Dispatchers.IO) { audio.stopRecordingToWavBase64() }
        }
        // Tell Ally straight away: it asks her first on the tablet, and involves family only if
        // she cannot answer. This is independent of the legacy emergency voice link below.
        viewModelScope.launch(Dispatchers.IO) { allyHttp.postWatch("fall") }
        _uiState.update {
            it.copy(
                mode = WatchMode.SOS,
                recording = false,
                conversationLive = true,
                fallArmed = false,
                phase = "listening",
                statusMessage = "Fall detected…",
                lastAiText = "",
            )
        }
        // Care stays connected in background; emergency owns the mic/TTS now.
        sosTriggerSent = false
        emergency.connect()
        // Last-resort alert if /ws never comes up. Long delay so voice path wins.
        viewModelScope.launch {
            delay(8_000)
            if (_uiState.value.mode == WatchMode.SOS && !emergency.connected && !sosTriggerSent) {
                sosTriggerSent = true
                withContext(Dispatchers.IO) { httpTriggerFall() }
                _uiState.update {
                    it.copy(statusMessage = "Fall alert sent (no live voice link)")
                }
            }
        }
    }

    private fun endSosAndReturnToCare() {
        cancelMicJobs()
        emergency.disconnect()
        fallDetector.rearm()
        sosTriggerSent = false
        sosSawActive = false
        _uiState.update {
            it.copy(
                mode = WatchMode.CARE,
                phase = "idle",
                severity = null,
                conversationLive = false,
                fallArmed = true,
                recording = false,
                statusMessage = if (care.connected) "Tap to check in" else "Reconnecting…",
                connected = care.connected,
            )
        }
    }

    private fun handleTts(text: String, play: suspend () -> Unit) {
        cancelMicJobs()
        viewModelScope.launch {
            if (_uiState.value.recording) {
                withContext(Dispatchers.IO) { audio.stopRecordingToWavBase64() }
            }
            _uiState.update {
                it.copy(
                    recording = false,
                    lastAiText = text,
                    statusMessage = "Speaking…",
                )
            }
            try {
                play()
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        statusMessage = "Voice failed — raise watch volume",
                    )
                }
                // Still continue so the demo doesn't die mid-convo
            }
            maybeAutoListen()
        }
    }

    private fun maybeAutoListen() {
        listenAfterSpeakJob?.cancel()
        listenAfterSpeakJob = viewModelScope.launch {
            delay(450)
            val s = _uiState.value
            if (!s.conversationLive) {
                _uiState.update { it.copy(statusMessage = statusFor(it)) }
                return@launch
            }
            if (s.mode == WatchMode.CARE && s.phase == "assessing") {
                _uiState.update { it.copy(statusMessage = statusFor(it)) }
                return@launch
            }
            if (s.mode == WatchMode.SOS &&
                (s.phase == "resolved" || s.phase == "idle")
            ) {
                return@launch
            }
            if (s.recording) return@launch
            startMicCaptureInternal(auto = true)
        }
    }

    private fun startMicCaptureInternal(auto: Boolean) {
        if (_uiState.value.recording) return
        if (!_uiState.value.conversationLive) return
        val ok = audio.startRecording()
        _uiState.update {
            it.copy(
                recording = ok,
                statusMessage = when {
                    !ok -> "Mic unavailable"
                    auto -> "Your turn — speak…"
                    else -> "Listening…"
                },
            )
        }
        if (ok) {
            autoStopMicJob?.cancel()
            autoStopMicJob = viewModelScope.launch {
                delay(7_000)
                if (_uiState.value.recording) {
                    stopMicCaptureInternal()
                }
            }
        }
    }

    private suspend fun stopMicCaptureInternal() {
        if (!_uiState.value.recording) return
        _uiState.update { it.copy(recording = false, statusMessage = "Sending…") }
        val b64 = withContext(Dispatchers.IO) {
            audio.stopRecordingToWavBase64()
        }
        if (b64 != null) {
            if (_uiState.value.mode == WatchMode.SOS) {
                emergency.sendAudio(b64, "audio/wav")
            } else {
                care.sendAudio(b64, "audio/wav")
            }
            _uiState.update { it.copy(statusMessage = "Thinking…") }
        } else {
            _uiState.update { it.copy(statusMessage = "Didn't catch that — speak again") }
            maybeAutoListen()
        }
    }

    private fun httpTriggerFall() {
        try {
            val origin = emergency.httpTriggerOrigin()
            val body = JSONObject()
                .put("trigger_type", "simulated_fall")
                .toString()
                .toRequestBody("application/json".toMediaType())
            val req = Request.Builder()
                .url("$origin/api/trigger")
                .post(body)
                .build()
            http.newCall(req).execute().use { /* fire and forget */ }
        } catch (_: Exception) {
        }
    }

    private fun cancelMicJobs() {
        autoStopMicJob?.cancel()
        autoStopMicJob = null
        listenAfterSpeakJob?.cancel()
        listenAfterSpeakJob = null
    }

    private fun isCareLive(phase: String): Boolean =
        phase != "idle" && phase != "complete"

    private fun isSosLive(state: String): Boolean =
        state != "idle" && state != "resolved"

    private fun statusFor(s: WatchUiState): String {
        if (s.measuringVitals) return "Measuring vitals…"
        if (s.recording) return "Your turn — speak…"
        if (s.mode == WatchMode.SOS) {
            return sosStatus(s.phase, s.recording, s.severity)
        }
        // Prefer showing last vitals briefly after measure while greeting starts
        if (!s.vitalsLine.isNullOrBlank() &&
            (s.phase == "greeting" || s.phase == "listening") &&
            !s.recording
        ) {
            return s.vitalsLine
        }
        return when (s.phase) {
            "idle" -> if (s.fallArmed) "Ally · I'm okay" else "Tap to talk"
            "complete" -> s.vitalsLine?.let { "Done · $it" } ?: "Check-in done"
            "greeting" -> "Greeting…"
            "listening" -> "Listening…"
            "clarifying" -> "Clarifying…"
            "assessing" -> "Wrapping up…"
            else -> s.phase.replaceFirstChar { it.uppercase() }
        }
    }

    private fun sosStatus(state: String, recording: Boolean, severity: String?): String {
        if (recording) return "Your turn — speak…"
        return when (state) {
            "listening" -> "SOS — are you OK?"
            "triaging" -> "Triaging…"
            "reassuring" -> "Staying with you…"
            "handoff_generated", "escalating" -> "Calling help…"
            "awaiting_handover" -> "Help on the way"
            "resolved" -> "Resolved"
            else -> "SOS${severity?.let { " · $it" } ?: ""}"
        }
    }
}
