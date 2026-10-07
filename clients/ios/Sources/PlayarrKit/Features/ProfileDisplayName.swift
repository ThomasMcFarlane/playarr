import Foundation

/// Which name a client shows for the signed-in profile: the profile's display name from the
/// server's profile list, never the username that was typed to sign in (Web and Android do the same).
public enum ProfileDisplayName {
    /// The display name of the profile that is signed in.
    ///
    /// Matches on the signed-in user id first, then on the server's `is_current` flag. Falls back to
    /// `fallback` (a previously resolved name, kept so an offline start still shows one) and never to
    /// the typed username.
    public static func resolve(
        profiles: [AvailableProfile],
        currentUserID: UUID?,
        fallback: String? = nil
    ) -> String? {
        let current = profiles.first(where: { $0.id == currentUserID }) ?? profiles.first(where: \.isCurrent)
        let name = current?.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        if let name, !name.isEmpty { return name }
        return fallback
    }
}

public extension PlayarrAPIClient {
    /// Resolves the signed-in profile's display name from `GET /api/v1/profiles`; `nil` when the
    /// list is unavailable (the caller keeps the name it already has).
    func resolveCurrentProfileName(currentUserID: UUID?) async -> String? {
        guard let profiles = try? await listProfiles(), !profiles.isEmpty else { return nil }
        return ProfileDisplayName.resolve(profiles: profiles, currentUserID: currentUserID)
    }
}
