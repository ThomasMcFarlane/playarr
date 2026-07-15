import StreamarrKit
import SwiftUI

struct HomeView: View {
    let viewModel: HomeViewModel

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Home")
                .task { await viewModel.load() }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.loadState {
        case .idle, .loading:
            ProgressView("Loading your library…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView(
                "Couldn't load Home",
                systemImage: "exclamationmark.triangle",
                description: Text(message)
            )
        case .loaded:
            List {
                if !viewModel.continueWatching.isEmpty {
                    Section("Continue Watching") {
                        ForEach(viewModel.continueWatching) { session in
                            LabeledContent(session.workID.uuidString, value: Self.formatted(session.positionSeconds))
                        }
                    }
                }
                Section("Recently Added") {
                    if viewModel.recentlyAdded.isEmpty {
                        Text("Nothing here yet.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(viewModel.recentlyAdded) { work in
                            Text(work.title)
                        }
                    }
                }
            }
        }
    }

    private static func formatted(_ seconds: Double) -> String {
        let totalSeconds = Int(seconds)
        return String(format: "%02d:%02d", totalSeconds / 60, totalSeconds % 60)
    }
}

#Preview {
    HomeView(viewModel: HomeViewModel(apiClient: PreviewAPIClient()))
}
