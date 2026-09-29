import Foundation
import SwiftUI

struct ConnectionSettingsView: View {
    @EnvironmentObject private var configuration: AppConfiguration
    @Environment(\.dismiss) private var dismiss
    @State private var address: String
    @State private var isChecking = false
    @State private var errorMessage: String?

    init(currentURL: String) {
        _address = State(initialValue: currentURL)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 14) {
                        Image("BridgeLogo")
                            .resizable()
                            .frame(width: 58, height: 58)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Agent Bridge").font(.title2.bold())
                            Text("Connect the app to the server on your PC")
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 6)
                }

                Section {
                    TextField("https://my-pc.tail1234.ts.net", text: $address)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .textContentType(.URL)
                    if let errorMessage {
                        Text(errorMessage).foregroundStyle(.red).font(.footnote)
                    }
                } header: {
                    Text("Server address")
                } footer: {
                    Text("Use the HTTPS address shown by “tailscale serve status”. Tailscale must also be connected on the iPhone.")
                }

                Section {
                    Button {
                        Task { await verifyAndSave() }
                    } label: {
                        HStack {
                            Spacer()
                            if isChecking { ProgressView().padding(.trailing, 6) }
                            Text(isChecking ? "Verifying…" : "Verify and connect").fontWeight(.semibold)
                            Spacer()
                        }
                    }
                    .disabled(isChecking || address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    if configuration.serverURL != nil {
                        Button("Save without verifying", action: saveAddress)
                            .frame(maxWidth: .infinity, alignment: .center)
                    }
                }
            }
            .navigationTitle(configuration.serverURL == nil ? "Set up" : "Connection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if configuration.serverURL != nil {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                }
            }
        }
    }

    private func saveAddress() {
        do {
            try configuration.save(address)
            errorMessage = nil
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func verifyAndSave() async {
        guard let baseURL = AppConfiguration.normalizedURL(from: address) else {
            errorMessage = ConfigurationError.invalidURL.localizedDescription
            return
        }
        isChecking = true
        errorMessage = nil
        defer { isChecking = false }
        do {
            var request = URLRequest(url: baseURL.appending(path: "api/status"))
            request.timeoutInterval = 12
            request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  (try? JSONSerialization.jsonObject(with: data)) != nil else {
                throw ConfigurationError.unexpectedResponse
            }
            try configuration.save(baseURL.absoluteString)
            dismiss()
        } catch {
            errorMessage = "Connection failed: \(error.localizedDescription)"
        }
    }
}
