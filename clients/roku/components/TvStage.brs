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
    m.keyArt.uri = m.top.keyArtUri
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

' Public entry point (declared as a <function> in TvStage.xml). Other scenes
' call this once they have set stageTitle/stageKicker/stageMeta and inserted
' their own rail/grid content under contentTarget's children.
sub playEntrance()
    resetForEntrance()
    m.entranceAnimation.control = "start"
end sub
