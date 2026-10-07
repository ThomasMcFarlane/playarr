function SessionRegistry() as Object
    return CreateObject("roRegistrySection", "playarr.session")
end function

function LoadSession() as Object
    section = SessionRegistry()
    serverAddresses = LoadServerAddresses()
    primaryServerUrl = ""
    if serverAddresses.Count() > 0 then primaryServerUrl = serverAddresses[0]
    return {
        serverUrl: primaryServerUrl
        serverUrls: serverAddresses
        accessToken: section.Read("access_token")
        refreshToken: section.Read("refresh_token")
        deviceId: section.Read("device_id")
        profileName: section.Read("profile_name")
        directPairing: section.Read("direct_pairing") = "1"
    }
end function

' Returns the remembered server addresses as an ordered list, most-preferred
' (i.e. most recently saved) first. Falls back to the legacy single
' "server_url" value for sessions saved before the multi-address list
' existed, so upgrading never loses a remembered server.
function LoadServerAddresses() as Object
    section = SessionRegistry()
    addresses = []
    stored = section.Read("server_urls")
    if stored <> ""
        parsed = ParseJson(stored)
        if parsed <> invalid and type(parsed) = "roArray"
            for each address in parsed
                if address <> "" then addresses.Push(address)
            end for
        end if
    end if
    if addresses.Count() = 0
        legacy = section.Read("server_url")
        if legacy <> "" then addresses.Push(legacy)
    end if
    return addresses
end function

' Persists an ordered list of server addresses to try, most-preferred
' first, de-duplicated. Keeps the legacy single "server_url" key in sync
' (the first address) so ClearSession's keepServer branch keeps working
' unchanged.
sub SaveServerAddresses(addresses as Object)
    section = SessionRegistry()
    unique = []
    for each address in addresses
        if address <> ""
            isDuplicate = false
            for each existing in unique
                if existing = address then isDuplicate = true
            end for
            if not isDuplicate then unique.Push(address)
        end if
    end for
    section.Write("server_urls", FormatJson(unique))
    if unique.Count() > 0
        section.Write("server_url", unique[0])
    else
        section.Write("server_url", "")
    end if
    section.Flush()
end sub

sub SaveTokens(accessToken as String, refreshToken as String, deviceId as String)
    section = SessionRegistry()
    section.Write("access_token", accessToken)
    section.Write("refresh_token", refreshToken)
    section.Write("device_id", deviceId)
    section.Flush()
end sub

' Remembers that the viewer typed their own server address (instead of using
' the hosted broker), so a later re-pair goes to that server directly.
sub SaveDirectPairing(direct as Boolean)
    section = SessionRegistry()
    if direct
        section.Write("direct_pairing", "1")
    else
        section.Delete("direct_pairing")
    end if
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
    serverUrls = section.Read("server_urls")
    section.Delete("access_token")
    section.Delete("refresh_token")
    section.Delete("device_id")
    section.Delete("profile_name")
    if not keepServer
        section.Delete("server_url")
        section.Delete("server_urls")
        section.Delete("direct_pairing")
    else
        if serverUrl <> "" then section.Write("server_url", serverUrl)
        if serverUrls <> "" then section.Write("server_urls", serverUrls)
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
