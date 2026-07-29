' TvStage.brs
'
' Backing logic for TvStage.xml. Wires the stageTitle/stageKicker/stageMeta/
' keyArtUri interface fields into the Label/Poster nodes declared in XML, and
' exposes contentTarget + show() for other scenes to build page content on
' top of this shared "stage" composition (see TvStage.xml for the CSS ->
' SceneGraph substitution notes).

sub init()
    m.keyArtLayer = m.top.findNode("keyArtLayer")
    m.keyArt = m.top.findNode("keyArt")
    m.titlePanel = m.top.findNode("titlePanel")
    m.stageKickerLabel = m.top.findNode("stageKickerLabel")
    m.stageTitleLabel = m.top.findNode("stageTitleLabel")
    m.stageMetaLabel = m.top.findNode("stageMetaLabel")
    m.stageOverviewLabel = m.top.findNode("stageOverviewLabel")
    m.contentPanel = m.top.findNode("contentPanel")
    m.entranceAnimation = m.top.findNode("entranceAnimation")

    m.top.contentTarget = m.contentPanel

    resetForEntrance()
end sub

' Restores the pre-entrance (hidden/offset) state of every animated layer so
' show() can be called more than once (e.g. a scene re-entering this stage
' for a different title) and still play the full entrance each time.
sub resetForEntrance()
    m.keyArtLayer.opacity = 0
    m.keyArtLayer.translation = [15, 0]
    m.titlePanel.opacity = 0
    m.titlePanel.translation = [110, 335]
    m.contentPanel.opacity = 0
    m.contentPanel.translation = [1043, 259]
end sub

sub onKeyArtUriChange()
    uri = m.top.keyArtUri
    if uri = ""
        m.keyArt.uri = ""
        return
    end if
    ' Download authenticated artwork to tmp, then point the Poster at the
    ' local file. SetHttpAgent on this nested Poster has been unreliable on
    ' device (cards use the same agent pattern and work; key-art stayed blank).
    xfer = CreateObject("roUrlTransfer")
    xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    xfer.InitClientCertificates()
    xfer.SetUrl(uri)
    if m.top.keyArtHeaders <> invalid
        xfer.SetHeaders(m.top.keyArtHeaders)
    end if
    tmpPath = "tmp:/playarr-keyart.jpg"
    ok = xfer.GetToFile(tmpPath)
    if ok
        m.keyArt.uri = tmpPath
    else
        ' Fallback: try in-place agent path used by PosterCard.
        m.keyArtAgent = CreateObject("roHttpAgent")
        m.keyArtAgent.SetCertificatesFile("common:/certs/ca-bundle.crt")
        m.keyArtAgent.InitClientCertificates()
        if m.top.keyArtHeaders <> invalid
            m.keyArtAgent.SetHeaders(m.top.keyArtHeaders)
        end if
        m.keyArt.SetHttpAgent(m.keyArtAgent)
        m.keyArt.uri = uri
    end if
    if m.keyArtLayer <> invalid then m.keyArtLayer.opacity = 1
end sub

sub onStageKickerChange()
    m.stageKickerLabel.text = m.top.stageKicker
end sub

sub onStageTitleChange()
    m.stageTitleLabel.text = m.top.stageTitle
end sub

sub onStageMetaChange()
    m.stageMetaLabel.text = m.top.stageMeta
end sub

sub onStageOverviewChange()
    if m.stageOverviewLabel <> invalid
        m.stageOverviewLabel.text = m.top.stageOverview
    end if
end sub

' Public entry point (declared as a <function> in TvStage.xml). Other scenes
' call this once they have set stageTitle/stageKicker/stageMeta and inserted
' their own rail/grid content under contentTarget's children.
sub playEntrance()
    resetForEntrance()
    m.entranceAnimation.control = "start"
end sub
