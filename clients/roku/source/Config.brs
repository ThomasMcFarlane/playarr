function AppConfig() as Object
    return {
        clientName: "Playarr for Roku"
        clientVersion: "0.1.0"
        ' Compatibility identity until Playarr Server's closed ClientPlatform enum
        ' gains tv-roku. Keep this value aligned with backend/openapi.
        clientPlatform: "web"
        catalogPageSize: 50
        libraryPageSize: 200
        maxBitrateBps: 20000000
        ' The same hosted TV-linking service tv-webos/tv-tizen already use to
        ' bootstrap onto a Playarr Server before they know its address --
        ' see clients/tv-web/web/worker.js and hostedDeviceLink.ts.
        hostedLinkOrigin: "https://playarr.app"
    }
end function

function ClientHeaders(accessToken = invalid as Dynamic) as Object
    config = AppConfig()
    headers = {
        "Accept": "application/json"
        "X-Playarr-Client-Platform": config.clientPlatform
        "X-Playarr-Client-Version": config.clientVersion
    }
    if accessToken <> invalid and accessToken <> ""
        headers["Authorization"] = "Bearer " + accessToken
    end if
    return headers
end function

function ClientContentHeaders(accessToken as String) as Object
    config = AppConfig()
    headers = [
        "X-Playarr-Client-Platform:" + config.clientPlatform
        "X-Playarr-Client-Version:" + config.clientVersion
    ]
    if accessToken <> ""
        headers.Push("Authorization:Bearer " + accessToken)
    end if
    return headers
end function
