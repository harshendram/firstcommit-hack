package com.rakshak.wear.health.spo2

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume

/**
 * Galaxy Watch SpO₂ via Samsung Health Sensor SDK (`SPO2_ON_DEMAND`).
 *
 * Uses reflection so the project compiles without the AAR. Drop
 * `samsung-health-sensor-api.aar` into `app/libs/` and enable Health Platform
 * **developer mode** on the watch for local demos.
 *
 * Docs: https://developer.samsung.com/health/sensor/guide/getting-started.html
 */
class SamsungSpo2Provider(private val context: Context) : Spo2Provider {
    override suspend fun isAvailable(): Boolean = withContext(Dispatchers.IO) {
        try {
            Class.forName(HEALTH_TRACKING_SERVICE)
            true
        } catch (_: Throwable) {
            false
        }
    }

    override suspend fun measureOnDemand(timeoutMs: Long): Int? {
        if (!isAvailable()) return null
        return withTimeoutOrNull(timeoutMs) {
            withContext(Dispatchers.IO) { measureBlocking(timeoutMs) }
        }
    }

    private suspend fun measureBlocking(timeoutMs: Long): Int? =
        suspendCancellableCoroutine { cont ->
            val settled = AtomicBoolean(false)
            fun finish(value: Int?) {
                if (!settled.compareAndSet(false, true)) return
                try {
                    cont.resume(value)
                } catch (_: Throwable) {
                }
            }

            val serviceRef = AtomicReference<Any?>(null)
            val trackerRef = AtomicReference<Any?>(null)

            fun cleanup() {
                try {
                    trackerRef.get()?.javaClass?.getMethod("unsetEventListener")
                        ?.invoke(trackerRef.get())
                } catch (_: Throwable) {
                }
                try {
                    serviceRef.get()?.javaClass?.getMethod("disconnectService")
                        ?.invoke(serviceRef.get())
                } catch (_: Throwable) {
                }
            }

            cont.invokeOnCancellation { cleanup() }

            try {
                val connectionListenerClass = Class.forName(CONNECTION_LISTENER)
                val connected = CountDownLatch(1)
                val connectFailed = AtomicBoolean(false)

                val connectionProxy = java.lang.reflect.Proxy.newProxyInstance(
                    connectionListenerClass.classLoader,
                    arrayOf(connectionListenerClass),
                ) { _, method, _ ->
                    when (method.name) {
                        "onConnectionSuccess" -> connected.countDown()
                        "onConnectionFailed", "onConnectionEnded" -> {
                            connectFailed.set(true)
                            connected.countDown()
                        }
                    }
                    null
                }

                val service = Class.forName(HEALTH_TRACKING_SERVICE)
                    .getConstructor(Context::class.java, connectionListenerClass)
                    .newInstance(context.applicationContext, connectionProxy)
                serviceRef.set(service)
                service.javaClass.getMethod("connectService").invoke(service)

                val waitMs = (timeoutMs * 0.4).toLong().coerceIn(2_000L, 8_000L)
                if (!connected.await(waitMs, TimeUnit.MILLISECONDS) || connectFailed.get()) {
                    Log.w(TAG, "HealthTrackingService connect failed/timeout")
                    cleanup()
                    finish(null)
                    return@suspendCancellableCoroutine
                }

                val trackerTypeClass = Class.forName(HEALTH_TRACKER_TYPE)
                @Suppress("UNCHECKED_CAST")
                val spo2Type = java.lang.Enum.valueOf(
                    trackerTypeClass as Class<out Enum<*>>,
                    "SPO2_ON_DEMAND",
                )

                val supported = try {
                    val cap = service.javaClass.getMethod("getTrackingCapability").invoke(service)
                    val list = cap.javaClass
                        .getMethod("getSupportHealthTrackerTypes")
                        .invoke(cap) as? List<*>
                    list?.any { it.toString().contains("SPO2") } == true
                } catch (_: Throwable) {
                    true
                }
                if (!supported) {
                    cleanup()
                    finish(null)
                    return@suspendCancellableCoroutine
                }

                val tracker = service.javaClass
                    .getMethod("getHealthTracker", trackerTypeClass)
                    .invoke(service, spo2Type)
                if (tracker == null) {
                    cleanup()
                    finish(null)
                    return@suspendCancellableCoroutine
                }
                trackerRef.set(tracker)

                val listenerClass = Class.forName(TRACKER_EVENT_LISTENER)
                val listenerProxy = java.lang.reflect.Proxy.newProxyInstance(
                    listenerClass.classLoader,
                    arrayOf(listenerClass),
                ) { _, method, args ->
                    when (method.name) {
                        "onDataReceived" -> {
                            val spo2 = extractSpo2(args?.getOrNull(0) as? List<*>)
                            if (spo2 != null) {
                                cleanup()
                                finish(spo2)
                            }
                        }
                        "onError" -> {
                            Log.w(TAG, "SpO2 tracker error: ${args?.getOrNull(0)}")
                            cleanup()
                            finish(null)
                        }
                    }
                    null
                }

                tracker.javaClass
                    .getMethod("setEventListener", listenerClass)
                    .invoke(tracker, listenerProxy)
            } catch (t: Throwable) {
                Log.w(TAG, "SpO2 setup failed: ${t.message}")
                cleanup()
                finish(null)
            }
        }

    private fun extractSpo2(points: List<*>?): Int? {
        if (points.isNullOrEmpty()) return null
        for (point in points) {
            if (point == null) continue
            try {
                val keyClass = Class.forName(VALUE_KEY_SPO2)
                val spo2Key = keyClass.getField("SPO2").get(null)
                val statusKey = keyClass.getField("STATUS").get(null)
                val getValue = point.javaClass.methods.firstOrNull {
                    it.name == "getValue" && it.parameterTypes.size == 1
                } ?: continue
                val status = getValue.invoke(point, statusKey)
                // Samsung status 2 ≈ MEASUREMENT_COMPLETED. Status 0 is often
                // an in-progress / empty sample whose SpO₂ field is still 0.
                val statusOk = when (status) {
                    is Number -> status.toInt() == 2
                    else -> false
                }
                val raw = getValue.invoke(point, spo2Key) as? Number ?: continue
                val v = raw.toInt()
                if (statusOk && v in 70..100) return v
            } catch (t: Throwable) {
                Log.w(TAG, "parse SpO2 point: ${t.message}")
            }
        }
        return null
    }

    companion object {
        private const val TAG = "SamsungSpo2"
        private const val HEALTH_TRACKING_SERVICE =
            "com.samsung.android.service.health.tracking.HealthTrackingService"
        private const val CONNECTION_LISTENER =
            "com.samsung.android.service.health.tracking.HealthTrackingService\$ConnectionListener"
        private const val HEALTH_TRACKER_TYPE =
            "com.samsung.android.service.health.tracking.data.HealthTrackerType"
        private const val TRACKER_EVENT_LISTENER =
            "com.samsung.android.service.health.tracking.HealthTracker\$TrackerEventListener"
        private const val VALUE_KEY_SPO2 =
            "com.samsung.android.service.health.tracking.data.ValueKey\$SpO2Set"

        fun create(context: Context): Spo2Provider {
            return try {
                Class.forName(HEALTH_TRACKING_SERVICE)
                SamsungSpo2Provider(context)
            } catch (_: Throwable) {
                NoOpSpo2Provider()
            }
        }
    }
}
