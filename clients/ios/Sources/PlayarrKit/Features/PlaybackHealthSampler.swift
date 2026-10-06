import AVFoundation
import Foundation

/// What an `AVPlayerItem` access log says about the playback so far.
/// Pure value so the mapping is unit-testable without an `AVPlayer`.
public struct AccessLogTotals: Sendable, Equatable {
    public var droppedFrames: Int64
    public var stalls: Int
    public var observedBitrate: Double
    public var downloadOverhead: Double

    public init(droppedFrames: Int64 = 0, stalls: Int = 0, observedBitrate: Double = 0, downloadOverhead: Double = 0) {
        self.droppedFrames = droppedFrames
        self.stalls = stalls
        self.observedBitrate = observedBitrate
        self.downloadOverhead = downloadOverhead
    }
}

/// Builds a `ClientPlaybackReport` from what the platform actually exposes.
///
/// Honest limits: AVFoundation does not say whether the decoder is hardware or
/// software, nor whether HDR or passthrough is active on the output, so those
/// stay unset (the server then reports them as not confirmed). The display's
/// HDR capability and the current audio route are *reported*, never measured.
public enum PlaybackHealthSampler {
    public static func report(
        totals: AccessLogTotals?,
        presentationSize: CGSize?,
        displayHDRFormats: [String],
        audioOutput: String?,
        maxHeight: Int?
    ) -> ClientPlaybackReport {
        var measured = MeasuredPlayback()
        if let size = presentationSize, size.width > 0, size.height > 0 {
            measured.width = Int(size.width)
            measured.height = Int(size.height)
        }
        if let totals {
            measured.droppedFrames = max(0, totals.droppedFrames)
            measured.rebufferCount = max(0, totals.stalls)
            if totals.observedBitrate > 0 { measured.throughputBps = Int64(totals.observedBitrate) }
        }
        let reported = ReportedCapabilities(
            videoCodecs: ["h264", "hevc"],
            audioCodecs: ["aac", "ac3", "eac3"],
            hdrFormats: [],
            displayHdrFormats: displayHDRFormats,
            audioOutput: audioOutput,
            maxHeight: maxHeight
        )
        return ClientPlaybackReport(reported: reported, measured: measured)
    }

    public static func totals(from events: [AVPlayerItemAccessLogEvent]) -> AccessLogTotals {
        var totals = AccessLogTotals()
        for event in events {
            if event.numberOfDroppedVideoFrames > 0 { totals.droppedFrames += Int64(event.numberOfDroppedVideoFrames) }
            if event.numberOfStalls > 0 { totals.stalls += event.numberOfStalls }
            if event.observedBitrate > 0 { totals.observedBitrate = event.observedBitrate }
        }
        return totals
    }

    /// Reads the live player. Must be called on the main actor in the app, but
    /// every API used here is thread-safe for reading.
    public static func sample(player: AVPlayer?) -> ClientPlaybackReport {
        let item = player?.currentItem
        let events = item?.accessLog()?.events ?? []
        return report(
            totals: item == nil ? nil : totals(from: events),
            presentationSize: item?.presentationSize,
            displayHDRFormats: displayHDRFormats(),
            audioOutput: audioOutputName(),
            maxHeight: nil
        )
    }

    public static func displayHDRFormats() -> [String] {
        let modes = AVPlayer.availableHDRModes
        var names: [String] = []
        if modes.contains(.hdr10) { names.append("hdr10") }
        if modes.contains(.hlg) { names.append("hlg") }
        if modes.contains(.dolbyVision) { names.append("dolby_vision") }
        return names
    }

    public static func audioOutputName() -> String? {
        let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
        guard let first = outputs.first else { return nil }
        // Port type only: never the device name (it can be a personal label).
        // Raw port identifiers, so no platform-specific enum case is referenced.
        switch first.portType.rawValue {
        case "Speaker": return "speaker"
        case "Headphones": return "wired_headphones"
        case "BluetoothA2DP", "BluetoothLE", "BluetoothHFP": return "bluetooth"
        case "HDMI": return "hdmi"
        case "AirPlay": return "airplay"
        case "USBAudio": return "usb"
        default: return "other"
        }
    }
}
