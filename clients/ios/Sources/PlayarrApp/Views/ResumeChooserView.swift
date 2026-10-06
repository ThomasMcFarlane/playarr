import PlayarrKit
import SwiftUI

/// What the player should open for one resume choice.
struct ResumePlayRequest: Identifiable, Hashable {
    let mediaFileID: UUID
    let title: String
    let subtitle: String
    let workID: UUID
    let queue: [PlaybackQueueEntry]

    var id: UUID { mediaFileID }

    static func make(option: ResumeOption, detail: WorkDetail?, workID: UUID, seriesTitle: String) -> ResumePlayRequest {
        var queue: [PlaybackQueueEntry] = []
        if let detail, case .series(let seasons) = detail.children {
            queue = PlaybackQueueBuilder.episodes(after: option.episodeID, seriesTitle: seriesTitle, seasons: seasons)
        }
        let title = option.title ?? "Episode \(option.episodeNumber)"
        return ResumePlayRequest(
            mediaFileID: option.mediaFileID,
            title: title,
            subtitle: "\(seriesTitle) · \(option.label)",
            workID: workID,
            queue: queue
        )
    }
}

/// Chooser shown only when the server says the history is ambiguous
/// (`needs_choice`). Closing it without picking records nothing.
struct ResumeChooserView: View {
    let seriesTitle: String
    let plan: ResumePlan
    let onPick: (ResumeOption) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Choose what to watch next in \(seriesTitle).")
                        .font(.subheadline)
                        .foregroundStyle(PlayarrStyle.inkSoft)
                    ForEach(plan.options) { option in
                        Button {
                            onPick(option)
                        } label: {
                            optionRow(option)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .background(PlayarrStyle.surface)
            .navigationTitle("Start or resume")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func optionRow(_ option: ResumeOption) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(option.kind.caption.uppercased())
                .font(.caption2.weight(.heavy))
                .foregroundStyle(PlayarrStyle.pink)
            Text(option.title.map { "\(option.label) · \($0)" } ?? option.label)
                .font(.headline)
                .foregroundStyle(PlayarrStyle.ink)
            if option.progressPercent > 0 {
                Text("\(option.progressPercent)% watched")
                    .font(.caption)
                    .foregroundStyle(PlayarrStyle.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(PlayarrStyle.surfaceStrong, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
        .accessibilityElement(children: .combine)
    }
}
