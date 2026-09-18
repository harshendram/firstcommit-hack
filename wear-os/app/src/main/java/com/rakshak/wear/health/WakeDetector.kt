package com.rakshak.wear.health

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import java.time.LocalDate
import kotlin.math.sqrt

/**
 * First-movement-of-day: accelerometer activity after a period of stillness.
 * Proxy for "got out of bed" — Ally's quiet edge signal.
 */
class WakeDetector(
    context: Context,
    private val onFirstMovement: () -> Unit,
) : SensorEventListener {

    private val sensorManager =
        context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val accelerometer: Sensor? =
        sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

    private val tag = "AllyWake"
    private var stillSince = 0L
    private var fired = false
    private var firedOn: LocalDate? = null
    private var lastMag = 9.8f

    fun start() {
        val sensor = accelerometer ?: return
        sensorManager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_NORMAL)
        stillSince = System.currentTimeMillis()
        Log.i(tag, "First-movement detector armed")
    }

    fun stop() {
        sensorManager.unregisterListener(this)
    }

    fun resetForNewDay() {
        fired = false
        stillSince = System.currentTimeMillis()
    }

    override fun onSensorChanged(event: SensorEvent) {
        val x = event.values[0]
        val y = event.values[1]
        val z = event.values[2]
        val mag = sqrt(x * x + y * y + z * z)
        val delta = kotlin.math.abs(mag - lastMag)
        lastMag = mag
        val now = System.currentTimeMillis()
        if (fired && firedOn != LocalDate.now()) resetForNewDay() // a new local day: arm again
        if (delta < 0.4f) {
            if (stillSince == 0L) stillSince = now
            return
        }
        val stillMs = if (stillSince == 0L) 0 else now - stillSince
        stillSince = 0L
        if (!fired && stillMs >= 8_000 && delta > 1.6f) {
            fired = true
            firedOn = LocalDate.now()
            Log.i(tag, "First movement after ${stillMs}ms stillness")
            onFirstMovement()
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
}
