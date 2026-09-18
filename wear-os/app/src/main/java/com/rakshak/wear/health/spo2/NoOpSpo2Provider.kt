package com.rakshak.wear.health.spo2

/** Compile-safe fallback when Samsung Health Sensor SDK is not packaged. */
class NoOpSpo2Provider : Spo2Provider {
    override suspend fun isAvailable(): Boolean = false

    override suspend fun measureOnDemand(timeoutMs: Long): Int? = null
}
