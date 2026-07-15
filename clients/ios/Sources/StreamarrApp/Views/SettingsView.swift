import StreamarrKit
import SwiftUI

struct SettingsView: View {
    @Bindable var viewModel: SettingsViewModel

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
