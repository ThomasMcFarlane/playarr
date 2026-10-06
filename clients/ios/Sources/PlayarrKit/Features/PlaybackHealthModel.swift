import AVFoundation
import Foundation
import Observation

/// Screen state for "Playback health", shared by the iPhone/iPad sheet and the
/// Apple TV panel so both show the same sections and wording.
@MainActor
@Observable
public final class PlaybackHealthModel {
    public enum State {
        case idle
        case loading
        case loaded(PlaybackHealthReport)
        case failed(String)
    }

    public enum ConnectionState: Equatable {
        case idle
        case running
        case done(ConnectionTestResult)
        case failed(String)
    }

    public private(set) var state: State = .idle
    public private(set) var connection: ConnectionState = .idle
    public var showTechnicalDetail = false

    private let client: PlaybackHealthClient
    private let sessionID: UUID?
    private let player: AVPlayer?
    @ObservationIgnored private var connectionTask: Task<Void, Never>?

    public init(transport: PlayarrRequestTransport, sessionID: UUID?, player: AVPlayer?) {
        self.client = PlaybackHealthClient(transport: transport)
        self.sessionID = sessionID
        self.player = player
    }

    /// True when there is a server session to describe (not offline or cast playback).
    public var hasSession: Bool { sessionID != nil }

    public func refresh() async {
        guard let sessionID else {
            state = .failed("Playback health is only available for playback from your server.")
            return
        }
        state = .loading
        let sample = PlaybackHealthSampler.sample(player: player)
        do {
            state = .loaded(try await client.report(sessionID: sessionID, client: sample))
        } catch let error as APIError {
            state = .failed(error.displayMessage)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    public func runConnectionTest() {
        guard connection != .running else { return }
        connection = .running
        connectionTask = Task { [client] in
            do {
                connection = .done(try await client.connectionTest())
            } catch is CancellationError {
                connection = .idle
            } catch {
                connection = .failed("The connection test did not finish.")
            }
        }
    }

    public func cancelConnectionTest() {
        connectionTask?.cancel()
        connectionTask = nil
        connection = .idle
    }

    public static func megabits(_ result: ConnectionTestResult) -> String {
        String(format: "%.1f Mbps", Double(result.bitsPerSecond) / 1_000_000)
    }

    public static func provenanceLabel(_ provenance: HealthProvenance) -> String {
        switch provenance {
        case .measured: return "Measured"
        case .reported: return "Reported by this device"
        case .unknown: return "Unknown"
        }
    }
}
