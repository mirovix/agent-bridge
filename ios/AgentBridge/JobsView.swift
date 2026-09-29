import SwiftUI

struct JobsView: View {
    @EnvironmentObject private var api: APIClient
    @State private var jobs: [JobSummary] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            if isLoading && jobs.isEmpty {
                HStack { Spacer(); ProgressView(); Spacer() }
            } else if jobs.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "waveform.path.ecg").font(.largeTitle)
                    Text("No activity").font(.headline)
                    Text("Prompts sent from the app will appear here.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 50)
            } else {
                if !running.isEmpty {
                    Section("Running") { ForEach(running) { row($0) } }
                }
                if !completed.isEmpty {
                    Section("Completed") { ForEach(completed) { row($0) } }
                }
            }
        }
        .navigationTitle("Activity")
        .scrollContentBackground(.hidden)
        .background(AuroraBackground())
        .refreshable { await load() }
        .overlay(alignment: .bottom) {
            if let errorMessage { Text(errorMessage).font(.footnote).foregroundStyle(.red).padding() }
        }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: running.isEmpty ? 5_000_000_000 : 1_500_000_000)
            }
        }
    }

    private var running: [JobSummary] { jobs.filter { $0.status == "running" } }
    private var completed: [JobSummary] { jobs.filter { $0.status != "running" } }

    private func row(_ job: JobSummary) -> some View {
        NavigationLink {
            JobDetailView(id: job.id)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                AgentBadge(job.agent)
                VStack(alignment: .leading, spacing: 5) {
                    Text(job.promptPreview).font(.headline).lineLimit(2)
                    HStack {
                        StatusPill(status: job.status)
                        if job.fork { Label("fork", systemImage: "arrow.triangle.branch") }
                        Spacer()
                        Text(relativeTime(job.started))
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    Label(job.cwd.lastPathComponent, systemImage: "folder")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .padding(.vertical, 3)
        }
    }

    private func load() async {
        do {
            jobs = try await api.jobs()
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
        isLoading = false
    }
}

struct JobDetailView: View {
    @EnvironmentObject private var api: APIClient
    let id: String
    @State private var detail: JobDetailResponse?
    @State private var showTools = true
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                if let detail {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            StatusPill(status: detail.job.status)
                            if detail.job.fork { Label("fork", systemImage: "arrow.triangle.branch").font(.caption) }
                        }
                        Label(detail.job.cwd.abbreviatedPath, systemImage: "folder")
                            .font(.caption.monospaced()).foregroundStyle(.secondary)
                        Text(detail.job.promptPreview)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                            .foregroundStyle(.white)
                            .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 16))
                        if detail.job.status == "running" {
                            Button(role: .destructive) {
                                Task {
                                    do { try await api.cancelJob(id: id); await load() }
                                    catch { errorMessage = error.localizedDescription }
                                }
                            } label: { Label("Stop", systemImage: "stop.fill") }
                            .buttonStyle(.bordered)
                        }
                    }

                    ForEach(visibleEvents) { event in
                        MessageView(message: event, agentName: agentName)
                    }
                    if detail.job.status == "running" {
                        HStack { ProgressView(); Text("The agent is working…").foregroundStyle(.secondary) }
                    }
                } else {
                    HStack { Spacer(); ProgressView(); Spacer() }.padding(.top, 60)
                }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .padding()
        }
        .navigationTitle("Activity")
        .navigationBarTitleDisplayMode(.inline)
        .background(AuroraBackground())
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Toggle(isOn: $showTools) { Image(systemName: "wrench.and.screwdriver") }
                    .toggleStyle(.button)
            }
        }
        .task {
            repeat {
                await load()
                if detail?.job.status == "running" { try? await Task.sleep(nanoseconds: 1_000_000_000) }
            } while !Task.isCancelled && detail?.job.status == "running"
        }
    }

    private var agentName: String {
        guard let id = detail?.job.agent else { return "Agent" }
        return api.me?.agents.first(where: { $0.id == id })?.name ?? id
    }
    private var visibleEvents: [BridgeMessage] {
        (detail?.events ?? []).filter { showTools || !["tool", "tool_result", "thinking"].contains($0.role) }
    }
    private func load() async {
        do { detail = try await api.job(id: id); errorMessage = nil }
        catch { errorMessage = error.localizedDescription }
    }
}
