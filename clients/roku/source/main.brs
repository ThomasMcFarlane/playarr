sub Main()
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)

    screen.getGlobalNode().addFields({ themeMode: ResolvePairingTheme(LoadPairingThemePreference()) })
    scene = screen.CreateScene("MainScene")
    screen.Show()
    scene.SetFocus(true)

    while true
        message = wait(0, port)
        if type(message) = "roSGScreenEvent" and message.IsScreenClosed()
            return
        end if
    end while
end sub
