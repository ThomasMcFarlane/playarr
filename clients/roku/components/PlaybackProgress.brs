' Resume and progress reporting for the native player. Uses the same server
' API as the web player: GET /api/v1/playback/{id}/progress before play and
' PUT /api/v1/playback/{id}/progress while playing and on every exit path.
' These calls run in their own ApiTask nodes, never in the single-flight
' MainScene queue, so an exit flush cannot be queued behind or replaced by
' another request.

' Resume position in whole seconds from a WatchProgress body, or invalid.
function ProgressResumeSeconds(data as Dynamic) as Dynamic
    if data = invalid or Type(data) <> "roAssociativeArray" then return invalid
    if data.state <> "part_watched" then return invalid
    if data.position_ms = invalid then return invalid
    if data.position_ms <= 0 then return invalid
    return data.position_ms / 1000
end function

' Never write position 0 or overwrite a resume point when playback never
' started. A completed write is allowed once playback has started.
function ProgressShouldWrite(started as Boolean, positionMs as Integer, completed as Boolean) as Boolean
    if not started then return false
    if positionMs <= 0 and not completed then return false
    return true
end function

sub startResumeFetch(mediaFileId as String, playbackPath as String)
    m.resumeSeconds = invalid
    m.playbackPath = playbackPath
    task = CreateObject("roSGNode", "ApiTask")
    task.ObserveField("result", "onResumeResult")
    task.request = {
        method: "GET"
        url: m.serverUrl + "/api/v1/playback/" + UrlEncode(mediaFileId) + "/progress"
        accessToken: m.accessToken
        mediaFileId: mediaFileId
    }
    m.resumeTask = task
    task.control = "RUN"
end sub

' Resume lookup finished (or failed): request the session, starting an
' on-demand transcode at the resume point exactly as the web player does.
sub onResumeResult(event as Object)
    result = event.GetData()
    if result = invalid or m.resumeTask = invalid then return
    if m.resumeTask.request.mediaFileId <> m.currentMediaFileId then return
    m.resumeSeconds = invalid
    if result.ok then m.resumeSeconds = ProgressResumeSeconds(result.data)
    m.resumeTask = invalid
    if m.playbackEnded then return
    path = m.playbackPath
    if m.resumeSeconds <> invalid
        path += "&start_position_ms=" + Int(m.resumeSeconds * 1000).ToStr()
    end if
    sendApi("playback", "GET", path, invalid, true)
end sub

' Seeks to the resume point inside the session that startPlayback opened.
' The server reports source_offset_ms when it transcoded from the resume
' point, in which case the player position is relative to that offset.
sub ProgressApplyResume(data as Object)
    m.sourceOffsetSeconds = 0
    if data.source_offset_ms <> invalid then m.sourceOffsetSeconds = data.source_offset_ms / 1000
    m.playbackDurationMs = 0
    if data.duration_ms <> invalid then m.playbackDurationMs = data.duration_ms
    seekTo = invalid
    if m.resumeSeconds <> invalid then seekTo = m.resumeSeconds - m.sourceOffsetSeconds
    m.resumeSeconds = invalid
    m.startRetriesLeft = 0
    ' An on-demand transcode answers 404 until its first playlist exists (about 20 s for a long film), whether or not it starts at a
    ' resume point: keep retrying every 3 s for 45 s, as the web player does.
    if m.sourceOffsetSeconds > 0 or data.mode = "hls" then m.startRetriesLeft = 15
    if seekTo <> invalid and seekTo >= 1 then m.video.seek = seekTo
end sub

' Writes the current position. Fire and forget in a dedicated task.
sub persistPlaybackProgress(completed as Boolean)
    if m.currentMediaFileId = invalid or m.currentMediaFileId = "" then return
    positionMs = Int((m.video.position + m.sourceOffsetSeconds) * 1000)
    durationMs = Int(m.video.duration * 1000)
    if m.playbackDurationMs > durationMs then durationMs = m.playbackDurationMs
    if not ProgressShouldWrite(m.playbackStarted = true, positionMs, completed) then return
    if durationMs < positionMs then durationMs = positionMs
    if m.progressTasks = invalid then m.progressTasks = []
    task = CreateObject("roSGNode", "ApiTask")
    task.request = {
        method: "PUT"
        url: m.serverUrl + "/api/v1/playback/" + UrlEncode(m.currentMediaFileId) + "/progress"
        accessToken: m.accessToken
        body: { position_ms: positionMs, duration_ms: durationMs, completed: completed }
    }
    ' Keep a reference so the task is not collected before it finishes.
    m.progressTasks.Push(task)
    if m.progressTasks.Count() > 4 then m.progressTasks.Shift()
    task.control = "RUN"
end sub

' Re-opens the stream after a start error while nothing has played yet.
function ProgressRetryStart() as Boolean
    if m.playbackStarted = true or m.playbackEnded then return false
    if m.startRetriesLeft = invalid or m.startRetriesLeft <= 0 then return false
    m.startRetriesLeft = m.startRetriesLeft - 1
    if m.startRetryTimer = invalid
        m.startRetryTimer = CreateObject("roSGNode", "Timer")
        m.startRetryTimer.duration = 3
        m.startRetryTimer.repeat = false
        m.startRetryTimer.ObserveField("fire", "onStartRetry")
    end if
    m.startRetryTimer.control = "stop"
    m.startRetryTimer.control = "start"
    return true
end function

sub onStartRetry()
    if m.playbackEnded or m.playbackStarted = true then return
    content = m.video.content
    if content = invalid then return
    m.video.control = "stop"
    m.video.content = content.Clone(true)
    m.video.control = "play"
end sub
