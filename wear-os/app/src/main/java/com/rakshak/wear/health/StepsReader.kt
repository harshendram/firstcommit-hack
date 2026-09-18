package com.rakshak.wear.health

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import androidx.health.services.client.HealthServices
import androidx.health.services.client.PassiveListenerCallback
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.PassiveListenerConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

/**
 * Today's step count via Health Services PassiveMonitoring [DataType.STEPS_DAILY],
 * with TYPE_STEP_COUNTER fallback when passive capabilities are missing.
 */
class StepsReader(private val context: Context) {
    private val passiveClient = HealthServices.getClient(context).passiveMonitoringClient

    suspend fun readDailySteps(timeoutMs: Long = 5_000L): Long? {
        val fromHs = readViaHealthServices(timeoutMs)
        if (fromHs != null) return fromHs
        return readViaStepCounter(timeoutMs.coerceAtMost(2_500L))
    }

    private suspend fun readViaHealthServices(timeoutMs: Long): Long? {
        val supported = try {
            val caps = withContext(Dispatchers.IO) { passiveClient.getCapabilitiesAsync().await() }
            DataType.STEPS_DAILY in caps.supportedDataTypesPassiveMonitoring
        } catch (t: Throwable) {
            Log.w(TAG, "steps capabilities: ${t.message}")
            false
        }
        if (!supported) return null

        return withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine { cont ->
                val done = AtomicBoolean(false)
                fun finish(v: Long?) {
                    if (!done.compareAndSet(false, true)) return
                    clearCallback()
                    cont.resume(v)
                }

                val callback = object : PassiveListenerCallback {
                    override fun onNewDataPointsReceived(dataPoints: DataPointContainer) {
                        val deltas = dataPoints.getData(DataType.STEPS_DAILY)
                        val total = deltas.maxOfOrNull { it.value.toLong() }
                        if (total != null && total >= 0) finish(total)
                    }
                }

                val config = PassiveListenerConfig.builder()
                    .setDataTypes(setOf(DataType.STEPS_DAILY))
                    .build()

                try {
                    passiveClient.setPassiveListenerCallback(config, callback)
                } catch (t: Throwable) {
                    Log.w(TAG, "setPassiveListenerCallback: ${t.message}")
                    cont.resume(null)
                    return@suspendCancellableCoroutine
                }

                cont.invokeOnCancellation { clearCallback() }
            }
        }
    }

    private fun clearCallback() {
        try {
            passiveClient.clearPassiveListenerCallbackAsync()
        } catch (_: Throwable) {
        }
    }

    /** Last-resort: hardware step counter (since boot — only used if HS fails). */
    private suspend fun readViaStepCounter(timeoutMs: Long): Long? {
        val sm = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return null
        val sensor = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) ?: return null
        return withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine { cont ->
                val done = AtomicBoolean(false)
                val listener = object : SensorEventListener {
                    override fun onSensorChanged(event: SensorEvent?) {
                        val v = event?.values?.firstOrNull()?.toLong() ?: return
                        if (done.compareAndSet(false, true)) {
                            sm.unregisterListener(this)
                            cont.resume(v.coerceAtLeast(0))
                        }
                    }

                    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
                }
                sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)
                cont.invokeOnCancellation {
                    sm.unregisterListener(listener)
                }
            }
        }
    }

    companion object {
        private const val TAG = "StepsReader"
    }
}
