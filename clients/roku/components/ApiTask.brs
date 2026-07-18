sub init()
    m.top.functionName = "runRequest"
end sub

sub runRequest()
    request = m.top.request
    if request = invalid
        m.top.result = { ok: false, status: 0, error: "Missing request" }
        return
    end if

    transfer = CreateObject("roUrlTransfer")
    transfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    transfer.InitClientCertificates()
    transfer.SetUrl(request.url)
    transfer.RetainBodyOnError(true)

    headers = ClientHeaders(request.accessToken)
    if request.headers <> invalid
        for each name in request.headers
            headers[name] = request.headers[name]
        end for
    end if
    for each name in headers
        transfer.AddHeader(name, headers[name])
    end for

    port = CreateObject("roMessagePort")
    transfer.SetMessagePort(port)
    method = UCase(request.method)
    started = false
    if method = "GET"
        started = transfer.AsyncGetToString()
    else if method = "POST" or method = "PUT" or method = "PATCH"
        transfer.AddHeader("Content-Type", "application/json")
        started = transfer.AsyncPostFromString(FormatJson(request.body))
    else
        m.top.result = { ok: false, status: 0, error: "Unsupported HTTP method" }
        return
    end if

    if not started
        m.top.result = { ok: false, status: 0, error: "Could not start request" }
        return
    end if

    event = wait(30000, port)
    if event = invalid or type(event) <> "roUrlEvent"
        transfer.AsyncCancel()
        m.top.result = { ok: false, status: 0, error: "Request timed out" }
        return
    end if

    status = event.GetResponseCode()
    bodyText = event.GetString()
    data = invalid
    if bodyText <> "" then data = ParseJson(bodyText)
    if status >= 200 and status < 300
        m.top.result = { ok: true, status: status, data: data, body: bodyText }
    else
        errorMessage = "Request failed (" + status.ToStr() + ")"
        if data <> invalid and data.message <> invalid then errorMessage = data.message
        if data <> invalid and data.error <> invalid then errorMessage = data.error
        m.top.result = {
            ok: false
            status: status
            data: data
            body: bodyText
            error: errorMessage
        }
    end if
end sub
