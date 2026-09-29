import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var configuration: AppConfiguration
    @State private var password = ""
    @State private var code = ""
    @State private var recoveryMode = false
    @State private var isBusy = false
    @State private var errorMessage: String?
    @State private var showConnection = false

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView {
                    VStack(spacing: 18) {
                    BrandMark(size: 88)
                        .padding(.top, 54)
                    Text("Agent Bridge")
                        .font(.system(.largeTitle, design: .rounded, weight: .bold))
                    Text("Claude Code, Codex e i tuoi agenti dal telefono.")
                        .foregroundStyle(.white.opacity(0.68))
                        .multilineTextAlignment(.center)

                    VStack(spacing: 14) {
                        SecureField("Password", text: $password)
                            .textContentType(.password)
                            .submitLabel(.next)
                            .padding(13)
                            .background(.white.opacity(0.09), in: RoundedRectangle(cornerRadius: 13))
                        TextField(recoveryMode ? "Codice di recupero" : "Codice a 6 cifre", text: $code)
                            .textContentType(.oneTimeCode)
                            .keyboardType(recoveryMode ? .asciiCapable : .numberPad)
                            .padding(13)
                            .background(.white.opacity(0.09), in: RoundedRectangle(cornerRadius: 13))
                            .multilineTextAlignment(.center)
                            .font(recoveryMode ? .body.monospaced() : .title2.monospacedDigit())
                            .submitLabel(.go)
                            .onSubmit {
                                if !isBusy && !password.isEmpty && !code.isEmpty { Task { await signIn() } }
                            }

                        if let errorMessage {
                            Text(errorMessage)
                                .font(.footnote)
                                .foregroundStyle(.red)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        } else if let connectionError = api.connectionError {
                            Text(connectionError)
                                .font(.footnote)
                                .foregroundStyle(.red)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        Button {
                            Task { await signIn() }
                        } label: {
                            HStack {
                                if isBusy { ProgressView().tint(.white) }
                                Text(isBusy ? "Verifica…" : "Accedi").fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(AppTheme.violet)
                        .disabled(isBusy || password.isEmpty || code.isEmpty)

                        Button(recoveryMode ? "Usa il codice 2FA" : "Usa un codice di recupero") {
                            recoveryMode.toggle()
                            code = ""
                            errorMessage = nil
                        }
                        .font(.footnote)
                    }
                    .padding(20)
                    .glassPanel(cornerRadius: 24)

                    Label("Password + 2FA · connessione cifrata", systemImage: "lock.shield")
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.62))
                    }
                    .padding(.horizontal, 22)
                    .frame(maxWidth: 430)
                    .frame(maxWidth: .infinity)
                }
            }
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { showConnection = true } label: {
                        Image(systemName: "network")
                    }
                }
            }
            .sheet(isPresented: $showConnection) {
                ConnectionSettingsView(currentURL: configuration.serverURL?.absoluteString ?? "")
                    .environmentObject(configuration)
            }
            .toolbarBackground(.hidden, for: .navigationBar)
        }
        .preferredColorScheme(.dark)
    }

    private func signIn() async {
        isBusy = true
        errorMessage = nil
        do {
            try await api.login(password: password, code: code.trimmingCharacters(in: .whitespacesAndNewlines))
            password = ""
            code = ""
        } catch {
            errorMessage = error.localizedDescription
            code = ""
        }
        isBusy = false
    }
}
