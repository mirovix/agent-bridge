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
            Section("Connection") {
                LabeledContent("Server", value: configuration.serverURL?.host ?? "—")
                Button { showConnection = true } label: {
                    Label("Change address", systemImage: "network")
                }
            }

            Section("While waiting") {
                Picker("Open after sending", selection: $waitingActivity) {
                    Label("Instagram Reels", systemImage: "play.rectangle.fill").tag(WaitingActivity.reels.rawValue)
                    Label("HappyDEV", systemImage: "gamecontroller.fill").tag(WaitingActivity.happyDev.rawValue)
                }
                Text("You can switch activities while the agent is working.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Connected devices") {
                if devices.isEmpty { ProgressView() }
                ForEach(devices) { device in
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(deviceName(device.ua)).fontWeight(.semibold)
                                if device.current { Text("this device").font(.caption.bold()).foregroundStyle(.green) }
                            }
                            Text("active \(relativeTime(device.lastSeen)) · \(device.from ?? "?")")
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
                    LabeledContent("Local voice", value: server.voice ? "Whisper enabled" : "Not installed")
                    LabeledContent("Job", value: "max \(server.maxConcurrentJobs) · \(server.jobTimeoutMinutes) min")
                    LabeledContent("Dangerous modes", value: server.allowDangerousModes ? "Enabled" : "Disabled")
                } else { ProgressView() }
            }

            Section("Security log") {
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
                Button("Sign out of this device", role: .destructive) {
                    Task { await api.logout() }
                }
                Button("Sign out everywhere and stop jobs", role: .destructive) {
                    showLogoutAll = true
                }
            }

            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red) }
            }
        }
        .navigationTitle("Settings")
        .scrollContentBackground(.hidden)
        .background(AuroraBackground())
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $showConnection) {
            ConnectionSettingsView(currentURL: configuration.serverURL?.absoluteString ?? "")
                .environmentObject(configuration)
        }
        .confirmationDialog(
            "Sign out all devices and stop running jobs?",
            isPresented: $showLogoutAll,
            titleVisibility: .visible
        ) {
            Button("Sign out all", role: .destructive) { Task { await api.logout(all: true) } }
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
        return "Device"
    }

    private func auditLabel(_ event: String?) -> String {
        [
            "login_ok": "Signed in", "login_failed": "Sign-in failed",
            "login_blocked": "Sign-in blocked", "logout": "Signed out",
            "logout_all": "All devices signed out", "device_revoked": "Device signed out",
            "job_start": "Prompt sent", "job_end": "Job finished",
            "job_cancel": "Job stopped", "server_start": "Server started",
        ][event ?? ""] ?? event ?? "Event"
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
