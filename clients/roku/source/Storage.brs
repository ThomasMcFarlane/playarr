function SessionRegistry() as Object
    return CreateObject("roRegistrySection", "playarr.session")
end function

function LoadSession() as Object
    section = SessionRegistry()
    return {
        serverUrl: section.Read("server_url")
        accessToken: section.Read("access_token")
        refreshToken: section.Read("refresh_token")
        deviceId: section.Read("device_id")
        profileName: section.Read("profile_name")
    }
end function

sub SaveServerUrl(serverUrl as String)
    section = SessionRegistry()
    section.Write("server_url", serverUrl)
    section.Flush()
end sub

sub SaveTokens(accessToken as String, refreshToken as String, deviceId as String)
    section = SessionRegistry()
    section.Write("access_token", accessToken)
    section.Write("refresh_token", refreshToken)
    section.Write("device_id", deviceId)
    section.Flush()
end sub

sub SaveProfileName(profileName as String)
    section = SessionRegistry()
    section.Write("profile_name", profileName)
    section.Flush()
end sub

sub ClearSession(keepServer = true as Boolean)
    section = SessionRegistry()
    serverUrl = section.Read("server_url")
    section.Delete("access_token")
    section.Delete("refresh_token")
    section.Delete("device_id")
    section.Delete("profile_name")
    if not keepServer
        section.Delete("server_url")
    else if serverUrl <> ""
        section.Write("server_url", serverUrl)
    end if
    section.Flush()
end sub

function DecodeJwtDeviceId(token as String) as String
    pieces = token.Split(".")
    if pieces.Count() < 2 then return ""

    payload = pieces[1].Replace("-", "+").Replace("_", "/")
    while payload.Len() mod 4 <> 0
        payload += "="
    end while

    bytes = CreateObject("roByteArray")
    bytes.FromBase64String(payload)
    if bytes.Count() = 0 then return ""
    claims = ParseJson(bytes.ToAsciiString())
    if claims = invalid or claims.device_id = invalid then return ""
    return claims.device_id
end function
