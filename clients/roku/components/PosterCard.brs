sub init()
    m.poster = m.top.findNode("poster")
    m.title = m.top.findNode("title")
    m.focusFrame = m.top.findNode("focusFrame")
end sub

sub onContentChanged()
    content = m.top.itemContent
    if content = invalid then return
    m.title.text = content.title
    agent = CreateObject("roHttpAgent")
    agent.SetCertificatesFile("common:/certs/ca-bundle.crt")
    agent.InitClientCertificates()
    if content.httpHeaders <> invalid then agent.SetHeaders(content.httpHeaders)
    m.poster.SetHttpAgent(agent)
    m.poster.uri = content.hdPosterUrl
end sub

sub onFocusChanged()
    m.focusFrame.opacity = m.top.focusPercent
    scale = 1 + (m.top.focusPercent * 0.04)
    m.top.scale = [scale, scale]
end sub
