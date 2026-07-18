function NormaliseServerUrl(value as String) as String
    result = value.Trim()
    while result.Len() > 0 and result.Right(1) = "/"
        result = result.Left(result.Len() - 1)
    end while
    if result.Left(7) <> "http://" and result.Left(8) <> "https://"
        return ""
    end if
    return result
end function

function AbsoluteUrl(baseUrl as String, value as String) as String
    if value.Left(7) = "http://" or value.Left(8) = "https://" then return value
    if value.Left(1) <> "/" then value = "/" + value
    return baseUrl + value
end function

function UrlEncode(value as String) as String
    transfer = CreateObject("roUrlTransfer")
    return transfer.Escape(value)
end function

function JsonString(value as Dynamic) as String
    if value = invalid then return ""
    if type(value) = "roString" or type(value) = "String" then return value
    return value.ToStr()
end function
