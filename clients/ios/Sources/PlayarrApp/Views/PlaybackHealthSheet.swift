import AVFoundation
import PlayarrKit
import SwiftUI

/// "Playback health": why this is (or is not) direct playing, whether HDR and
/// surround are confirmed, and a connection test, with a redacted export that is
/// only shared on an explicit action.
struct PlaybackHealthSheet: View {
    @State private var model: PlaybackHealthModel
    @Environment(\.dismiss) private var dismiss

    init(transport: PlayarrRequestTransport, sessionID: UUID?, player: AVPlayer?) {
        _model = State(initialValue: PlaybackHealthModel(transport: transport, sessionID: sessionID, player: player))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    switch model.state {
                    case .idle, .loading:
                        ProgressView("Checking this playback")
                    case .failed(let message):
                        Text(message).foregroundStyle(.secondary)
                    case .loaded(let report):
                        summary(report)
                        findings(report)
                        Toggle("Technical detail", isOn: $model.showTechnicalDetail)
                        if model.showTechnicalDetail { facts(report) }
                        exportSection(report)
                    }
                    connectionSection
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationTitle("Playback health")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .task { await model.refresh() }
        .onDisappear { model.cancelConnectionTest() }
    }

    private func summary(_ report: PlaybackHealthReport) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(report.headline).font(.title3.weight(.semibold))
            Text(label(for: report.severity)).font(.caption).foregroundStyle(.secondary)
        }
    }

    private func findings(_ report: PlaybackHealthReport) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(report.findings, id: \.code) { finding in
                VStack(alignment: .leading, spacing: 4) {
                    Text(finding.title).font(.subheadline.weight(.semibold))
                    Text(finding.detail).font(.footnote).foregroundStyle(.secondary)
                    if let next = finding.nextAction {
                        Text(next).font(.footnote.weight(.medium))
                    }
                }
            }
        }
    }

    private func facts(_ report: PlaybackHealthReport) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(report.facts, id: \.key) { fact in
                VStack(alignment: .leading, spacing: 2) {
                    Text(fact.label).font(.footnote.weight(.semibold))
                    Text(fact.value ?? "Unknown").font(.footnote)
                    Text(PlaybackHealthModel.provenanceLabel(fact.provenance))
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            Text(report.qualification.note).font(.caption2).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func exportSection(_ report: PlaybackHealthReport) -> some View {
        if !report.exportText.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Diagnostic export").font(.subheadline.weight(.semibold))
                Text("Redacted by the server: no titles, accounts, addresses or identifiers. Nothing is shared until you choose to.")
                    .font(.caption).foregroundStyle(.secondary)
                ShareLink(item: report.exportText) { Label("Share export", systemImage: "square.and.arrow.up") }
            }
        }
    }

    private var connectionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Connection test").font(.subheadline.weight(.semibold))
            Text("Downloads a small file from your server. Playback may stutter briefly while it runs.")
                .font(.caption).foregroundStyle(.secondary)
            switch model.connection {
            case .idle:
                Button("Run connection test") { model.runConnectionTest() }
            case .running:
                HStack { ProgressView(); Button("Cancel") { model.cancelConnectionTest() } }
            case .done(let result):
                Text("About \(PlaybackHealthModel.megabits(result)) to your server.").font(.footnote)
                Button("Run again") { model.runConnectionTest() }
            case .failed(let message):
                Text(message).font(.footnote).foregroundStyle(.secondary)
                Button("Try again") { model.runConnectionTest() }
            }
        }
    }

    private func label(for severity: HealthSeverity) -> String {
        switch severity {
        case .ok: return "Everything looks fine"
        case .info: return "For information"
        case .warning: return "Worth a look"
        case .problem: return "Needs attention"
        }
    }
}
