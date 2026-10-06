import CoreImage
import CoreImage.CIFilterBuiltins
import PlayarrKit
import SwiftUI
import UIKit

/// Filters sheet: View, type, source, status, date range and monitored. Same fields as Web and Android.
struct CalendarFiltersSheet: View {
    @Bindable var viewModel: CalendarViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("View") {
                    Picker("View", selection: Binding(
                        get: { viewModel.mode },
                        set: { mode in Task { await viewModel.setMode(mode) } }
                    )) {
                        Text("Agenda").tag(CalendarViewMode.agenda)
                        Text("Week").tag(CalendarViewMode.week)
                        Text("Month").tag(CalendarViewMode.month)
                    }
                    .pickerStyle(.segmented)
                }
                Section("Type") {
                    ForEach(CalendarType.allCases, id: \.self) { type in
                        Toggle(type.title, isOn: membership(of: type, in: \.types))
                    }
                }
                if !viewModel.sources.isEmpty {
                    Section("Source") {
                        ForEach(viewModel.sources) { source in
                            Toggle(source.name, isOn: membership(of: source.sourceInstanceID, in: \.sources))
                        }
                    }
                }
                Section("Status") {
                    ForEach(CalendarStatus.allCases, id: \.self) { status in
                        Toggle(status.title, isOn: membership(of: status, in: \.statuses))
                    }
                }
                Section("Date range") {
                    dateRow(title: "From", value: $viewModel.filters.from)
                    dateRow(title: "To", value: $viewModel.filters.to)
                }
                Section {
                    Toggle("Monitored only", isOn: $viewModel.filters.monitoredOnly)
                }
                Section {
                    Button("Reset filters", role: .destructive) { viewModel.filters = CalendarFilters() }
                        .disabled(viewModel.filters.isEmpty)
                }
            }
            .scrollContentBackground(.hidden)
            .background(PlayarrStyle.background)
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .preferredColorScheme(.dark)
        .presentationDetents([.medium, .large])
    }

    private func membership<Element: Hashable>(
        of element: Element,
        in keyPath: WritableKeyPath<CalendarFilters, Set<Element>>
    ) -> Binding<Bool> {
        Binding(
            get: { viewModel.filters[keyPath: keyPath].contains(element) },
            set: { isOn in
                if isOn {
                    viewModel.filters[keyPath: keyPath].insert(element)
                } else {
                    viewModel.filters[keyPath: keyPath].remove(element)
                }
            }
        )
    }

    private func dateRow(title: String, value: Binding<String?>) -> some View {
        HStack {
            Toggle(title, isOn: Binding(
                get: { value.wrappedValue != nil },
                set: { isOn in
                    value.wrappedValue = isOn ? viewModel.today : nil
                }
            ))
            if let current = value.wrappedValue {
                DatePicker(
                    title,
                    selection: Binding(
                        get: { CalendarDays.displayDate(current) ?? Date() },
                        set: { value.wrappedValue = CalendarDays.format($0) }
                    ),
                    displayedComponents: .date
                )
                .labelsHidden()
                .environment(\.timeZone, TimeZone(identifier: "UTC") ?? .current)
            }
        }
    }
}

/// Calendar subscription: create or replace the secret iCal link, show it once with a QR code and
/// copy button, or revoke it. The server stores only a hash, so an existing link cannot be shown again.
struct CalendarSubscriptionSheet: View {
    @Bindable var viewModel: CalendarViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Subscribe to your Playarr calendar in Apple Calendar, Google Calendar or any app that supports iCal links. Anyone with the link can see your upcoming releases, so keep it private. Creating a new link stops the old one working.")
                        .font(.custom("Avenir Next", fixedSize: 13))
                        .foregroundStyle(PlayarrStyle.inkSoft)
                    stateContent
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(PlayarrStyle.background)
            .navigationTitle("Calendar link")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .preferredColorScheme(.dark)
        .presentationDetents([.medium, .large])
        .task { await viewModel.loadFeedStatus() }
    }

    @ViewBuilder
    private var stateContent: some View {
        switch viewModel.feedState {
        case .unknown, .loading:
            ProgressView().frame(maxWidth: .infinity)
        case .unsupported:
            Text("This server does not offer calendar links yet.")
                .foregroundStyle(PlayarrStyle.inkSoft)
        case .failed(let message):
            Text(message).foregroundStyle(PlayarrStyle.danger)
            Button("Try again") { Task { await viewModel.loadFeedStatus() } }
                .buttonStyle(PlayarrPrimaryButtonStyle())
        case .inactive:
            Text("You have no calendar link yet.").foregroundStyle(PlayarrStyle.inkSoft)
            Button("Create calendar link") { Task { await viewModel.createFeed() } }
                .buttonStyle(PlayarrPrimaryButtonStyle())
        case .active(let since):
            Text(activeText(since))
                .foregroundStyle(PlayarrStyle.inkSoft)
            Text("The link is only shown when it is created. Create a new one to see it again.")
                .font(.custom("Avenir Next", fixedSize: 12))
                .foregroundStyle(PlayarrStyle.muted)
            Button("Create a new link") { Task { await viewModel.createFeed() } }
                .buttonStyle(PlayarrPrimaryButtonStyle())
            Button("Revoke link", role: .destructive) { Task { await viewModel.revokeFeed() } }
        case .created(let url):
            if let image = Self.qrImage(for: url) {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 200, height: 200)
                    .padding(8)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 8))
                    .accessibilityLabel("QR code for the calendar link")
            }
            Text(url)
                .font(.system(size: 12, design: .monospaced))
                .textSelection(.enabled)
            Button(copied ? "Copied" : "Copy link") {
                UIPasteboard.general.string = url
                copied = true
            }
            .buttonStyle(PlayarrPrimaryButtonStyle())
            Button("Revoke link", role: .destructive) { Task { await viewModel.revokeFeed() } }
        }
    }

    private func activeText(_ since: Date?) -> String {
        guard let since else { return "You have an active calendar link." }
        return "You have an active calendar link, created \(since.formatted(date: .abbreviated, time: .omitted))."
    }

    static func qrImage(for text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
        let context = CIContext()
        guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
