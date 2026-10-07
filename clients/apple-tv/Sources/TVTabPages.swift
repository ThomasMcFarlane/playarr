import PlayarrKit
import SwiftUI
import UIKit

/// The web's `TvEmptyState` page variant: a disc with the "details" graphic and a title with a
/// short explanation, centred as a group at x 1127 on the 1920 stage.
struct TVEmptyStateBlock: View {
    var title: String
    var detail: String
    var top: CGFloat

    var body: some View {
        let font = TVFontLoader.uiFont(mono: false, size: 22.08, weight: 650)
        let titleWidth = (title as NSString).size(withAttributes: [.font: font, .kern: -0.44]).width
        let textWidth = max(212, ceil(titleWidth) + 0.5)
        let total = 164 + 42 + textWidth
        let left = 1127.2 - total / 2
        ZStack(alignment: .topLeading) {
            Circle()
                .fill(DesignTokens.Color.backgroundInputDisabled.opacity(0.54))
                .overlay(Circle().stroke(DesignTokens.Color.borderDefault.opacity(0.5), lineWidth: 1))
                .placed(x: left, y: top, w: 164, h: 164)
            TVDetailsGraphic()
                .stroke(DesignTokens.Color.brandPrimary, style: StrokeStyle(lineWidth: 2.6, lineCap: .round, lineJoin: .round))
                .frame(width: 70, height: 46.7)
                .placed(x: left + 47, y: top + 58.7, w: 70, h: 46.7)
            Text(title)
                .font(TVTheme.font(size: 22.08, weight: .semibold))
                .tracking(-0.44)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .lineLimit(1)
                .placed(x: left + 206, y: top + 45.7, w: textWidth, h: 33.1)
            Text(detail)
                .font(TVTheme.font(size: 10.75, weight: .regular))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .lineLimit(3)
                .frame(width: 212, alignment: .leading)
                .placed(x: left + 206, y: top + 86, w: 212, h: 32.3, alignment: .topLeading)
        }
    }
}

/// Shared page chrome of Downloads, Watchlist and Requests: stage, wash, header and the right-hand panel.
private struct TVTabPage<Content: View>: View {
    var title: String
    var detail: String? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        ZStack(alignment: .topLeading) {
            DesignTokens.Color.backgroundElevated.ignoresSafeArea()
            TVStageWash()
            TVRailPanelGradient(width: 1190.4)
            TVPageHeader(title: title)
            if let detail {
                Rectangle()
                    .fill(DesignTokens.Color.borderDefault.opacity(0.5))
                    .frame(width: 255.3, height: 1)
                    .placed(x: 226.6, y: 112.1, w: 255.3, h: 1)
                Text(detail.uppercased())
                    .font(TVTheme.font(size: 11.14, weight: .semibold))
                    .tracking(0.5)
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                    .lineLimit(1)
                    .placed(x: 226.6, y: 115, w: 480, h: 24.1)
            }
            content()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea()
    }
}

/// Downloads: Apple TV streams from the server and keeps no offline copies, so the page says so
/// (the web shows the device storage bar and its downloaded titles).
struct TVDownloadsView: View {
    var body: some View {
        TVTabPage(title: "Downloads", detail: "0 MB of 2.00 GB used on this device") {
            Text("0 MB of 2.00 GB used on this device")
                .font(TVTheme.font(size: 10.88, weight: .regular))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .placed(x: 787.2, y: 57.6, w: 1075.2, h: 16.3)
            Capsule()
                .fill(DesignTokens.Color.backgroundRaised)
                .placed(x: 787.2, y: 81.9, w: 1075.2, h: 4)
            TVEmptyStateBlock(
                title: "No downloads yet",
                detail: "Apple TV streams from your server and keeps no offline copies.",
                top: 139.9
            )
        }
    }
}

struct TVWatchlistView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var items: [WatchlistItem]?

    var body: some View {
        TVTabPage(title: "Watchlist") {
            if let items, !items.isEmpty {
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 18) {
                        ForEach(items) { item in
                            Text([item.title, item.year.map(String.init)].compactMap { $0 }.joined(separator: " \u{00B7} "))
                                .font(TVTheme.font(size: 19.2, weight: .semibold))
                                .foregroundStyle(DesignTokens.Color.textPrimary)
                        }
                    }
                    .padding(.bottom, 80)
                }
                .frame(width: 1000, height: 820, alignment: .topLeading)
                .placed(x: 881.6, y: 162, w: 1000, h: 820, alignment: .topLeading)
            } else if items != nil {
                TVEmptyStateBlock(
                    title: "Your watchlist is empty",
                    detail: "Add titles from search or a title page to keep them here on every device.",
                    top: 89.6
                )
            }
        }
        .task(id: environment.serverURL) {
            items = (try? await environment.apiClient.listWatchlistItems()) ?? []
        }
    }
}

struct TVRequestsView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var requests: [RequestSummary]?

    var body: some View {
        TVTabPage(title: "Requests") {
            if let requests, !requests.isEmpty {
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 18) {
                        ForEach(requests) { request in
                            HStack(spacing: 16) {
                                Text([request.title, request.year.map(String.init)].compactMap { $0 }.joined(separator: " \u{00B7} "))
                                    .font(TVTheme.font(size: 19.2, weight: .semibold))
                                    .foregroundStyle(DesignTokens.Color.textPrimary)
                                Text(request.status.replacingOccurrences(of: "_", with: " ").uppercased())
                                    .font(TVTheme.font(size: 10.9, weight: .bold))
                                    .tracking(0.7)
                                    .foregroundStyle(DesignTokens.Color.textDisabled)
                            }
                        }
                    }
                    .padding(.bottom, 80)
                }
                .frame(width: 1000, height: 820, alignment: .topLeading)
                .placed(x: 881.6, y: 162, w: 1000, h: 820, alignment: .topLeading)
            } else if requests != nil {
                TVEmptyStateBlock(
                    title: "No requests yet",
                    detail: "Request a title that is not in the library and its progress shows up here.",
                    top: 89.6
                )
            }
        }
        .task(id: environment.serverURL) {
            requests = (try? await environment.apiClient.listMyRequests()) ?? []
        }
    }
}
