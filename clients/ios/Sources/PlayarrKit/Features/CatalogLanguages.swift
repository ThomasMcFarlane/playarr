import Foundation

/// One language the catalogue can be filtered by (`GET /api/v1/catalog/languages`), with how many titles have it.
public struct LanguageFacet: Codable, Hashable, Sendable, Identifiable {
    public let code: String
    /// Nil for a code the server has no name for; `displayName` falls back to the system name or the code.
    public let name: String?
    public let count: Int?

    public var displayName: String {
        name ?? Locale(identifier: "en_GB").localizedString(forLanguageCode: code) ?? code
    }
    public var id: String { code }

    public init(code: String, name: String?, count: Int?) {
        self.code = code
        self.name = name
        self.count = count
    }
}

/// The audio and subtitle languages of the titles a library browse would return.
public struct LanguageFacets: Codable, Sendable {
    public let audio: [LanguageFacet]
    public let subtitle: [LanguageFacet]

    public init(audio: [LanguageFacet], subtitle: [LanguageFacet]) {
        self.audio = audio
        self.subtitle = subtitle
    }
}

public extension PlayarrRequestTransport {
    /// Web `catalogLanguages`: the facets follow the other active filters (kind, playable only, chosen languages).
    func catalogLanguages(kind: WorkKind?, audioLang: [String], subtitleLang: [String]) async throws -> LanguageFacets {
        var query = [URLQueryItem(name: "available_only", value: "true")]
        if let kind { query.append(URLQueryItem(name: "kind", value: kind.rawValue)) }
        if !audioLang.isEmpty { query.append(URLQueryItem(name: "audio_lang", value: audioLang.joined(separator: ","))) }
        if !subtitleLang.isEmpty { query.append(URLQueryItem(name: "subtitle_lang", value: subtitleLang.joined(separator: ","))) }
        return try await getJSON("/api/v1/catalog/languages", query: query)
    }
}

public extension PlayarrRequestTransport {
    /// Web `getEpisodeArtwork`: an episode's still (`thumb`) at the given width.
    func fetchEpisodeArtwork(seriesWorkID: UUID, episodeID: UUID, kind: String = "thumb", width: Int = 540) async throws -> Data {
        try await requestData(
            method: "GET",
            path: "/api/v1/artwork/episode/\(seriesWorkID.uuidString)/\(episodeID.uuidString)/\(kind)",
            query: [URLQueryItem(name: "width", value: String(width))],
            body: nil,
            expectedStatuses: [200]
        )
    }
}
