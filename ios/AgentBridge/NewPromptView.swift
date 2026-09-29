import Foundation
import SwiftUI

struct NewPromptView: View {
    @EnvironmentObject private var api: APIClient
    @State private var selectedAgentID = ""
    @State private var cwd = ""
    @State private var showFolders = false
    @State private var focusJob: JobSummary?

    var body: some View {
        ZStack {
            AuroraBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 13) {
                        BrandMark(size: 54)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("NEW MISSION").font(.caption2.bold()).tracking(1.8).foregroundStyle(AppTheme.cyan)
                            Text("What are we building?").font(.title2.bold())
                        }
                    }

                Text("Agent").font(.caption.bold()).foregroundStyle(.secondary)
                agentPicker

                Text("Folder").font(.caption.bold()).foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 12) {
                    Label(cwd.isEmpty ? "Choose a folder" : cwd.abbreviatedPath, systemImage: "folder")
                        .font(.callout.monospaced())
                        .frame(maxWidth: .infinity, alignment: .leading)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(recentFolders, id: \.self) { path in
                                    Button(path.lastPathComponent) { cwd = path }
                                    .buttonStyle(.bordered)
                                    .tint(path == cwd ? Color.accentColor : Color.gray)
                            }
                        }
                    }
                    Button("Browse folders…") { showFolders = true }
                }
                .padding()
                .glassPanel(cornerRadius: 20)

                Text("Prompt").font(.caption.bold()).foregroundStyle(.secondary)
                Label("Messages will continue the same chat for this agent and folder.", systemImage: "link.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.mint)
                if let agent {
                    PromptComposerView(agent: agent, session: nil) { submission in
                        focusJob = try await api.startJob(JobRequest(
                            agent: agent.id,
                            sessionId: nil,
                            cwd: cwd,
                            mode: submission.mode,
                            model: submission.model,
                            effort: submission.effort,
                            prompt: submission.prompt,
                            fork: false,
                            images: submission.images
                        ))
                    }
                }
                }
                .padding()
            }
        }
        .navigationTitle("New prompt")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .onAppear {
            if selectedAgentID.isEmpty { selectedAgentID = api.me?.agents.first?.id ?? "" }
            if cwd.isEmpty { cwd = recentFolders.first ?? "" }
        }
        .sheet(isPresented: $showFolders) {
            FolderPickerView(initialPath: cwd) { selected in cwd = selected }
                .environmentObject(api)
        }
        .fullScreenCover(item: $focusJob) { job in
            FocusFeedView(job: job)
                .environmentObject(api)
        }
    }

    private var agent: AgentInfo? { api.me?.agents.first { $0.id == selectedAgentID } }
    private var recentFolders: [String] {
        guard let workspaces = api.me?.workspaces else { return [] }
        return Array(NSOrderedSet(array: workspaces.recent + workspaces.roots).array.compactMap { $0 as? String }.prefix(8))
    }

    private var agentPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                ForEach(api.me?.agents ?? []) { item in
                    Button {
                        selectedAgentID = item.id
                    } label: {
                        HStack {
                            AgentBadge(item.id, size: 27)
                            Text(item.name).fontWeight(.semibold)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(selectedAgentID == item.id ? AppTheme.cyan.opacity(0.22) : Color.white.opacity(0.08), in: Capsule())
                        .overlay { Capsule().stroke(selectedAgentID == item.id ? AppTheme.cyan.opacity(0.7) : .white.opacity(0.10), lineWidth: 1) }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private struct FolderPickerView: View {
    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss
    let initialPath: String
    let onSelect: (String) -> Void
    @State private var directory: DirectoryResponse?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if let parent = directory?.parent {
                    Button { Task { await load(parent) } } label: {
                        Label("Parent folder", systemImage: "arrow.up")
                    }
                }
                ForEach(directory?.dirs ?? [], id: \.self) { name in
                    Button { Task { await load(childPath(name)) } } label: {
                        Label(name, systemImage: "folder")
                    }
                }
                if isLoading { HStack { Spacer(); ProgressView(); Spacer() } }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle(directory?.path.lastPathComponent ?? "Folder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Use") {
                        if let path = directory?.path { onSelect(path) }
                        dismiss()
                    }
                    .disabled(directory == nil)
                }
            }
            .task { await load(initialPath) }
        }
    }

    private func load(_ path: String) async {
        isLoading = true
        do {
            directory = try await api.directory(path: path)
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    private func childPath(_ name: String) -> String {
        guard let base = directory?.path else { return name }
        return (base as NSString).appendingPathComponent(name)
    }
}
