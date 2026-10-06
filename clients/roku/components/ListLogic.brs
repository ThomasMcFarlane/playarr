' ListLogic.brs: pure helpers for lists whose rows include non-selectable
' headings (agenda day rows, filter section titles). Rows are assocarrays with
' a `kind` field; "heading" rows are skipped by focus.

' Where focus should land after the list reported `index`: itself unless it is
' a heading, then the nearest selectable row in the direction of travel
' (`last` is the previously focused index), falling back to the other
' direction. Returns -1 when no row is selectable.
function ListSkipHeading(rows as Object, index as Integer, last as Integer) as Integer
    if index < 0 or index >= rows.Count() then return -1
    if rows[index].kind <> "heading" then return index
    dir = 1
    if index < last then dir = -1
    target = ListNextSelectable(rows, index, dir)
    if target < 0 then target = ListNextSelectable(rows, index, -dir)
    return target
end function

function ListNextSelectable(rows as Object, from as Integer, dir as Integer) as Integer
    i = from
    while i >= 0 and i < rows.Count()
        if rows[i].kind <> "heading" then return i
        i = i + dir
    end while
    return -1
end function

' Builds a ContentNode list from row descriptors. Each descriptor may carry:
' kind (rowKind), title, subtitle, meta, state, checked, poster, w, h.
function ListBuildContent(rows as Object, width as Integer, height as Integer) as Object
    content = CreateObject("roSGNode", "ContentNode")
    for each row in rows
        node = content.CreateChild("ContentNode")
        node.AddFields({ rowKind: row.kind, rowW: width, rowH: height, checked: false })
        if row.title <> invalid then node.title = row.title
        if row.subtitle <> invalid then node.shortDescriptionLine1 = row.subtitle
        if row.state <> invalid then node.shortDescriptionLine2 = row.state
        if row.meta <> invalid then node.description = row.meta
        if row.poster <> invalid and row.poster <> "" then node.hdPosterUrl = row.poster
        if row.checked <> invalid then node.checked = row.checked
    end for
    return content
end function
