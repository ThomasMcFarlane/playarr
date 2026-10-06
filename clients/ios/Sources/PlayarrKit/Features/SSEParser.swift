import Foundation

/// One dispatched server-sent-event frame.
public struct SSEFrame: Equatable, Sendable {
    public var event: String
    public var id: String?
    public var data: String

    public init(event: String, id: String?, data: String) {
        self.event = event
        self.id = id
        self.data = data
    }
}

/// Splits a byte stream into lines on `\n` (an optional preceding `\r` is
/// dropped). `URLSession.AsyncBytes.lines` swallows empty lines, which are the
/// frame terminators in server-sent events, so the stream is split by hand.
public struct SSELineSplitter: Sendable {
    private var buffer: [UInt8] = []

    public init() {}

    /// Feeds one byte; returns a complete line (possibly empty) when `\n` arrives.
    public mutating func push(_ byte: UInt8) -> String? {
        if byte == 0x0A {
            if buffer.last == 0x0D { buffer.removeLast() }
            let line = String(decoding: buffer, as: UTF8.self)
            buffer.removeAll(keepingCapacity: true)
            return line
        }
        buffer.append(byte)
        return nil
    }
}

/// Incremental parser for the `text/event-stream` format. Feed it one line at
/// a time; it returns a frame when a blank line dispatches one. Comment lines
/// (heartbeats, starting with `:`) are ignored.
public struct SSEParser: Sendable {
    private var event = ""
    private var id: String?
    private var dataLines: [String] = []

    public init() {}

    public mutating func feed(line: String) -> SSEFrame? {
        if line.isEmpty {
            defer {
                event = ""
                id = nil
                dataLines = []
            }
            if event.isEmpty && dataLines.isEmpty { return nil }
            return SSEFrame(event: event.isEmpty ? "message" : event, id: id, data: dataLines.joined(separator: "\n"))
        }
        if line.hasPrefix(":") { return nil }

        let field: String
        var value: String
        if let colon = line.firstIndex(of: ":") {
            field = String(line[line.startIndex..<colon])
            value = String(line[line.index(after: colon)...])
            if value.hasPrefix(" ") { value.removeFirst() }
        } else {
            field = line
            value = ""
        }
        switch field {
        case "event": event = value
        case "id": id = value
        case "data": dataLines.append(value)
        default: break
        }
        return nil
    }
}
