import StreamarrKit
import SwiftUI

struct SettingsView: View {
    @Bindable var viewModel: SettingsViewModel

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("Server URL", text: $viewModel.serverBaseURLText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)

                    Button("Save") {
                        viewModel.applyServerURL()
                    }
                }

                Section("Account") {
                    if let user = viewModel.currentUser {
                        LabeledContent("Signed in as", value: user.displayName)
                        Button("Sign Out", role: .destructive) {
                            Task { await viewModel.signOut() }
                        }
                    } else if let deviceAuth = viewModel.deviceAuthorization {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Go to \(deviceAuth.verificationURI.absoluteString)")
                            Text("and enter code: \(deviceAuth.userCode)")
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
    SettingsView(viewModel: SettingsViewModel(environment: AppEnvironment()))
}
