import PlayarrKit
import SwiftUI

/// Admin-only per-route HTTP request latency, matching the web "Request latency" settings page.
/// A 403 means "not an admin" and shows the "Admins only" state rather than an error.
struct RequestLatencyView: View {
    let transport: PlayarrRequestTransport
    @State private var state: HttpLatencyState = .loading
    /// Web mobile settings panel: no card, the empty states use the shared disc layout.
    var webStyle = false

    var body: some View {
        if webStyle { webBody } else { cardBody }
    }

    private var webBody: some View {
        Group {
            switch state {
            case .loading:
                WMText("Loading request latency\u{2026}", 16, 400, color: WM.muted, lh: 24)
            case .forbidden:
                WMEmptyStateRow(title: "Admins only", description: "Sign in with an admin account to see per-route request latency.")
                    .offset(x: 13)
            case .error(let message):
                WMEmptyStateRow(title: "Couldn't load request latency", description: message, isError: true).offset(x: 13)
            case .ready(let rows) where rows.isEmpty:
                WMEmptyStateRow(title: "No samples yet", description: "Latency samples will appear here once the server has handled some requests.")
                    .offset(x: 13)
            case .ready(let rows):
                table(rows)
            }
        }
        .frame(width: 318, alignment: .topLeading)
        .task {
            state = .loading
            state = await HttpLatencyClient(transport: transport).load()
        }
    }

    private var cardBody: some View {
        VStack(alignment: .leading, spacing: 17) {
            Text("Request latency").font(.title2.weight(.semibold)).foregroundStyle(PlayarrStyle.ink)
            Text("Per-route request latency, from slowest to fastest.")
                .font(.caption).foregroundStyle(PlayarrStyle.muted).lineSpacing(3)
            Divider().overlay(PlayarrStyle.line)
            content
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PlayarrStyle.surfaceStrong.opacity(0.7))
        .overlay { Rectangle().stroke(PlayarrStyle.line, lineWidth: 1) }
        .task {
            state = .loading
            state = await HttpLatencyClient(transport: transport).load()
        }
    }

    @ViewBuilder private var content: some View {
        switch state {
        case .loading:
            Text("Loading request latency…").font(.subheadline).foregroundStyle(PlayarrStyle.muted)
        case .forbidden:
            emptyState(title: "Admins only", description: "Sign in with an admin account to see per-route request latency.")
        case .error(let message):
            Text(message).font(.subheadline).foregroundStyle(PlayarrStyle.danger)
        case .ready(let rows) where rows.isEmpty:
            emptyState(title: "No samples yet", description: "Latency samples will appear here once the server has handled some requests.")
        case .ready(let rows):
            table(rows)
        }
    }

    private func emptyState(title: String, description: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline).foregroundStyle(PlayarrStyle.ink)
            Text(description).font(.subheadline).foregroundStyle(PlayarrStyle.muted)
        }
    }

    private func table(_ rows: [HttpRouteLatency]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 10) {
                GridRow {
                    ForEach(["Method", "Route", "Count", "Avg", "p50", "p95", "p99", "Max"], id: \.self) { heading in
                        Text(heading).font(.caption2.weight(.bold)).foregroundStyle(PlayarrStyle.muted)
                    }
                }
                Divider().overlay(PlayarrStyle.line)
                ForEach(rows) { row in
                    GridRow {
                        Text(row.method)
                        Text(row.route).font(.caption.monospaced())
                        Text("\(row.sampleCount)")
                        Text(HttpRouteLatency.formatMs(row.avgMs))
                        Text(HttpRouteLatency.formatMs(row.p50Ms))
                        Text(HttpRouteLatency.formatMs(row.p95Ms))
                        Text(HttpRouteLatency.formatMs(row.p99Ms))
                        Text(HttpRouteLatency.formatMs(row.maxMs))
                    }
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(PlayarrStyle.ink)
                }
            }
        }
        .accessibilityLabel("HTTP request latency by route")
    }
}
