package io.streamarr.shared.auth.remote

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit

/**
 * Builds a [DeviceAuthApi] pointed at a Streamarr server. Separate from
 * `core-data`'s `StreamarrHttpClient` on purpose: device pairing happens
 * before any access token exists, so this client carries no
 * `Authorization` interceptor (there's nothing to attach yet) and has no
 * dependency on `core-data` at all -- `tv-android` can complete pairing
 * with only `core-auth` on its classpath.
 */
object AuthHttpClient {

    fun create(baseUrl: String, enableHttpLogging: Boolean = false): DeviceAuthApi {
        val json = Json { ignoreUnknownKeys = true }

        val okHttpClient = OkHttpClient.Builder()
            .apply {
                if (enableHttpLogging) {
                    addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BODY })
                }
            }
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()

        return retrofit.create(DeviceAuthApi::class.java)
    }
}
