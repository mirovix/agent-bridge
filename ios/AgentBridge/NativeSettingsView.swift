import Foundation
import SwiftUI

struct NativeSettingsView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var configuration: AppConfiguration
    @State private var devices: [DeviceInfo] = []
    @State private var audit: [AuditEvent] = []
    @State private var server: ServerInfo?
    @State private var showConnection = false
    @State private var showLogoutAll = false
    @State private var errorMessage: String?
    @AppStorage("waitingActivity") private var waitingActivity = WaitingActivity.reels.rawValue

    var body: some View {
        List {
            Section("Connessione") {
                LabeledContent("Server", value: configuration.serverURL?.host ?? "—")
                Button { showConnection = true } label: {
                    Label("Cambia indirizzo", systemImage: "network")
                }
            }

            Section("Durante l’attesa") {
                Picker("Apri dopo l’invio", selection: $waitingActivity) {
                    Label("Instagram Reels", systemImage: "play.rectangle.fill").tag(WaitingActivity.reels.rawValue)
                    Label("HappyDEV", systemImage: "gamecontroller.fill").tag(WaitingActivity.happyDev.rawValue)
                }
                Text("Puoi cambiare attività anche mentre l’agente sta lavorando.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Dispositivi collegati") {
                if devices.isEmpty { ProgressView() }
                ForEach(devices) { device in
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(deviceName(device.ua)).fontWeight(.semibold)
                                if device.current { Text("questo").font(.caption.bold()).foregroundStyle(.green) }
                            }
                            Text("attivo \(relativeTime(device.lastSeen)) · \(device.from ?? "?")")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button(role: .destructive) {
                            Task {
                                do { _ = try await api.revokeDevice(id: device.id); await load() }
                                catch { errorMessage = error.localizedDescription }
                            }
                        } label: { Image(systemName: "person.crop.circle.badge.xmark") }
                    }
                }
            }

            Section("Server") {
                if let server {
                    LabeledContent("PC", value: server.host)
                    LabeledContent("Claude Code", value: server.versions.claude ?? "—")
                    LabeledContent("Codex", value: server.versions.codex ?? "—")
                    LabeledContent("Voce locale", value: server.voice ? "Whisper attivo" : "Non installata")
                    LabeledContent("Job", value: "max \(server.maxConcurrentJobs) · \(server.jobTimeoutMinutes) min")
                    LabeledContent("Modalità pericolose", value: server.allowDangerousModes ? "Attive" : "Disattivate")
                } else { ProgressView() }
            }

            Section("Registro di sicurezza") {
                ForEach(audit.prefix(30)) { event in
                    HStack(alignment: .top) {
                        Image(systemName: auditIcon(event.event))
                            .foregroundStyle(auditColor(event.event))
                            .frame(width: 22)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(auditLabel(event.event))
                            Text(auditDetail(event))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Section {
                Button("Esci da questo dispositivo", role: .destructive) {
                    Task { await api.logout() }
                }
                Button("Disconnetti tutti e ferma i job", role: .destructive) {
                    showLogoutAll = true
                }
            }

            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red) }
            }
        }
        .navigationTitle("Impostazioni")
        .scrollContentBackground(.hidden)
        .background(AuroraBackground())
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $showConnection) {
            ConnectionSettingsView(currentURL: configuration.serverURL?.absoluteString ?? "")
                .environmentObject(configuration)
        }
        .confirmationDialog(
            "Disconnettere tutti i dispositivi e fermare i job in corso?",
            isPresented: $showLogoutAll,
            titleVisibility: .visible
        ) {
            Button("Disconnetti tutti", role: .destructive) { Task { await api.logout(all: true) } }
        }
    }

    private func load() async {
        do {
            async let newDevices = api.devices()
            async let newAudit = api.audit()
            async let newServer = api.serverInfo()
            devices = try await newDevices
            audit = try await newAudit
            server = try await newServer
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }

    private func deviceName(_ ua: String?) -> String {
        let value = ua ?? ""
        if value.contains("iPhone") { return "iPhone" }
        if value.contains("iPad") { return "iPad" }
        if value.contains("Android") { return "Android" }
        if value.contains("Mac OS X") { return "Mac" }
        if value.contains("Windows") { return "Windows" }
        if value.contains("Linux") { return "Linux" }
        return "Dispositivo"
    }

    private func auditLabel(_ event: String?) -> String {
        [
            "login_ok": "Accesso riuscito", "login_failed": "Accesso fallito",
            "login_blocked": "Accesso bloccato", "logout": "Uscita",
            "logout_all": "Disconnessi tutti", "device_revoked": "Dispositivo disconnesso",
            "job_start": "Prompt inviato", "job_end": "Job terminato",
            "job_cancel": "Job fermato", "server_start": "Server avviato",
        ][event ?? ""] ?? event ?? "Evento"
    }

    private func auditIcon(_ event: String?) -> String {
        if event == "login_failed" || event == "login_blocked" { return "exclamationmark.shield.fill" }
        if event?.hasPrefix("job_") == true { return "terminal.fill" }
        if event == "login_ok" { return "checkmark.shield.fill" }
        return "info.circle"
    }

    private func auditColor(_ event: String?) -> Color {
        event == "login_failed" || event == "login_blocked" ? .red : .secondary
    }

    private func auditDetail(_ event: AuditEvent) -> String {
        let date: String
        if let timestamp = event.ts, let parsed = ISO8601DateFormatter().date(from: timestamp) {
            date = parsed.formatted(date: .abbreviated, time: .shortened)
        } else { date = "" }
        return [date, event.agent, event.model, event.status, event.reason, event.forwardedFor]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}
