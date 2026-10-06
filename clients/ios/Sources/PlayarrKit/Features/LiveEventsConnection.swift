import Foundation

/// The HTTP outcome of opening the event stream, before any frame is read.
public struct EventStreamResponse: Sendable {
    public var statusCode: Int
    public var contentType: String?
    /// Lines of the stream, including empty lines; `nil` unless the response was `200`.
    public var lines: AsyncThrowingStream<String, Error>?

    public init(statusCode: Int, contentType: String?, lines: AsyncThrowingStream<String, Error>?) {
        self.statusCode = statusCode
        self.contentType = contentType
        self.lines = lines
    }

    /// Anything that is not `200 text/event-stream` (older servers answer unknown
    /// paths with the app shell HTML or a 404) is not a usable stream.
    public var isEventStream: Bool {
        guard statusCode == 200, lines != nil, let contentType else { return false }
        let mime = contentType.split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        return mime.caseInsensitiveCompare("text/event-stream") == .orderedSame
    }

    public var isTransientFailure: Bool {
        statusCode == 401 || statusCode == 408 || statusCode == 429 || statusCode >= 500
    }
}

public extension PlayarrRequestTransport {
    /// Default for transports without streaming support: behaves like a server
    /// without the route, so callers fall back to polling.
    func openEventStream(lastEventID: Int64?) async throws -> EventStreamResponse {
        EventStreamResponse(statusCode: 404, contentType: nil, lines: nil)
    }
}

/// Reconnect backoff: 1 s, 2 s, 4 s ... capped at 30 s, with downward jitter.
public enum LiveBackoff {
    public static let minSeconds: Double = 1
    public static let maxSeconds: Double = 30
    public static let stableSeconds: Double = 60

    /// `attempt` is 1 for the first retry; `random` is in `0..<1`. Result is in `0.75 * base ... base`.
    public static func delay(attempt: Int, random: Double) -> Double {
        let exponent = min(max(attempt - 1, 0), 20)
        let base = min(maxSeconds, minSeconds * Double(1 << exponent))
        let jitter = min(max(random, 0), 1)
        return base * (0.75 + 0.25 * jitter)
    }
}

public enum LiveConnectionState: Equatable, Sendable {
    case idle
    case connecting
    case connected
    case reconnecting
    /// The server has no event stream; polling is active, no retry until the next foreground or sign-in.
    case unsupported
}

/// One reconnecting subscription to `GET /api/v1/events`. `run` loops until its
/// task is cancelled or the server proves unsupported. The Last-Event-ID cursor
/// survives pauses so a resume replays what was missed.
public actor LiveEventsConnection {
    private enum Outcome {
        case unsupported
        case ended(upSeconds: Double, failed: Bool)
    }

    private let transport: any PlayarrRequestTransport
    private let clock: @Sendable () -> Double
    private let sleep: @Sendable (Double) async -> Void
    private let random: @Sendable () -> Double
    public private(set) var lastEventID: Int64?

    public init(
        transport: any PlayarrRequestTransport,
        clock: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 },
        sleep: @escaping @Sendable (Double) async -> Void = { seconds in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        },
        random: @escaping @Sendable () -> Double = { Double.random(in: 0..<1) }
    ) {
        self.transport = transport
        self.clock = clock
        self.sleep = sleep
        self.random = random
    }

    /// Forget the cursor (different server or account: a cursor from another domain is meaningless).
    public func resetCursor() {
        lastEventID = nil
    }

    public func run(
        onState: @escaping @Sendable (LiveConnectionState) async -> Void,
        onEvent: @escaping @Sendable (LiveEvent) async -> Void
    ) async {
        var attempt = 0
        while !Task.isCancelled {
            await onState(.connecting)
            let outcome = await connectOnce(onState: onState, onEvent: onEvent)
            if Task.isCancelled { break }
            switch outcome {
            case .unsupported:
                await onState(.unsupported)
                return
            case .ended(let upSeconds, let failed):
                if upSeconds >= LiveBackoff.stableSeconds { attempt = 0 }
                // The server's own five-minute close is a normal reconnect.
                if !failed && upSeconds >= LiveBackoff.stableSeconds { continue }
                attempt += 1
                await onState(.reconnecting)
                await sleep(LiveBackoff.delay(attempt: attempt, random: random()))
            }
        }
        await onState(.idle)
    }

    private func connectOnce(
        onState: @Sendable (LiveConnectionState) async -> Void,
        onEvent: @Sendable (LiveEvent) async -> Void
    ) async -> Outcome {
        let response: EventStreamResponse
        do {
            response = try await transport.openEventStream(lastEventID: lastEventID)
        } catch {
            return .ended(upSeconds: 0, failed: true)
        }
        guard response.isEventStream, let lines = response.lines else {
            return response.isTransientFailure ? .ended(upSeconds: 0, failed: true) : .unsupported
        }
        let started = clock()
        await onState(.connected)
        var parser = SSEParser()
        do {
            for try await line in lines {
                guard let frame = parser.feed(line: line), let event = LiveEvent(frame: frame) else { continue }
                if event.seq > (lastEventID ?? -1) { lastEventID = event.seq }
                await onEvent(event)
            }
            return .ended(upSeconds: clock() - started, failed: false)
        } catch {
            return .ended(upSeconds: clock() - started, failed: true)
        }
    }
}
