import Foundation

/// Shared `JSONDecoder`/`JSONEncoder` configuration for every type in
/// `OpenAPISchemas.swift`. Centralized here (rather than one-off decoders
/// per call site) so date handling stays consistent everywhere.
enum StreamarrJSONCoding {
    /// The backend's `DateTime<Utc>` fields (`added_at`, `created_at`,
    /// `updated_at`, ...) are serialized via `chrono`'s default RFC 3339
    /// `Serialize` impl, which — depending on whether the sub-second
    /// component is exactly zero — may or may not include fractional
    /// seconds, and uses a `+00:00` (not `Z`) UTC offset. Foundation's
    /// `JSONDecoder.dateDecodingStrategy = .iso8601` uses a single fixed
    /// `ISO8601DateFormatter` configuration and throws on anything that
    /// doesn't match it exactly, so a bare `.iso8601` strategy is not
    /// reliable against this server. This tries the two shapes actually
    /// produced (with, then without, fractional seconds) before failing.
    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)

            if let date = fractionalSecondsFormatter.date(from: raw) {
                return date
            }
            if let date = standardFormatter.date(from: raw) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected a date string in RFC 3339 format, got \"\(raw)\""
            )
        }
        return decoder
    }

    static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(fractionalSecondsFormatter.string(from: date))
        }
        return encoder
    }

    private static let standardFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let fractionalSecondsFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
