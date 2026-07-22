package io.streamarr.shared.auth

import io.streamarr.shared.auth.model.ClientPlatform
import io.streamarr.shared.auth.model.DeviceCodeRequest
import io.streamarr.shared.auth.model.DeviceCodeResponse
import io.streamarr.shared.auth.model.DevicePollResult
import io.streamarr.shared.auth.model.DeviceTokenRequest
import io.streamarr.shared.auth.model.TokenResponse
import io.streamarr.shared.auth.remote.DeviceAuthApi
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Response

/**
 * Exercises [DeviceAuthClient.pollOnce]'s mapping from the real RFC 8628
 * error codes in `backend/openapi/streamarr.yaml`'s `OAuthErrorBody` to
 * [DevicePollResult], against a hand-written fake [DeviceAuthApi] (no
 * MockWebServer/live network needed -- this is exactly the branch that
 * can't be exercised against a live server in this environment).
 */
class DeviceAuthClientTest {

    @Test
    fun `device token wire body always includes the required grant type`() {
        val body = DeviceTokenRequest(
            deviceCode = "device-code",
            grantType = DeviceTokenRequest.DEVICE_CODE_GRANT_TYPE,
        )
        val encoded = Json.parseToJsonElement(Json.encodeToString(body)).jsonObject

        assertEquals("device-code", encoded.getValue("device_code").jsonPrimitive.content)
        assertEquals(
            DeviceTokenRequest.DEVICE_CODE_GRANT_TYPE,
            encoded.getValue("grant_type").jsonPrimitive.content,
        )
    }

    private fun errorResponse(code: String): Response<TokenResponse> = Response.error(
        400,
        """{"error": "$code"}""".toResponseBody("application/json".toMediaType()),
    )

    private fun clientReturning(response: Response<TokenResponse>): DeviceAuthClient {
        val fakeApi = object : DeviceAuthApi {
            override suspend fun requestDeviceCode(body: DeviceCodeRequest): DeviceCodeResponse =
                error("not exercised in this test")

            override suspend fun pollForToken(body: DeviceTokenRequest): Response<TokenResponse> = response
        }
        return DeviceAuthClient(fakeApi)
    }

    @Test
    fun `authorization_pending maps to AuthorizationPending`() = runBlocking {
        val result = clientReturning(errorResponse("authorization_pending")).pollOnce("device-code")
        assertEquals(DevicePollResult.AuthorizationPending, result)
    }

    @Test
    fun `slow_down maps to SlowDown`() = runBlocking {
        val result = clientReturning(errorResponse("slow_down")).pollOnce("device-code")
        assertEquals(DevicePollResult.SlowDown, result)
    }

    @Test
    fun `expired_token maps to Expired`() = runBlocking {
        val result = clientReturning(errorResponse("expired_token")).pollOnce("device-code")
        assertEquals(DevicePollResult.Expired, result)
    }

    @Test
    fun `access_denied maps to Denied`() = runBlocking {
        val result = clientReturning(errorResponse("access_denied")).pollOnce("device-code")
        assertEquals(DevicePollResult.Denied, result)
    }

    @Test
    fun `unsupported_grant_type falls through to Failed rather than crashing`() = runBlocking {
        val result = clientReturning(errorResponse("unsupported_grant_type")).pollOnce("device-code")
        assertTrue(result is DevicePollResult.Failed)
        assertEquals("unsupported_grant_type", (result as DevicePollResult.Failed).message)
    }

    @Test
    fun `a 200 response maps to Approved with the decoded token`() = runBlocking {
        val token = TokenResponse(accessToken = "a", refreshToken = "r", tokenType = "Bearer", expiresIn = 900)
        val result = clientReturning(Response.success(token)).pollOnce("device-code")
        assertTrue(result is DevicePollResult.Approved)
        assertEquals(token, (result as DevicePollResult.Approved).token)
    }

    @Test
    fun `requestDeviceCode sends the client platform in the body, not a free-form client id`() = runBlocking {
        var capturedBody: DeviceCodeRequest? = null
        val fakeApi = object : DeviceAuthApi {
            override suspend fun requestDeviceCode(body: DeviceCodeRequest): DeviceCodeResponse {
                capturedBody = body
                return DeviceCodeResponse(
                    deviceCode = "d", userCode = "ABCD-EFGH", verificationUri = "https://example.com/link",
                    verificationUriComplete = "https://example.com/link?code=ABCD-EFGH", expiresIn = 600, interval = 5,
                )
            }

            override suspend fun pollForToken(body: DeviceTokenRequest): Response<TokenResponse> = error("not exercised")
        }

        DeviceAuthClient(fakeApi).requestDeviceCode(ClientPlatform.AndroidTv)

        assertEquals(ClientPlatform.AndroidTv, capturedBody?.clientPlatform)
    }
}
