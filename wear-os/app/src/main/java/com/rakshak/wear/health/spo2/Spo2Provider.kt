package com.rakshak.wear.health.spo2

/**
 * On-demand SpO₂. Implementations must return null on failure —
 * never fabricate a saturation percentage.
 */
interface Spo2Provider {
    /** True when the device/SDK can attempt a measurement. */
    suspend fun isAvailable(): Boolean

    /**
     * Run a single on-demand reading (warm-up + sample).
     * Returns null on timeout, off-wrist, missing capability, or SDK errors.
     */
    suspend fun measureOnDemand(timeoutMs: Long = 25_000L): Int?
}
