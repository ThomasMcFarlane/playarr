' TvStage.brs
'
' Backing logic for TvStage.xml. Wires the stageTitle/stageKicker/stageMeta/
' keyArtUri interface fields into the Label/Poster nodes declared in XML, and
' exposes contentTarget + show() for other scenes to build page content on
' top of this shared "stage" composition (see TvStage.xml for the CSS ->
' SceneGraph substitution notes).

sub init()
    PlayarrFontifyTree(m.top)
    ThemeSetRole(m.top.findNode("keyArtFade"), "bg")
    ThemeInitComponent()
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
    m.titlePanel.translation = [119.6, 259.2]
    m.contentPanel.opacity = 0
    m.contentPanel.translation = [941.6, 422.9]
end sub

' Force every stage layer fully visible at its settled translation.
' Used when re-entering Home (entrance already played once) and as a
' recovery path so rails never stay stuck at opacity 0 if the staggered
' entrance Animation does not run.
sub revealStage()
    if m.entranceAnimation <> invalid then m.entranceAnimation.control = "stop"
    m.keyArtLayer.opacity = 1
    m.keyArtLayer.translation = [0, 0]
    m.titlePanel.opacity = 1
    m.titlePanel.translation = [153.6, 259.2]
    m.contentPanel.opacity = 1
    m.contentPanel.translation = [881.6, 422.9]
end sub

sub onKeyArtUriChange()
    uri = m.top.keyArtUri
    if uri = ""
        m.keyArt.uri = ""
        return
    end if
    ' Async only. A previous sync GetToFile() blocked the SceneGraph
    ' thread during finishHomeLoad (before playEntrance), so Home stayed
    ' at contentPanel.opacity=0 with left nav only until the download
    ' finished or hung. PosterCard's roHttpAgent path is the proven one.
    m.keyArtAgent = CreateObject("roHttpAgent")
    m.keyArtAgent.SetCertificatesFile("common:/certs/ca-bundle.crt")
    m.keyArtAgent.InitClientCertificates()
    if m.top.keyArtHeaders <> invalid
        m.keyArtAgent.SetHeaders(m.top.keyArtHeaders)
    end if
    m.keyArt.SetHttpAgent(m.keyArtAgent)
    m.keyArt.uri = uri
    if m.keyArtLayer <> invalid then m.keyArtLayer.opacity = 1
end sub

sub onStageKickerChange()
    m.stageKickerLabel.text = m.top.stageKicker
end sub

sub onStageTitleChange()
    m.stageTitleLabel.text = m.top.stageTitle
    layoutStageText()
end sub

sub onStageMetaChange()
    m.stageMetaLabel.text = m.top.stageMeta
    layoutStageText()
end sub

sub onStageOverviewChange()
    if m.stageOverviewLabel <> invalid
        m.stageOverviewLabel.text = m.top.stageOverview
    end if
    layoutStageText()
end sub

' The web flows meta and synopsis under the title: one title line puts the meta row 27 px below it, the synopsis 37.5 px
' under the meta (or 21.6 px under the title when there is no meta row). Title lines are 61 px apart at 69 px.
sub layoutStageText()
    lines = Int(m.stageTitleLabel.boundingRect().height / 61 + 0.5)
    if lines < 1 then lines = 1
    if lines > 3 then lines = 3
    titleBottom = 44.3 + 61 * lines
    if m.top.stageMeta <> invalid and m.top.stageMeta <> ""
        m.stageMetaLabel.translation = [0, titleBottom + 27]
        m.stageOverviewLabel.translation = [0, titleBottom + 27 + 37.5]
    else
        m.stageMetaLabel.translation = [0, titleBottom + 27]
        m.stageOverviewLabel.translation = [0, titleBottom + 21.6]
    end if
end sub

' Public entry point (declared as a <function> in TvStage.xml). Other scenes
' call this once they have set stageTitle/stageKicker/stageMeta and inserted
' their own rail/grid content under contentTarget's children.
sub playEntrance()
    resetForEntrance()
    m.entranceAnimation.control = "start"
end sub
