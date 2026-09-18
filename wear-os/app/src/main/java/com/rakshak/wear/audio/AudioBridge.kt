package com.rakshak.wear.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.util.Base64
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

/**
 * Mic capture (PCM16 → WAV) and TTS playback for the watch.
 */
class AudioBridge(private val context: Context) {
    private val tag = "RakshakAudio"
    private val audioManager =
        context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    private var recorder: AudioRecord? = null
    @Volatile
    private var recording = false
    private var captureThread: Thread? = null
    private val pcm = ByteArrayOutputStream()

    fun startRecording(): Boolean {
        if (recording) return false
        val sampleRate = 16_000
        val channel = AudioFormat.CHANNEL_IN_MONO
        val encoding = AudioFormat.ENCODING_PCM_16BIT
        val minBuf = AudioRecord.getMinBufferSize(sampleRate, channel, encoding)
        if (minBuf <= 0) {
            Log.e(tag, "getMinBufferSize failed: $minBuf")
            return false
        }

        val record = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                sampleRate,
                channel,
                encoding,
                minBuf * 2,
            )
        } catch (e: SecurityException) {
            Log.e(tag, "RECORD_AUDIO not granted", e)
            return false
        }

        if (record.state != AudioRecord.STATE_INITIALIZED) {
            record.release()
            return false
        }

        synchronized(pcm) {
            pcm.reset()
        }
        recorder = record
        recording = true
        record.startRecording()

        captureThread = Thread({
            val buf = ByteArray(minBuf.coerceAtLeast(2048))
            while (recording) {
                val n = try {
                    record.read(buf, 0, buf.size)
                } catch (_: Exception) {
                    break
                }
                if (n > 0) {
                    synchronized(pcm) {
                        pcm.write(buf, 0, n)
                    }
                } else if (n < 0) {
                    Log.w(tag, "AudioRecord.read error: $n")
                    break
                }
            }
        }, "rakshak-mic").also {
            it.isDaemon = true
            it.start()
        }
        return true
    }

    fun stopRecordingToWavBase64(): String? {
        if (!recording && recorder == null) return null
        recording = false
        val record = recorder
        recorder = null
        try {
            record?.stop()
        } catch (_: Exception) {
        }
        val thread = captureThread
        captureThread = null
        try {
            thread?.join(500)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
        try {
            record?.release()
        } catch (_: Exception) {
        }

        val pcmBytes = synchronized(pcm) {
            val bytes = pcm.toByteArray()
            pcm.reset()
            bytes
        }
        if (pcmBytes.isEmpty()) return null
        val wav = pcm16ToWav(pcmBytes, 16_000)
        return Base64.encodeToString(wav, Base64.NO_WRAP)
    }

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    suspend fun playBase64Wav(base64: String) = withContext(Dispatchers.IO) {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        playAudioBytes(bytes, "wav")
    }

    /** Fetch TTS over HTTP (preferred on Wear — keeps WS frames small). */
    suspend fun playUrl(url: String) = withContext(Dispatchers.IO) {
        Log.i(tag, "Fetching TTS $url")
        val request = Request.Builder().url(url).get().build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IllegalStateException("TTS HTTP ${response.code}")
            }
            val bytes = response.body?.bytes()
                ?: throw IllegalStateException("TTS empty body")
            val ext = when {
                url.contains(".mp3", ignoreCase = true) -> "mp3"
                else -> "wav"
            }
            Log.i(tag, "TTS fetched ${bytes.size} bytes → play")
            playAudioBytes(bytes, ext)
        }
    }

    private fun playAudioBytes(bytes: ByteArray, ext: String) {
        if (bytes.isEmpty()) throw IllegalStateException("TTS empty")

        // Drive STREAM_MUSIC to max — Galaxy Watch often leaves media near mute,
        // and USAGE_ASSISTANT was routing onto a quieter stream than media.
        try {
            val max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            if (max > 0) {
                audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, max, 0)
            }
        } catch (e: Exception) {
            Log.w(tag, "Could not bump media volume", e)
        }

        val file = File(context.cacheDir, "rakshak_tts.$ext")
        FileOutputStream(file).use { it.write(bytes) }

        // Prefer MEDIA (loud, matches STREAM_MUSIC). Fall back to ASSISTANT
        // only if media attrs fail on a given Wear build.
        val attempts = listOf(
            AudioAttributes.USAGE_MEDIA to "media",
            AudioAttributes.USAGE_ASSISTANT to "assistant",
        )
        var lastError: Exception? = null
        for ((usage, label) in attempts) {
            val player = MediaPlayer()
            try {
                player.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(usage)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                player.setVolume(1f, 1f)
                player.setDataSource(file.absolutePath)
                player.prepare()
                player.start()
                val deadline = System.currentTimeMillis() + 60_000
                while (player.isPlaying && System.currentTimeMillis() < deadline) {
                    Thread.sleep(50)
                }
                Log.i(tag, "TTS playback finished ($label attrs)")
                return
            } catch (e: Exception) {
                lastError = e
                Log.e(tag, "TTS playback failed ($label attrs)", e)
            } finally {
                try {
                    player.release()
                } catch (_: Exception) {
                }
            }
        }
        throw IllegalStateException(
            "TTS play failed: ${lastError?.message}",
            lastError,
        )
    }

    private fun pcm16ToWav(pcm: ByteArray, sampleRate: Int): ByteArray {
        val channels = 1
        val byteRate = sampleRate * channels * 2
        val out = ByteArrayOutputStream()
        fun writeInt(v: Int) {
            out.write(v and 0xff)
            out.write(v shr 8 and 0xff)
            out.write(v shr 16 and 0xff)
            out.write(v shr 24 and 0xff)
        }
        fun writeShort(v: Int) {
            out.write(v and 0xff)
            out.write(v shr 8 and 0xff)
        }
        out.write("RIFF".toByteArray())
        writeInt(36 + pcm.size)
        out.write("WAVE".toByteArray())
        out.write("fmt ".toByteArray())
        writeInt(16)
        writeShort(1)
        writeShort(channels)
        writeInt(sampleRate)
        writeInt(byteRate)
        writeShort(channels * 2)
        writeShort(16)
        out.write("data".toByteArray())
        writeInt(pcm.size)
        out.write(pcm)
        return out.toByteArray()
    }
}
