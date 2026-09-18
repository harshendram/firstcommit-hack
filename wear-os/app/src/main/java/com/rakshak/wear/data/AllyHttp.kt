package com.rakshak.wear.data

import android.util.Log
import com.rakshak.wear.BuildConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * HTTP client for the Ally API (`POST /ally/watch`). The watch authenticates with a device key
 * (stored in SSM on the server, `ally.deviceKey` in local.properties here).
 */
class AllyHttp(
    private val origin: String = BuildConfig.ALLY_API,
    private val deviceKey: String = BuildConfig.ALLY_DEVICE_KEY,
) {
    private val tag = "AllyHttp"
    private val http = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    /** kind: wake | activity | im_okay. Null readings are omitted rather than sent as zero. */
    fun postWatch(kind: String, steps: Int? = null, heartRate: Int? = null): Boolean {
        val json = JSONObject().put("kind", kind)
        steps?.takeIf { it > 0 }?.let { json.put("steps", it) }
        heartRate?.takeIf { it in 20..250 }?.let { json.put("heart_rate", it) }
        return post("/ally/watch", json.toString())
    }

    fun imOkay(): Boolean = postWatch("im_okay")

    private fun post(path: String, json: String): Boolean {
        repeat(2) { attempt ->
            try {
                val req = Request.Builder()
                    .url(origin.trimEnd('/') + path)
                    .header("X-Ally-Device-Key", deviceKey)
                    .post(json.toRequestBody("application/json".toMediaType()))
                    .build()
                http.newCall(req).execute().use { res ->
                    if (res.isSuccessful) return true
                    Log.w(tag, "POST $path failed: HTTP ${res.code}")
                    if (res.code in 400..499) return false
                }
            } catch (e: Exception) {
                Log.w(tag, "POST $path attempt ${attempt + 1} failed", e)
            }
        }
        return false
    }
}
