import Foundation

/// One available language with the number of works that carry it
/// (`LanguageFacetEntry` on `GET /api/v1/catalog/languages`).
public struct LanguageFacetEntry: Codable, Sendable, Equatable, Hashable {
    /// Canonical code: ISO 639-1 where one exists, otherwise ISO 639-2/T.
    public var code: String
    /// English name when the server knows it; clients localise the code themselves.
    public var name: String?
    public var count: Int64

    public init(code: String, name: String? = nil, count: Int64 = 0) {
        self.code = code
        self.name = name
        self.count = count
    }

    private enum CodingKeys: String, CodingKey { case code, name, count }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        code = try container.decode(String.self, forKey: .code)
        name = try container.decodeIfPresent(String.self, forKey: .name)
        count = try container.decodeIfPresent(Int64.self, forKey: .count) ?? 0
    }

    /// The name to show: the device-localised language name for the code,
    /// then the server's English name, then the upper-cased code.
    public func displayName(locale: Locale = .current) -> String {
        if let localised = locale.localizedString(forLanguageCode: code), !localised.isEmpty,
           localised.lowercased() != code.lowercased() {
            return localised.prefix(1).uppercased() + localised.dropFirst()
        }
        if let name, !name.isEmpty { return name }
        return code.uppercased()
    }
}

/// `GET /api/v1/catalog/languages` response (`LanguageFacetsResponse`).
public struct LanguageFacets: Codable, Sendable, Equatable {
    public var audio: [LanguageFacetEntry]
    public var subtitle: [LanguageFacetEntry]

    public init(audio: [LanguageFacetEntry] = [], subtitle: [LanguageFacetEntry] = []) {
        self.audio = audio
        self.subtitle = subtitle
    }

    private enum CodingKeys: String, CodingKey { case audio, subtitle }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        audio = try container.decodeIfPresent([LanguageFacetEntry].self, forKey: .audio) ?? []
        subtitle = try container.decodeIfPresent([LanguageFacetEntry].self, forKey: .subtitle) ?? []
    }
}

/// The audio and subtitle language selection of a library view. Within one
/// list any selected language matches (`lang_match` stays at the server
/// default of `any`), matching Web and Android.
public struct LanguageFilter: Sendable, Equatable {
    public var audio: [String]
    public var subtitle: [String]

    public init(audio: [String] = [], subtitle: [String] = []) {
        self.audio = audio
        self.subtitle = subtitle
    }

    public var isActive: Bool { !audio.isEmpty || !subtitle.isEmpty }
    public var activeCount: Int { audio.count + subtitle.count }

    /// `audio_lang` / `subtitle_lang` query items; empty lists are omitted.
    public var queryItems: [URLQueryItem] {
        var items: [URLQueryItem] = []
        if !audio.isEmpty { items.append(URLQueryItem(name: "audio_lang", value: audio.joined(separator: ","))) }
        if !subtitle.isEmpty { items.append(URLQueryItem(name: "subtitle_lang", value: subtitle.joined(separator: ","))) }
        return items
    }

    /// Adds `code` to `list` when absent, removes it when present.
    public static func toggled(_ code: String, in list: [String]) -> [String] {
        if list.contains(code) { return list.filter { $0 != code } }
        return list + [code]
    }
}

/// Language-aware catalogue browsing and facets. A missing endpoint (older
/// server) surfaces as a thrown error; callers hide the control on failure.
public struct LanguageFilterClient: Sendable {
    private let transport: any PlayarrRequestTransport

    public init(transport: any PlayarrRequestTransport) {
        self.transport = transport
    }

    public func facets(
        kind: WorkKind?,
        availableOnly: Bool = true,
        filter: LanguageFilter = LanguageFilter()
    ) async throws -> LanguageFacets {
        var query: [URLQueryItem] = []
        if let kind { query.append(URLQueryItem(name: "kind", value: kind.rawValue)) }
        query.append(URLQueryItem(name: "available_only", value: String(availableOnly)))
        query.append(contentsOf: filter.queryItems)
        return try await transport.getJSON("/api/v1/catalog/languages", query: query)
    }

    public func browse(
        kind: WorkKind,
        sort: String,
        order: String,
        availableOnly: Bool,
        limit: Int,
        offset: Int,
        filter: LanguageFilter
    ) async throws -> CatalogPage {
        var query = [
            URLQueryItem(name: "kind", value: kind.rawValue),
            URLQueryItem(name: "sort", value: sort),
            URLQueryItem(name: "order", value: order),
            URLQueryItem(name: "available_only", value: String(availableOnly)),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset)),
        ]
        query.append(contentsOf: filter.queryItems)
        return try await transport.getJSON("/api/v1/catalog", query: query)
    }
}
