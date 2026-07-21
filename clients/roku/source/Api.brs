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

' Splits comma- or newline-separated input into an ordered, de-duplicated
' list of normalised server addresses, most-preferred (first entered) kept
' first. Entries that fail NormaliseServerUrl (missing scheme, blank) are
' dropped rather than rejecting the whole list, so one bad address doesn't
' block the rest.
function NormaliseServerUrlList(value as String) as Object
    raw = value.Replace(Chr(13), Chr(10)).Replace(",", Chr(10))
    result = []
    for each line in raw.Split(Chr(10))
        candidate = NormaliseServerUrl(line)
        if candidate <> ""
            isDuplicate = false
            for each existing in result
                if existing = candidate then isDuplicate = true
            end for
            if not isDuplicate then result.Push(candidate)
        end if
    end for
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
