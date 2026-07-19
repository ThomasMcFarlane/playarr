import Observation
import StreamarrKit
import SwiftUI
import UIKit

enum PlayarrStyle {
    static let background = adaptive(light: (0.961, 0.953, 0.949), dark: (0.082, 0.074, 0.082))
    static let surface = adaptive(light: (0.985, 0.980, 0.976), dark: (0.106, 0.094, 0.106))
    static let surfaceStrong = adaptive(light: (1, 1, 1), dark: (0.129, 0.114, 0.129))
    static let ink = adaptive(light: (0.220, 0.149, 0.129), dark: (0.957, 0.941, 0.945))
    static let inkSoft = adaptive(light: (0.404, 0.349, 0.380), dark: (0.773, 0.722, 0.741))
    static let muted = adaptive(light: (0.647, 0.588, 0.620), dark: (0.533, 0.478, 0.510))
    static let pink = Color(red: 0.812, green: 0.192, blue: 0.341)
    static let accent = adaptive(light: (0.404, 0.349, 0.380), dark: (0.875, 0.863, 0.867))
    static let onAccent = adaptive(light: (1, 1, 1), dark: (0.129, 0.114, 0.129))
    static let line = adaptive(light: (0.220, 0.149, 0.129), dark: (0.875, 0.863, 0.867)).opacity(0.14)
    static let lineStrong = adaptive(light: (0.220, 0.149, 0.129), dark: (0.875, 0.863, 0.867)).opacity(0.28)
    static let danger = adaptive(light: (0.659, 0.275, 0.298), dark: (0.933, 0.573, 0.592))
    static let navBackground = adaptive(light: (1, 1, 1), dark: (0.129, 0.114, 0.129)).opacity(0.88)
    static let cornerRadius: CGFloat = 22

    private static func adaptive(
        light: (CGFloat, CGFloat, CGFloat),
        dark: (CGFloat, CGFloat, CGFloat)
    ) -> Color {
        Color(uiColor: UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: value.0, green: value.1, blue: value.2, alpha: 1)
        })
    }
}

enum PlayarrLayout {
    /// Matches Playarr Web's mobile breakpoint, including coarse-pointer
    /// phones in landscape. Width alone misclassified modern iPhones as the
    /// desktop/TV stage and was the source of the broken landscape layouts.
    static func isPhone(_ size: CGSize) -> Bool {
        size.width <= 760 || (
            UIDevice.current.userInterfaceIdiom == .phone &&
            size.width <= 920 && size.height <= 500
        )
    }
}

struct PlayarrLogo: View {
    var size: CGFloat = 42

    var body: some View {
        Image("PlayarrLogo")
            .resizable()
            .scaledToFit()
        .frame(width: size, height: size)
        .accessibilityLabel("Playarr")
    }
}

@MainActor
@Observable
private final class ArtworkLoader {
    private static let cache = NSCache<NSString, UIImage>()
    var image: UIImage?
    var failed = false

    func load(work: Work, kind: ImageKind, apiClient: StreamarrAPIClient) async {
        let cacheKey = "work:\(work.id.uuidString):\(kind.rawValue)" as NSString
        if let cached = Self.cache.object(forKey: cacheKey) {
            image = cached
            failed = false
            return
        }
        image = nil
        failed = false

        if let asset = work.images.first(where: { $0.kind == kind }) ?? work.images.first,
           !asset.url.hasPrefix("/") && !asset.url.contains("/api/v1/artwork/"),
           let url = URL(string: asset.url) {
            var request = URLRequest(url: url)
            request.timeoutInterval = 12
            if let (data, response) = try? await URLSession.shared.data(for: request),
               (response as? HTTPURLResponse)?.statusCode == 200,
               let decoded = UIImage(data: data) {
                Self.cache.setObject(decoded, forKey: cacheKey)
                image = decoded
                return
            }
        }

        do {
            let data = try await apiClient.fetchArtwork(workID: work.id, kind: kind)
            image = UIImage(data: data)
            if let image { Self.cache.setObject(image, forKey: cacheKey) }
            failed = image == nil
        } catch {
            failed = true
        }
    }
}

struct PlayarrArtwork: View {
    let work: Work
    let kind: ImageKind
    let apiClient: StreamarrAPIClient

    @State private var loader = ArtworkLoader()

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.19, green: 0.13, blue: 0.17),
                    Color(red: 0.075, green: 0.062, blue: 0.075),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            if let image = loader.image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .transition(.opacity)
            } else {
                PlayarrLogo(size: 46)
                    .opacity(0.84)
            }
        }
        .clipped()
        .task(id: "\(work.id)-\(kind.rawValue)") {
            await loader.load(work: work, kind: kind, apiClient: apiClient)
        }
    }
}

@MainActor
@Observable
private final class AlbumArtworkLoader {
    private static let cache = NSCache<NSString, UIImage>()
    var image: UIImage?

    func load(artistWorkID: UUID, albumID: UUID, apiClient: StreamarrAPIClient) async {
        let cacheKey = "album:\(artistWorkID.uuidString):\(albumID.uuidString)" as NSString
        if let cached = Self.cache.object(forKey: cacheKey) {
            image = cached
            return
        }
        guard let data = try? await apiClient.fetchAlbumArtwork(
            artistWorkID: artistWorkID, albumID: albumID, kind: .poster
        ) else { return }
        image = UIImage(data: data)
        if let image { Self.cache.setObject(image, forKey: cacheKey) }
    }
}

struct PlayarrProfileAvatar: View {
    let preference: ProfileAvatarPreference?
    let userID: UUID?
    let userName: String?
    let size: CGFloat

    var body: some View {
        ZStack {
            if let customImage {
                Image(uiImage: customImage)
                    .resizable()
                    .scaledToFill()
            } else {
                Circle().fill(
                    LinearGradient(
                        colors: colours(for: presetID),
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                Image(systemName: symbol(for: presetID))
                    .font(.system(size: size * 0.4, weight: .ultraLight))
                    .foregroundStyle(.white.opacity(0.96))
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityLabel("\(userName ?? "Playarr") avatar")
    }

    private var customImage: UIImage? {
        guard preference?.kind == .custom,
              let value = preference?.value,
              let comma = value.firstIndex(of: ","),
              let data = Data(base64Encoded: String(value[value.index(after: comma)...])) else {
            return nil
        }
        return UIImage(data: data)
    }

    private var presetID: String {
        if preference?.kind == .preset, let value = preference?.value { return value }
        guard let userID else { return "alien" }
        var hash: UInt32 = 0
        for scalar in userID.uuidString.lowercased().unicodeScalars {
            hash = hash &* 31 &+ UInt32(scalar.value)
        }
        return Self.presets[Int(hash % UInt32(Self.presets.count))]
    }

    private func symbol(for preset: String) -> String {
        switch preset {
        case "astronaut": "moon.stars"
        case "cat": "cat"
        case "dinosaur": "fossil.shell"
        case "robot": "cpu"
        case "pirate": "sailboat"
        default: "sparkles"
        }
    }

    private func colours(for preset: String) -> [Color] {
        switch preset {
        case "astronaut": [Color(red: 0.32, green: 0.40, blue: 0.68), Color(red: 0.13, green: 0.18, blue: 0.37)]
        case "cat": [Color(red: 0.89, green: 0.49, blue: 0.41), Color(red: 0.61, green: 0.25, blue: 0.40)]
        case "dinosaur": [Color(red: 0.33, green: 0.64, blue: 0.43), Color(red: 0.14, green: 0.45, blue: 0.40)]
        case "robot": [Color(red: 0.36, green: 0.61, blue: 0.69), Color(red: 0.21, green: 0.33, blue: 0.51)]
        case "pirate": [Color(red: 0.83, green: 0.60, blue: 0.28), Color(red: 0.57, green: 0.27, blue: 0.30)]
        default: [Color(red: 0.55, green: 0.44, blue: 0.77), Color(red: 0.29, green: 0.28, blue: 0.50)]
        }
    }

    private static let presets = ["astronaut", "cat", "dinosaur", "robot", "pirate", "alien"]
}

struct PlayarrAlbumArtwork: View {
    let artistWorkID: UUID
    let albumID: UUID
    let apiClient: StreamarrAPIClient
    @State private var loader = AlbumArtworkLoader()

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.24, green: 0.15, blue: 0.21), Color(red: 0.08, green: 0.065, blue: 0.08)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            if let image = loader.image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: "music.note").font(.system(size: 38, weight: .ultraLight)).foregroundStyle(PlayarrStyle.pink)
            }
        }
        .clipped()
        .task(id: "\(artistWorkID)-\(albumID)") {
            await loader.load(artistWorkID: artistWorkID, albumID: albumID, apiClient: apiClient)
        }
    }
}

struct PlayarrMediaCard: View {
    let work: Work
    let apiClient: StreamarrAPIClient
    var progress: WatchProgress?
    var width: CGFloat = 178

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            PlayarrArtwork(work: work, kind: .backdrop, apiClient: apiClient)
                .aspectRatio(16 / 9, contentMode: .fit)
                .frame(width: width)
                .clipShape(RoundedRectangle(cornerRadius: min(13, max(8, width * 0.058)), style: .continuous))
                .shadow(color: PlayarrStyle.ink.opacity(0.1), radius: 17, y: 6)
                .overlay(alignment: .bottom) {
                    if let progress, progress.durationMS > 0 {
                        GeometryReader { proxy in
                            Capsule()
                                .fill(.white.opacity(0.28))
                                .overlay(alignment: .leading) {
                                    Capsule()
                                        .fill(PlayarrStyle.pink)
                                        .frame(width: proxy.size.width * min(1, Double(progress.positionMS) / Double(progress.durationMS)))
                                }
                        }
                        .frame(height: 3)
                        .padding(8)
                    }
                }

            Text(work.title)
                .font(.custom("Avenir Next", fixedSize: width <= 210 ? 12.5 : 11).weight(.semibold))
                .foregroundStyle(PlayarrStyle.ink)
                .lineLimit(1)
            Text(work.kind.displayName)
                .font(.custom("Avenir Next", fixedSize: width <= 210 ? 10 : 8.5).weight(.semibold))
                .foregroundStyle(PlayarrStyle.muted)
        }
        .frame(width: width, alignment: .leading)
    }
}

struct PlayarrPosterCard: View {
    let work: Work
    let apiClient: StreamarrAPIClient

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            PlayarrArtwork(work: work, kind: .poster, apiClient: apiClient)
                .aspectRatio(2 / 3, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .shadow(color: PlayarrStyle.ink.opacity(0.12), radius: 18, y: 8)
            Text(work.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(PlayarrStyle.ink)
                .lineLimit(1)
            Text(work.kind.displayName)
                .font(.caption2.weight(.bold))
                .foregroundStyle(PlayarrStyle.muted)
                .textCase(.uppercase)
        }
    }
}

struct PlayarrLoadingView: View {
    let title: String

    var body: some View {
        VStack(spacing: 16) {
            ProgressView().tint(PlayarrStyle.pink).controlSize(.large)
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(PlayarrStyle.inkSoft)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PlayarrStyle.background)
    }
}

struct PlayarrFailureView: View {
    let title: String
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(PlayarrStyle.pink)
            Text(title).font(.title3.weight(.bold))
            Text(message)
                .font(.footnote)
                .foregroundStyle(PlayarrStyle.inkSoft)
                .multilineTextAlignment(.center)
            Button("Try again", action: retry)
                .buttonStyle(PlayarrPrimaryButtonStyle())
        }
        .padding(30)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(PlayarrStyle.ink)
        .background(PlayarrStyle.background)
    }
}

struct PlayarrPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.bold))
            .foregroundStyle(PlayarrStyle.onAccent)
            .padding(.horizontal, 24)
            .frame(minHeight: 48)
            .background(PlayarrStyle.accent.opacity(configuration.isPressed ? 0.78 : 1), in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
    }
}

extension WorkKind {
    var displayName: String {
        switch self {
        case .movie: "Movies"
        case .series: "Series"
        case .site: "Sites"
        case .artist: "Music"
        case .author: "Books"
        }
    }

    var symbolName: String {
        switch self {
        case .movie: "film"
        case .series: "rectangle.stack"
        case .site: "globe"
        case .artist: "music.note"
        case .author: "books.vertical"
        }
    }
}
