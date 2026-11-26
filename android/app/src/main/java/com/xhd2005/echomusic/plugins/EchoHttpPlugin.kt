package com.xhd2005.echomusic.plugins

import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

@CapacitorPlugin(name = "EchoHttp")
class EchoHttpPlugin : Plugin() {

    private val baseClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    private val activeCalls = ConcurrentHashMap<String, Call>()

    @PluginMethod
    fun request(call: PluginCall) {
        val url = call.getString("url")?.trim()
        if (url.isNullOrEmpty()) {
            call.reject("Missing url")
            return
        }
        val method = (call.getString("method") ?: "GET").uppercase()
        val requestId = call.getString("requestId")
        val headersObj = call.getObject("headers")
        val bodyStr = call.getString("body")
        val bodyEncoding = call.getString("bodyEncoding") ?: "utf8"
        val responseType = call.getString("responseType") ?: "text"
        val connectTimeoutMs = (call.getInt("connectTimeoutMs") ?: 12000).coerceIn(1000, 60000)
        val readTimeoutMs = (call.getInt("readTimeoutMs") ?: 15000).coerceIn(1000, 120000)
        val followRedirects = call.getBoolean("followRedirects", true) ?: true

        val client = baseClient.newBuilder()
            .connectTimeout(connectTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .readTimeout(readTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .followRedirects(followRedirects)
            .followSslRedirects(followRedirects)
            .build()

        val reqBuilder = Request.Builder().url(url)
        var contentTypeHeader: String? = null
        if (headersObj != null) {
            val keys = headersObj.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                if (headersObj.isNull(key)) continue
                val value = headersObj.optString(key, "")
                if (key.equals("content-type", ignoreCase = true)) {
                    contentTypeHeader = value
                }
                reqBuilder.header(key, value)
            }
        }

        val requestBody = if (method != "GET" && method != "HEAD") {
            val mediaType = (contentTypeHeader ?: "application/octet-stream").toMediaTypeOrNull()
            val bytes = when {
                bodyStr == null -> ByteArray(0)
                bodyEncoding == "base64" -> Base64.decode(bodyStr, Base64.DEFAULT)
                else -> bodyStr.toByteArray(Charsets.UTF_8)
            }
            bytes.toRequestBody(mediaType)
        } else {
            null
        }

        try {
            reqBuilder.method(method, requestBody)
        } catch (e: IllegalArgumentException) {
            call.reject("Invalid HTTP method: ${e.message}", e)
            return
        }

        val okCall = client.newCall(reqBuilder.build())
        if (!requestId.isNullOrEmpty()) {
            activeCalls[requestId] = okCall
        }

        okCall.enqueue(object : okhttp3.Callback {
            override fun onFailure(c: Call, e: IOException) {
                if (!requestId.isNullOrEmpty()) activeCalls.remove(requestId)
                call.reject(e.message ?: "Network request failed", e)
            }

            override fun onResponse(c: Call, response: okhttp3.Response) {
                if (!requestId.isNullOrEmpty()) activeCalls.remove(requestId)
                response.use { res ->
                    try {
                        val respHeaders = JSObject()
                        for (name in res.headers.names()) {
                            respHeaders.put(name.lowercase(), res.header(name) ?: "")
                        }
                        val setCookies = JSArray()
                        for (cookie in res.headers.values("Set-Cookie")) {
                            setCookies.put(cookie)
                        }

                        val rawBytes = res.body?.bytes() ?: ByteArray(0)
                        val result = JSObject()
                        result.put("status", res.code)
                        result.put("url", res.request.url.toString())
                        result.put("headers", respHeaders)
                        result.put("setCookies", setCookies)

                        if (responseType == "base64") {
                            result.put("body", Base64.encodeToString(rawBytes, Base64.NO_WRAP))
                            result.put("bodyEncoding", "base64")
                        } else {
                            result.put("body", String(rawBytes, Charsets.UTF_8))
                            result.put("bodyEncoding", "utf8")
                        }
                        call.resolve(result)
                    } catch (e: Exception) {
                        call.reject("Failed to read response: ${e.message}", e)
                    }
                }
            }
        })
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        val requestId = call.getString("requestId")
        if (!requestId.isNullOrEmpty()) {
            activeCalls.remove(requestId)?.cancel()
        }
        call.resolve()
    }

    companion object {
        fun extractHeaderValues(pairs: List<Pair<String, String>>, target: String): List<String> {
            return pairs.filter { it.first.equals(target, ignoreCase = true) }.map { it.second }
        }
    }
}
