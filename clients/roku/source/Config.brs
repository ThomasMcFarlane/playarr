function AppConfig() as Object
    return {
        clientName: "Playarr for Roku"
        clientVersion: "0.1.0"
        ' Compatibility identity until Streamarr's closed ClientPlatform enum
        ' gains tv-roku. Keep this value aligned with backend/openapi.
        clientPlatform: "web"
        catalogPageSize: 50
        maxBitrateBps: 20000000
    }
end function

function ClientHeaders(accessToken = invalid as Dynamic) as Object
    config = AppConfig()
    headers = {
        "Accept": "application/json"
        "X-Streamarr-Client-Platform": config.clientPlatform
        "X-Streamarr-Client-Version": config.clientVersion
    }
    if accessToken <> invalid and accessToken <> ""
        headers["Authorization"] = "Bearer " + accessToken
    end if
    return headers
end function

function ClientContentHeaders(accessToken as String) as Object
    config = AppConfig()
    headers = [
        "X-Streamarr-Client-Platform:" + config.clientPlatform
        "X-Streamarr-Client-Version:" + config.clientVersion
    ]
    if accessToken <> ""
        headers.Push("Authorization:Bearer " + accessToken)
    end if
    return headers
end function
