' Shared plumbing for every component extending FeatureScreen (included with
' <script uri="pkg:/components/FeatureCommon.brs" /> in each child). A child
' defines featureActivate() and onFeatureResult(result as Object).

sub onFeatureApiResult(event as Object)
    result = event.GetData()
    if result = invalid then return
    onFeatureResult(result)
end sub

sub activate()
    featureActivate()
end sub

' Sends a request through MainScene. `action` is prefixed with "feature:" when
' the caller left the prefix off, so replies always route back to a feature.
sub featureSend(action as String, method as String, path as String, body as Dynamic)
    name = action
    if Left(name, 8) <> "feature:" then name = "feature:" + name
    m.top.apiRequest = { action: name, method: method, path: path, body: body }
end sub

sub featureClose()
    m.top.closeRequested = true
end sub
