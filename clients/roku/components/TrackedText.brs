' TrackedText.brs: see TrackedText.xml.

sub init()
    m.measure = m.top.findNode("measure")
    m.pool = []
    m.used = 0
end sub

sub onSpecChange()
    spec = m.top.spec
    if spec = invalid or spec.text = invalid then return
    text = spec.text
    if spec.upper = true then text = UCase(text)
    size = spec.size
    weight = spec.weight
    tracking = 0.0
    if spec.tracking <> invalid then tracking = spec.tracking
    font = PlayarrMakeFont(weight, size)
    m.measure.font = font
    wrapWidth = 0.0
    if spec.width <> invalid then wrapWidth = spec.width
    maxLines = 1
    if spec.maxLines <> invalid then maxLines = spec.maxLines
    lineHeight = size * 1.3
    if spec.lineHeight <> invalid then lineHeight = spec.lineHeight

    lines = [text]
    if wrapWidth > 0 then lines = wrapLines(text, wrapWidth, tracking, maxLines, spec.balance = true)

    ' Free every pooled glyph, then lay the lines out.
    for each glyph in m.pool
        glyph.visible = false
    end for
    m.used = 0
    ' Untracked text is set a whole line per Label; a clamped last line ends in an ellipsis at a word boundary, like
    ' -webkit-line-clamp.
    wholeLines = tracking = 0
    if wholeLines and m.overflow = true and lines.Count() > 0
        last = lines[lines.Count() - 1]
        while Len(last) > 0 and lineWidth(last + "…", 0) > wrapWidth
            cut = 0
            for k = Len(last) to 1 step -1
                if Mid(last, k, 1) = " "
                    cut = k
                    exit for
                end if
            end for
            if cut = 0 then exit while
            last = Left(last, cut - 1)
        end while
        lines[lines.Count() - 1] = last + "…"
    end if
    for lineIndex = 0 to lines.Count() - 1
        line = lines[lineIndex]
        if wholeLines
            glyph = nextGlyph()
            glyph.font = font
            glyph.text = line
            glyph.color = ThemeColor(spec.role)
            ThemeSetRole(glyph, spec.role)
            glyph.translation = [0, lineIndex * lineHeight]
            glyph.visible = true
            line = ""
        end if
        for i = 1 to Len(line)
            ch = Mid(line, i, 1)
            if ch <> " "
                x = advanceOf(Left(line, i - 1)) + tracking * (i - 1)
                glyph = nextGlyph()
                glyph.font = font
                glyph.text = ch
                glyph.color = ThemeColor(spec.role)
                ThemeSetRole(glyph, spec.role)
                glyph.translation = [x, lineIndex * lineHeight]
                glyph.visible = true
            end if
        end for
    end for
    widest = 0.0
    for each line in lines
        w = lineWidth(line, tracking)
        if w > widest then widest = w
    end for
    m.top.textWidth = widest
    m.top.lineCount = lines.Count()
end sub

function nextGlyph() as Object
    if m.used >= m.pool.Count()
        glyph = CreateObject("roSGNode", "Label")
        glyph.vertAlign = "top"
        m.top.AppendChild(glyph)
        m.pool.Push(glyph)
    end if
    glyph = m.pool[m.used]
    m.used = m.used + 1
    return glyph
end function

' Width of `prefix` as drawn by the font (kerning included). A trailing "|" keeps trailing spaces from being trimmed.
function advanceOf(prefix as String) as Float
    if prefix = "" then return 0
    m.measure.text = prefix + "|"
    full = m.measure.boundingRect().width
    m.measure.text = "|"
    bar = m.measure.boundingRect().width
    return full - bar
end function

function lineWidth(line as String, tracking as Float) as Float
    return advanceOf(line) + tracking * Len(line)
end function

' Greedy word wrap into `width`; with `balance`, the narrowest width that keeps the same number of lines (CSS text-wrap: balance).
function wrapLines(text as String, width as Float, tracking as Float, maxLines as Integer, balance as Boolean) as Object
    lines = greedy(text, width, tracking)
    if balance and lines.Count() > 1
        low = 0.0
        for each line in lines
            w = lineWidth(line, tracking)
            if w > low then low = w
        end for
        count = lines.Count()
        ' Binary search the smallest box that still wraps to `count` lines.
        lo = 1.0
        hi = low
        best = lines
        for pass = 1 to 8
            mid = (lo + hi) / 2
            trial = greedy(text, mid, tracking)
            if trial.Count() <= count
                best = trial
                hi = mid
            else
                lo = mid
            end if
        end for
        lines = best
    end if
    m.overflow = lines.Count() > maxLines
    if lines.Count() > maxLines
        trimmed = []
        for i = 0 to maxLines - 1
            trimmed.Push(lines[i])
        end for
        lines = trimmed
    end if
    return lines
end function

function greedy(text as String, width as Float, tracking as Float) as Object
    words = []
    current = ""
    for i = 1 to Len(text)
        ch = Mid(text, i, 1)
        if ch = " "
            if current <> "" then words.Push(current)
            current = ""
        else
            current = current + ch
        end if
    end for
    if current <> "" then words.Push(current)
    lines = []
    line = ""
    for each word in words
        trial = word
        if line <> "" then trial = line + " " + word
        if line <> "" and lineWidth(trial, tracking) > width
            lines.Push(line)
            line = word
        else
            line = trial
        end if
    end for
    if line <> "" then lines.Push(line)
    if lines.Count() = 0 then lines.Push("")
    return lines
end function
