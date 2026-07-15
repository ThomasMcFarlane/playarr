import Foundation

/// Mirrors `streamarr_model::sensitive::Sensitive<T>` from the backend
/// (`backend/crates/streamarr-model/src/sensitive.rs`).
///
/// Wrap tokens, refresh tokens, and any other secret that ends up on a
/// domain model in `Sensitive<Value>` so a stray `print`, `debugPrint`, or
/// breadcrumb/log line can never leak it. `description`/`debugDescription`
/// always return the literal string `"REDACTED"`, regardless of the
/// wrapped value.
///
/// `Codable` conformance is intentionally transparent — it round-trips
/// exactly like the wrapped value on the wire — because callers that
/// legitimately need the secret (attaching an `Authorization` header,
/// persisting to the Keychain) still need to get it out via
/// `exposeSecret()`. Redaction here is a logging concern, not a
/// serialization one: don't rely on this type alone to keep secrets out of
/// responses you hand to other layers.
public struct Sensitive<Value: Codable & Sendable>: Sendable {
    private let value: Value

    public init(_ value: Value) {
        self.value = value
    }

    /// Explicit, greppable escape hatch — named to match the Rust
    /// `expose_secret()` method so an audit for either finds every call
    /// site.
    public func exposeSecret() -> Value {
        value
    }
}

extension Sensitive: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self.value = try container.decode(Value.self)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(value)
    }
}

extension Sensitive: CustomStringConvertible, CustomDebugStringConvertible {
    public var description: String { "REDACTED" }
    public var debugDescription: String { "REDACTED" }
}

extension Sensitive: Equatable where Value: Equatable {
    public static func == (lhs: Sensitive<Value>, rhs: Sensitive<Value>) -> Bool {
        lhs.value == rhs.value
    }
}

extension Sensitive: Hashable where Value: Hashable {
    public func hash(into hasher: inout Hasher) {
        hasher.combine(value)
    }
}
