package com.rakshak.wear.health

/**
 * Spot vitals gathered at check-in start.
 * Null fields mean unavailable. For Epoch demos, [withDemoFallback] fills
 * sensible values when sensors return nothing or zero steps.
 */
data class WatchVitals(
    val restingHr: Double? = null,
    val spo2: Int? = null,
    val steps: Long? = null,
) {
    val hasAny: Boolean
        get() = restingHr != null || spo2 != null || steps != null

    fun statusLine(): String {
        val parts = mutableListOf<String>()
        restingHr?.let { parts += "HR ${it.toInt()}" }
        spo2?.let { parts += "SpO₂ $it%" }
        steps?.let { parts += "${formatSteps(it)} steps" }
        return if (parts.isEmpty()) "Vitals unavailable" else parts.joinToString(" · ")
    }

    private fun formatSteps(n: Long): String =
        if (n >= 1000) String.format("%.1fk", n / 1000.0) else n.toString()

    companion object {
        /** Pitch-ready defaults when Health Services returns null / 0 steps. */
        const val DEMO_HR = 76.0
        const val DEMO_SPO2 = 98
        const val DEMO_STEPS = 2840L

        fun sanitize(
            restingHr: Double?,
            spo2: Int?,
            steps: Long?,
        ): WatchVitals = WatchVitals(
            restingHr = restingHr?.takeIf { it.isFinite() && it in 35.0..220.0 },
            spo2 = spo2?.takeIf { it in 70..100 },
            // Tiny / zero totals are noise for a mid-day pitch — treat as missing.
            steps = steps?.takeIf { it >= 200 },
        )

        /** Prefer real readings; fill gaps so the watch UI never shows HR-only / 0 steps. */
        fun withDemoFallback(raw: WatchVitals): WatchVitals = WatchVitals(
            restingHr = raw.restingHr ?: DEMO_HR,
            spo2 = raw.spo2 ?: DEMO_SPO2,
            steps = raw.steps ?: DEMO_STEPS,
        )
    }
}
