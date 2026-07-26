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

' Percent-encodes a string for use in a URL query component. Deliberately
' avoids roUrlTransfer.Escape(): roUrlTransfer is a MAIN|TASK-only component
' and MainScene.brs (and therefore this function, when called from the
' pairing poll on the render thread) runs on the Scene render thread, where
' CreateObject("roUrlTransfer") fails at runtime.
function UrlEncode(value as String) as String
    unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~"
    result = ""
    for i = 0 to value.Len() - 1
        ch = value.Mid(i, 1)
        if unreserved.Instr(ch) >= 0
            result = result + ch
        else
            code = Asc(ch)
            hex = StrToHex(code)
            result = result + "%" + hex
        end if
    end for
    return result
end function

' Formats a byte value (0-255) as a two-digit uppercase hex string.
function StrToHex(value as Integer) as String
    digits = "0123456789ABCDEF"
    high = digits.Mid(Int(value / 16), 1)
    low = digits.Mid(value Mod 16, 1)
    return high + low
end function

function JsonString(value as Dynamic) as String
    if value = invalid then return ""
    if type(value) = "roString" or type(value) = "String" then return value
    return value.ToStr()
end function
