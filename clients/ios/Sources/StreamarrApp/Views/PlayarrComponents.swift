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
    var image: UIImage?
    var failed = false

    func load(work: Work, kind: ImageKind, apiClient: StreamarrAPIClient) async {
        image = nil
        failed = false

        if let asset = work.images.first(where: { $0.kind == kind }) ?? work.images.first,
           let url = apiClient.resolvedURL(forPath: asset.url) ?? URL(string: asset.url),
           let (data, _) = try? await URLSession.shared.data(from: url),
           let decoded = UIImage(data: data) {
            image = decoded
            return
        }

        do {
            let data = try await apiClient.fetchArtwork(workID: work.id, kind: kind)
            image = UIImage(data: data)
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
