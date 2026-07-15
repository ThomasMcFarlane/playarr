import StreamarrKit
import SwiftUI

struct SettingsView: View {
    @Bindable var viewModel: SettingsViewModel

    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Server URL", text: $viewModel.serverBaseURLText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)

                    Button("Save") {
                        viewModel.applyServerURL()
                    }
                } header: {
                    Text("Server")
                } footer: {
                    Text("Defaults to http://localhost:8080. Point this at whichever Streamarr server instance you run.")
                }

                Section("Account") {
                    if viewModel.isSignedIn {
                        LabeledContent("Status", value: "Signed in")
                        Button("Sign Out", role: .destructive) {
                            Task { await viewModel.signOut() }
                        }
                    } else if let deviceCode = viewModel.deviceCode {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Go to \(deviceCode.verificationUri)")
                            Text("and enter code: \(deviceCode.userCode)")
                                .font(.title3.monospaced())
                        }
                    } else {
                        Button {
                            Task { await viewModel.signIn() }
                        } label: {
                            if viewModel.isSigningIn {
                                ProgressView()
                            } else {
                                Text("Sign In")
                            }
                        }
                        .disabled(viewModel.isSigningIn)
                    }
                }

                Section {
                    Toggle(
                        "Admin Mode",
                        isOn: Binding(
                            get: { environment.isAdminMode },
                            set: { environment.isAdminMode = $0 }
                        )
                    )
                    LabeledContent("Your Request ID", value: environment.localUserID.uuidString)
                        .font(.caption)
                } header: {
                    Text("Requests")
                } footer: {
                    Text(
                        "The real API has no user/role model yet, so \"Admin Mode\" is a local, " +
                        "on-this-device-only placeholder: it only changes what the Requests tab shows " +
                        "and lets you do (Approve/Reject) here, it isn't checked or enforced by the server."
                    )
                }

                if let errorMessage = viewModel.errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}

#Preview {
    let environment = AppEnvironment()
    SettingsView(viewModel: SettingsViewModel(environment: environment))
        .environment(environment)
}
