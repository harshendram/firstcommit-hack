package com.rakshak.wear.health

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import kotlin.math.sqrt

/**
 * Accelerometer fall / hard-drop detector for demo on Galaxy Watch.
 *
 * Fires when either:
 *  1) Free-fall (near-0g) followed by an impact spike — classic fall, or
 *  2) A hard impact after stillness — putting/dropping the watch onto a surface.
 *
 * Keep the Rakshak app open on the watch during the demo so sensors stay active.
 */
class FallDetector(
    context: Context,
    private val onFallDetected: () -> Unit,
) : SensorEventListener {

    private val sensorManager =
        context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val accelerometer: Sensor? =
        sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

    private val tag = "RakshakFall"

    @Volatile
    private var armed = true

    private var freeFallStartedAt = 0L
    private var inFreeFall = false
    private var lastImpactAt = 0L
    private var stillSince = 0L
    private var lastTriggerAt = 0L

    fun start() {
        val sensor = accelerometer
        if (sensor == null) {
            Log.e(tag, "No accelerometer on this device")
            return
        }
        sensorManager.registerListener(
            this,
            sensor,
            SensorManager.SENSOR_DELAY_GAME,
        )
        Log.i(tag, "Accelerometer fall detection armed")
    }

    fun stop() {
        sensorManager.unregisterListener(this)
        Log.i(tag, "Fall detection stopped")
    }

    /** Call after a session ends so another drop can fire again. */
    fun rearm() {
        armed = true
        Log.i(tag, "Fall detection re-armed")
    }

    /** Disarm while a session is already running. */
    fun disarm() {
        armed = false
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    override fun onSensorChanged(event: SensorEvent?) {
        if (!armed || event == null || event.sensor.type != Sensor.TYPE_ACCELEROMETER) {
            return
        }

        val now = System.currentTimeMillis()
        if (now - lastTriggerAt < COOLDOWN_MS) return

        val x = event.values[0]
        val y = event.values[1]
        val z = event.values[2]
        val mag = sqrt(x * x + y * y + z * z)

        // --- Free-fall phase (weightlessness) ---
        if (mag < FREE_FALL_MAX_G) {
            if (!inFreeFall) {
                inFreeFall = true
                freeFallStartedAt = now
            }
        } else if (inFreeFall) {
            val freeFallMs = now - freeFallStartedAt
            inFreeFall = false
            if (freeFallMs >= FREE_FALL_MIN_MS && mag > IMPACT_AFTER_FALL_G) {
                Log.i(tag, "Fall pattern: freefall ${freeFallMs}ms → impact ${"%.1f".format(mag)} m/s²")
                fire(now)
                return
            }
        }

        // --- Hard put-down / drop onto surface (no clear freefall needed) ---
        if (mag < STILL_MAX_G) {
            if (stillSince == 0L) stillSince = now
        } else if (mag > HARD_IMPACT_G) {
            val wasStillLongEnough =
                stillSince > 0L && (now - stillSince) >= STILL_BEFORE_IMPACT_MS
            val notDoubleBounce = now - lastImpactAt > 400L
            if (wasStillLongEnough && notDoubleBounce) {
                Log.i(tag, "Hard impact after stillness: ${"%.1f".format(mag)} m/s²")
                fire(now)
            }
            stillSince = 0L
            lastImpactAt = now
        } else {
            // Moving / waving — reset stillness window
            if (mag > MOVING_G) stillSince = 0L
        }
    }

    private fun fire(now: Long) {
        lastTriggerAt = now
        armed = false
        inFreeFall = false
        stillSince = 0L
        onFallDetected()
    }

    companion object {
        private const val COOLDOWN_MS = 20_000L

        /** Near weightlessness (Earth gravity ≈ 9.8). */
        private const val FREE_FALL_MAX_G = 3.0f
        private const val FREE_FALL_MIN_MS = 80L
        private const val IMPACT_AFTER_FALL_G = 18.0f

        /** Holding still on wrist / table before a drop. */
        private const val STILL_MAX_G = 11.5f
        private const val STILL_BEFORE_IMPACT_MS = 400L
        private const val MOVING_G = 14.0f

        /**
         * Firm put-down / drop onto a desk.
         * Tuned so a deliberate drop from ~20–40 cm fires; casual taps usually won't.
         */
        private const val HARD_IMPACT_G = 20.0f
    }
}
