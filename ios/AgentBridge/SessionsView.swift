import Foundation
import SwiftUI

struct SessionsView: View {
    @EnvironmentObject private var api: APIClient
    @State private var sessions: [SessionItem] = []
    @State private var jobs: [JobSummary] = []
    @State private var search = ""
    @State private var selectedAgent = "all"
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            if isLoading && sessions.isEmpty {
                HStack { Spacer(); ProgressView(); Spacer() }
            } else if filtered.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "bubble.left.and.bubble.right").font(.largeTitle)
                    Text(search.isEmpty ? "No sessions" : "No results")
                        .font(.headline)
                    Text("Start a new prompt from the New tab.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 50)
            } else {
                ForEach(grouped.indices, id: \.self) { index in
                    Section(grouped[index].0) {
                        ForEach(grouped[index].1) { item in
                            NavigationLink {
                                SessionDetailView(session: item)
                            } label: {
                                sessionRow(item)
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(AuroraBackground())
        .navigationTitle("Sessions")
        .searchable(text: $search, prompt: "Search sessions")
        .safeAreaInset(edge: .top, spacing: 0) {
            Picker("Agent", selection: $selectedAgent) {
                Text("All").tag("all")
                ForEach(api.me?.agents.filter(\.resumable) ?? []) { Text($0.name).tag($0.id) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.bottom, 8)
            .background(.bar)
        }
        .refreshable { await load() }
        .overlay(alignment: .bottom) {
            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.white)
                    .padding(10)
                    .background(.red, in: Capsule())
                    .padding()
            }
        }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: 10_000_000_000)
            }
        }
    }

    private var filtered: [SessionItem] {
        sessions.filter { item in
            let agentMatches = selectedAgent == "all" || item.agent == selectedAgent
            let query = search.lowercased()
            let searchMatches = query.isEmpty || "\(item.title ?? "") \(item.cwd ?? "")".lowercased().contains(query)
            return agentMatches && searchMatches
        }
    }

    private var grouped: [(String, [SessionItem])] {
        let order = ["Today", "Yesterday", "Last 7 days", "Last 30 days", "Older"]
        let dictionary = Dictionary(grouping: filtered, by: dayBucket)
        return order.compactMap { key in dictionary[key].map { (key, $0) } }
    }

    private func dayBucket(_ item: SessionItem) -> String {
        let date = Date(timeIntervalSince1970: item.updated / 1000)
        let days = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: date), to: Calendar.current.startOfDay(for: Date())).day ?? 0
        if days <= 0 { return "Today" }
        if days == 1 { return "Yesterday" }
        if days < 7 { return "Last 7 days" }
        if days < 30 { return "Last 30 days" }
        return "Older"
    }

    private func sessionRow(_ item: SessionItem) -> some View {
        HStack(alignment: .top, spacing: 12) {
            AgentBadge(item.agent)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(item.title?.isEmpty == false ? item.title! : "Untitled")
                        .font(.headline)
                        .lineLimit(1)
                    Spacer()
                    Text(relativeTime(item.updated)).font(.caption).foregroundStyle(.secondary)
                }
                HStack(spacing: 6) {
                    if jobs.contains(where: { $0.status == "running" && ($0.sessionId == item.id || $0.resumeOf == item.id) }) {
                        Label("running", systemImage: "circle.dotted").foregroundStyle(.orange)
                    }
                    if item.busy { Label("VS Code", systemImage: "desktopcomputer") }
                    Label(item.cwd?.lastPathComponent ?? "—", systemImage: "folder")
                        .lineLimit(1)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 3)
        .listRowBackground(Color.white.opacity(0.055))
    }

    private func load() async {
        do {
            async let loadedSessions = api.sessions()
            async let loadedJobs = api.jobs()
            sessions = try await loadedSessions
            jobs = try await loadedJobs
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
        isLoading = false
    }
}

struct SessionDetailView: View {
    @EnvironmentObject private var api: APIClient
    let session: SessionItem
    @State private var detail: SessionDetailResponse?
    @State private var jobs: [JobSummary] = []
    @State private var errorMessage: String?
    @State private var showTools = true
    @State private var focusJob: JobSummary?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if let detail {
                        VStack(alignment: .leading, spacing: 5) {
                            Label((detail.session.cwd ?? "—").abbreviatedPath, systemImage: "folder")
                                .font(.caption).foregroundStyle(.secondary)
                            if detail.truncated {
                                Text("Only the most recent messages are shown.")
                                    .font(.caption).foregroundStyle(.orange)
                            }
                        }

                        ForEach(visibleMessages) { message in
                            MessageView(message: message, agentName: agent?.name ?? session.agent)
                                .id(message.id)
                        }

                        if isRunning {
                            HStack(spacing: 9) {
                                ProgressView()
                                Text("\(agent?.name ?? session.agent) is working…")
                                    .foregroundStyle(.secondary)
                            }
                            .id("working")
                        }
                    } else {
                        HStack { Spacer(); ProgressView(); Spacer() }.padding(.top, 60)
                    }
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: detail?.messages.count ?? 0) { _ in
                if let id = visibleMessages.last?.id {
                    withAnimation { proxy.scrollTo(id, anchor: .bottom) }
                }
            }
            .onAppear {
                if let id = visibleMessages.last?.id {
                    DispatchQueue.main.async { proxy.scrollTo(id, anchor: .bottom) }
                }
            }
        }
        .navigationTitle(detail?.session.title ?? session.title ?? "Session")
        .background(AuroraBackground())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Toggle(isOn: $showTools) { Image(systemName: "wrench.and.screwdriver") }
                    .toggleStyle(.button)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if session.canSend, let agent {
                PromptComposerView(agent: agent, session: detail?.session ?? session) { submission in
                    focusJob = try await api.startJob(JobRequest(
                        agent: session.agent,
                        sessionId: session.id,
                        cwd: nil,
                        mode: submission.mode,
                        model: submission.model,
                        effort: submission.effort,
                        prompt: submission.prompt,
                        fork: false,
                        images: submission.images
                    ))
                    await load()
                }
                .padding(.horizontal)
                .padding(.vertical, 10)
                .background(.ultraThinMaterial)
            }
        }
        .overlay(alignment: .bottom) {
            if let errorMessage {
                Text(errorMessage).font(.footnote).foregroundStyle(.red).padding()
            }
        }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: isRunning ? 1_500_000_000 : 5_000_000_000)
            }
        }
        .fullScreenCover(item: $focusJob) { job in
            FocusFeedView(job: job)
                .environmentObject(api)
        }
    }

    private var agent: AgentInfo? { api.me?.agents.first { $0.id == session.agent } }
    private var isRunning: Bool {
        jobs.contains { $0.status == "running" && ($0.sessionId == session.id || ($0.resumeOf == session.id && !$0.fork)) }
    }
    private var visibleMessages: [BridgeMessage] {
        (detail?.messages ?? []).filter { showTools || !["tool", "tool_result", "thinking"].contains($0.role) }
    }

    private func load() async {
        do {
            async let newDetail = api.session(agent: session.agent, id: session.id)
            async let newJobs = api.jobs()
            detail = try await newDetail
            jobs = try await newJobs
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }
}
