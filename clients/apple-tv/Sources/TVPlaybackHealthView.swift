import AVFoundation
import PlayarrKit
import SwiftUI

/// "Playback health" for Apple TV: same sections and wording as the other
/// clients. The export is shown on screen; there is no share target on tvOS.
struct TVPlaybackHealthView: View {
    @State private var model: PlaybackHealthModel
    @Environment(\.dismiss) private var dismiss

    init(transport: PlayarrRequestTransport, sessionID: UUID?, player: AVPlayer?) {
        _model = State(initialValue: PlaybackHealthModel(transport: transport, sessionID: sessionID, player: player))
    }

    var body: some View {
        ZStack {
            DesignTokens.Color.backgroundBase.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("Playback health")
                        .font(TVTheme.titleFont())
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                    content
                    connection
                    Button("Close") { dismiss() }
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                }
                .padding(DesignTokens.Spacing.xl)
                .frame(maxWidth: 1100, alignment: .leading)
            }
        }
        .task { await model.refresh() }
        .onDisappear { model.cancelConnectionTest() }
    }

    private func caption(_ text: String, error: Bool = false) -> some View {
        Text(text)
            .font(TVTheme.captionFont())
            .foregroundStyle(error ? DesignTokens.Color.stateError : DesignTokens.Color.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .idle, .loading:
            ProgressView("Checking this playback").tint(DesignTokens.Color.brandPrimary)
        case .failed(let message):
            caption(message)
        case .loaded(let report):
            Text(report.headline)
                .font(TVTheme.bodyFont(emphasis: true))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            ForEach(report.findings, id: \.code) { finding in
                VStack(alignment: .leading, spacing: 4) {
                    Text(finding.title)
                        .font(TVTheme.bodyFont(emphasis: true))
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                    caption(finding.detail)
                    if let next = finding.nextAction { caption(next) }
                }
            }
            Button(model.showTechnicalDetail ? "Hide technical detail" : "Technical detail") {
                model.showTechnicalDetail.toggle()
            }
            .foregroundStyle(DesignTokens.Color.brandPrimary)
            if model.showTechnicalDetail {
                ForEach(report.facts, id: \.key) { fact in
                    caption("\(fact.label): \(fact.value ?? "Unknown") (\(PlaybackHealthModel.provenanceLabel(fact.provenance)))")
                }
                if !report.exportText.isEmpty {
                    caption("Diagnostic export, redacted by the server. Nothing is shared from this screen.")
                    Text(report.exportText)
                        .font(.system(size: 18, design: .monospaced))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    @ViewBuilder
    private var connection: some View {
        Divider().background(DesignTokens.Color.borderDefault.opacity(0.35))
        Text("Connection test")
            .font(TVTheme.bodyFont(emphasis: true))
            .foregroundStyle(DesignTokens.Color.textPrimary)
        caption("Downloads a small file from your server. Playback may stutter briefly while it runs.")
        switch model.connection {
        case .idle:
            Button("Run connection test") { model.runConnectionTest() }
                .foregroundStyle(DesignTokens.Color.brandPrimary)
        case .running:
            ProgressView().tint(DesignTokens.Color.brandPrimary)
            Button("Cancel") { model.cancelConnectionTest() }
                .foregroundStyle(DesignTokens.Color.textSecondary)
        case .done(let result):
            caption("About \(PlaybackHealthModel.megabits(result)) to your server.")
            Button("Run again") { model.runConnectionTest() }
                .foregroundStyle(DesignTokens.Color.brandPrimary)
        case .failed(let message):
            caption(message, error: true)
            Button("Try again") { model.runConnectionTest() }
                .foregroundStyle(DesignTokens.Color.brandPrimary)
        }
    }
}
