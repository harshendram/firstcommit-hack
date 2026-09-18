package com.rakshak.wear.health

import android.content.Context
import android.util.Log
import com.rakshak.wear.health.spo2.SamsungSpo2Provider
import com.rakshak.wear.health.spo2.Spo2Provider
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/**
 * Collects HR + steps + SpO₂ at check-in start. Any failure is swallowed —
 * check-in continues without that field.
 */
class VitalsCollector(
    context: Context,
    private val spo2Provider: Spo2Provider = SamsungSpo2Provider.create(context),
) {
    private val appContext = context.applicationContext
    private val heartRate = HeartRateReader(appContext)
    private val steps = StepsReader(appContext)

    suspend fun collect(
        hrTimeoutMs: Long = 12_000L,
        spo2TimeoutMs: Long = 25_000L,
        stepsTimeoutMs: Long = 5_000L,
    ): WatchVitals = coroutineScope {
        val hrJob = async {
            runCatching { heartRate.measureBpm(hrTimeoutMs) }
                .onFailure { Log.w(TAG, "HR failed: ${it.message}") }
                .getOrNull()
        }
        val stepsJob = async {
            runCatching { steps.readDailySteps(stepsTimeoutMs) }
                .onFailure { Log.w(TAG, "Steps failed: ${it.message}") }
                .getOrNull()
        }
        val spo2Job = async {
            runCatching {
                if (!spo2Provider.isAvailable()) null
                else spo2Provider.measureOnDemand(spo2TimeoutMs)
            }
                .onFailure { Log.w(TAG, "SpO2 failed: ${it.message}") }
                .getOrNull()
        }

        val vitals = WatchVitals.sanitize(
            restingHr = hrJob.await(),
            spo2 = spo2Job.await(),
            steps = stepsJob.await(),
        )
        Log.i(TAG, "Collected: ${vitals.statusLine()}")
        vitals
    }

    companion object {
        private const val TAG = "VitalsCollector"
    }
}
