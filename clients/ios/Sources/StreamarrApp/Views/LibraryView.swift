import StreamarrKit
import SwiftUI

struct LibraryView: View {
    let viewModel: LibraryViewModel

    var body: some View {
        NavigationStack {
            List(viewModel.works) { work in
                NavigationLink(work.title) {
                    Text(work.overview ?? "No overview available.")
                        .navigationTitle(work.title)
                }
            }
            .navigationTitle("Library")
            .overlay {
                if viewModel.isLoading {
                    ProgressView()
                } else if viewModel.works.isEmpty {
                    ContentUnavailableView("No Works Yet", systemImage: "film.stack")
                }
            }
            .task {
                await viewModel.loadLibraries()
                await viewModel.loadWorks()
            }
            .refreshable {
                await viewModel.loadWorks()
            }
            .alert(
                "Error",
                isPresented: Binding(
                    get: { viewModel.errorMessage != nil },
                    set: { isPresented in if !isPresented { viewModel.dismissError() } }
                ),
                presenting: viewModel.errorMessage
            ) { _ in
                Button("OK", role: .cancel) {}
            } message: { message in
                Text(message)
            }
        }
    }
}

#Preview {
    LibraryView(viewModel: LibraryViewModel(apiClient: PreviewAPIClient()))
}
