sub init()
    for each id in ["rampKeyLeft", "rampKeyBottom", "rampKeyTop", "rampWashLeft", "rampWashRight"]
        ramp = m.top.findNode(id)
        ThemeSetRole(ramp, "surface")
        ramp.blendColor = ThemeColor("surface")
    end for
    m.global.observeField("themeMode", "onStageScrimTheme")
end sub

sub onStageScrimTheme()
    ThemeApplyTree(m.top, m.global.themeMode)
end sub
