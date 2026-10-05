import Foundation
import PlayarrKit

enum LoginServerURL {
    private static let relayHost = "relay.playarr.app"
    private static let playarrPort = 8484

    static func normalise(_ value: String) throws -> URL {
        let corrected = publicIPv4RelayString(value)
        let trimmed = corrected.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              var components = URLComponents(string: trimmed),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              components.host != nil,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil else {
            throw APIError.invalidBaseURL
        }

        while components.percentEncodedPath.hasSuffix("/") {
            components.percentEncodedPath.removeLast()
        }
        guard let url = components.url else { throw APIError.invalidBaseURL }
        return url
    }

    static func publicIPv4RelayString(_ value: String) -> String {
        let input = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let candidate: String
        if input.range(of: #"^[A-Za-z][A-Za-z0-9+.-]*://"#, options: .regularExpression) != nil {
            candidate = input
        } else if input.hasPrefix("//") {
            candidate = "http:\(input)"
        } else {
            candidate = "http://\(input)"
        }

        guard let components = URLComponents(string: candidate),
              components.scheme == "http" || components.scheme == "https",
              components.user == nil,
              components.password == nil,
              let host = components.host,
              let octets = encodedRelayOctets(host) ?? publicIPv4Octets(host) else {
            return value
        }

        let path = components.percentEncodedPath == "/" ? "" : components.percentEncodedPath
        let query = components.percentEncodedQuery.map { "?\($0)" } ?? ""
        let fragment = components.percentEncodedFragment.map { "#\($0)" } ?? ""
        let port = components.port == playarrPort ? ":\(playarrPort)" : ""
        return "https://v4-\(octets.map(String.init).joined(separator: "-")).\(relayHost)\(port)\(path)\(query)\(fragment)"
    }

    private static func encodedRelayOctets(_ host: String) -> [Int]? {
        let pattern = #"^v4-(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\.relay\.playarr\.app$"#
        guard let expression = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else {
            return nil
        }
        let range = NSRange(host.startIndex..., in: host)
        guard let match = expression.firstMatch(in: host, range: range), match.numberOfRanges == 5 else {
            return nil
        }
        let values = (1..<5).compactMap { index -> String? in
            guard let range = Range(match.range(at: index), in: host) else { return nil }
            return String(host[range])
        }
        return publicIPv4Octets(values.joined(separator: "."))
    }

    private static func publicIPv4Octets(_ host: String) -> [Int]? {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        let octets = parts.compactMap { Int($0) }
        guard octets.count == 4, octets.allSatisfy({ 0...255 ~= $0 }) else { return nil }

        let first = octets[0]
        let second = octets[1]
        let third = octets[2]
        let reserved = first == 0 || first == 10 || first == 127 ||
            (first == 100 && 64...127 ~= second) ||
            (first == 169 && second == 254) ||
            (first == 172 && 16...31 ~= second) ||
            (first == 192 && second == 0 && (third == 0 || third == 2)) ||
            (first == 192 && second == 88 && third == 99) ||
            (first == 192 && second == 168) ||
            (first == 198 && 18...19 ~= second) ||
            (first == 198 && second == 51 && third == 100) ||
            (first == 203 && second == 0 && third == 113) || first >= 224
        return reserved ? nil : octets
    }
}
