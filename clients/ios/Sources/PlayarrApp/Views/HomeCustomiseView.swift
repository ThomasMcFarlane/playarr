import Observation
import PlayarrKit
import SwiftUI

@MainActor
@Observable
private final class HomeCustomiseModel {
    enum State { case loading, ready, failed(String) }
    private(set) var state: State = .loading
    private(set) var rails: [RailPreferenceEntry] = []
    private(set) var saveError: String?
    private let client: HomeRailPreferencesClient
    private let language: String

    init(apiClient: PlayarrAPIClient) {
        client = HomeRailPreferencesClient(transport: apiClient)
        language = HomeRailsClient.railLanguage(forLocaleIdentifier: Locale.preferredLanguages.first ?? "en")
    }

    func load() async {
        do {
            rails = try await client.load(language: language)
            state = .ready
        } catch let error as APIError {
            state = .failed(error.displayMessage)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func apply(_ next: [RailPreferenceEntry]) {
        rails = next
        saveError = nil
        Task {
            do { try await client.save(next) } catch let error as APIError {
                saveError = error.displayMessage
            } catch {
                saveError = error.localizedDescription
            }
        }
    }

    func toggle(_ id: String) { apply(HomeRailEdits.toggle(rails, id: id)) }
    func move(_ id: String, by direction: Int) { apply(HomeRailEdits.move(rails, id: id, by: direction)) }

    func reset() async {
        saveError = nil
        do {
            try await client.reset()
            rails = try await client.load(language: language)
        } catch let error as APIError {
            saveError = error.displayMessage
        } catch {
            saveError = error.localizedDescription
        }
    }
}

/// Per-user Home rail visibility and order, saved on every change (web `HomeCustomisePage`).
struct HomeCustomiseView: View {
    let apiClient: PlayarrAPIClient
    @Environment(\.dismiss) private var dismiss
    @State private var model: HomeCustomiseModel

    init(apiClient: PlayarrAPIClient) {
        self.apiClient = apiClient
        _model = State(initialValue: HomeCustomiseModel(apiClient: apiClient))
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            WM.page.ignoresSafeArea()
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 12) {
                    switch model.state {
                    case .loading:
                        Text("Loading your rails").font(WM.font(8.8)).foregroundStyle(WM.muted)
                    case .failed(let message):
                        Text("Home isn\u{2019}t available").font(WM.font(16, 700)).foregroundStyle(WM.ink)
                        Text(message).font(WM.font(10.88)).foregroundStyle(WM.muted)
                    case .ready:
                        Text("Choose which rails appear on Home and in what order.")
                            .font(WM.font(8.8)).foregroundStyle(WM.muted)
                        ForEach(Array(model.rails.enumerated()), id: \.element.id) { index, rail in
                            row(rail, index: index)
                        }
                        Button { Task { await model.reset() } } label: {
                            Text("Reset to default")
                                .font(WM.font(11.52, 720)).foregroundStyle(WM.inkSoft)
                                .padding(.horizontal, 18).frame(height: 40)
                                .background(WM.chip.opacity(0.66), in: Capsule())
                                .overlay(Capsule().stroke(WM.line.opacity(0.14), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                    if let saveError = model.saveError {
                        Text(saveError).font(WM.font(10.88)).foregroundStyle(PlayarrStyle.danger)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 84)
                .padding(.bottom, 130)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.hidden)

            WMHeaderCircleButton(width: 42, height: 38, glyph: "\u{2190}", action: { dismiss() })
                .offset(x: 16, y: WM.topInset + 2)
            WMText("Customise Home", 17.6, 580, lh: 26.4, ls: -0.792)
                .frame(height: 38)
                .offset(x: 68, y: WM.topInset + 2)
        }
        .ignoresSafeArea()
        .navigationBarHidden(true)
        .playarrChromeHidden()
        .task { await model.load() }
    }

    private func row(_ rail: RailPreferenceEntry, index: Int) -> some View {
        HStack(spacing: 8) {
            Text(rail.title)
                .font(WM.font(12.48, 610))
                .foregroundStyle(rail.hidden ? WM.muted : WM.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
            small(rail.hidden ? "Show" : "Hide") { model.toggle(rail.id) }
            small("\u{2191}") { model.move(rail.id, by: -1) }.disabled(index == 0)
            small("\u{2193}") { model.move(rail.id, by: 1) }.disabled(index == model.rails.count - 1)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(WM.artFill.opacity(0.45), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func small(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(WM.font(9.92, 700)).foregroundStyle(WM.inkSoft)
                .frame(minWidth: 32).padding(.horizontal, 8).frame(height: 30)
                .background(WM.chip.opacity(0.66), in: Capsule())
                .overlay(Capsule().stroke(WM.line.opacity(0.14), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}
