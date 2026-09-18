package com.rakshak.wear.health

import android.content.Context
import android.util.Log
import androidx.health.services.client.HealthServices
import androidx.health.services.client.MeasureCallback
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.DeltaDataType
import androidx.health.services.client.data.DataTypeAvailability
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

/**
 * Spot heart-rate via Health Services MeasureClient / HEART_RATE_BPM.
 */
class HeartRateReader(context: Context) {
    private val measureClient = HealthServices.getClient(context).measureClient

    suspend fun measureBpm(timeoutMs: Long = 12_000L): Double? {
        val supported = try {
            val caps = withContext(Dispatchers.IO) {
                measureClient.getCapabilitiesAsync().await()
            }
            DataType.HEART_RATE_BPM in caps.supportedDataTypesMeasure
        } catch (t: Throwable) {
            Log.w(TAG, "HR capabilities: ${t.message}")
            false
        }
        if (!supported) return null

        val samples = CopyOnWriteArrayList<Double>()

        val early = withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine { cont ->
                val done = AtomicBoolean(false)
                fun complete(value: Double?) {
                    if (!done.compareAndSet(false, true)) return
                    cont.resume(value)
                }

                val callback = object : MeasureCallback {
                    override fun onAvailabilityChanged(
                        dataType: DeltaDataType<*, *>,
                        availability: Availability,
                    ) {
                        if (availability == DataTypeAvailability.UNAVAILABLE_DEVICE_OFF_BODY) {
                            Log.i(TAG, "HR off-body")
                            unregister(this)
                            complete(null)
                        }
                    }

                    override fun onDataReceived(data: DataPointContainer) {
                        val points = data.getData(DataType.HEART_RATE_BPM)
                        for (p in points) {
                            val v = p.value.toDouble()
                            if (v in 35.0..220.0) samples += v
                        }
                        if (samples.size >= 5) {
                            unregister(this)
                            complete(median(samples.toList()))
                        }
                    }
                }

                try {
                    measureClient.registerMeasureCallback(DataType.HEART_RATE_BPM, callback)
                } catch (t: Throwable) {
                    Log.w(TAG, "register HR failed: ${t.message}")
                    complete(null)
                    return@suspendCancellableCoroutine
                }

                cont.invokeOnCancellation { unregister(callback) }
            }
        }

        // Prefer the early complete value; on timeout use whatever samples gathered.
        return early ?: median(samples.filter { it in 35.0..220.0 })
    }

    private fun unregister(callback: MeasureCallback) {
        try {
            measureClient.unregisterMeasureCallbackAsync(DataType.HEART_RATE_BPM, callback)
        } catch (_: Throwable) {
        }
    }

    private fun median(values: List<Double>): Double? {
        if (values.isEmpty()) return null
        val sorted = values.sorted()
        val mid = sorted.size / 2
        return if (sorted.size % 2 == 0) {
            (sorted[mid - 1] + sorted[mid]) / 2.0
        } else {
            sorted[mid]
        }
    }

    companion object {
        private const val TAG = "HeartRateReader"
    }
}
