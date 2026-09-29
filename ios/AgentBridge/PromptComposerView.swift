import Foundation
import PhotosUI
import SwiftUI
import UIKit

struct PromptSubmission {
    let prompt: String
    let model: String?
    let effort: String?
    let mode: String?
    let fork: Bool
    let images: [JobImage]?
}

struct PromptComposerView: View {
    @EnvironmentObject private var api: APIClient
    let agent: AgentInfo
    let session: SessionItem?
    let onSend: (PromptSubmission) async throws -> Void

    @State private var prompt = ""
    @State private var model = ""
    @State private var effort = ""
    @State private var mode = ""
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var images: [JobImage] = []
    @State private var thumbnails: [UIImage] = []
    @State private var isSending = false
    @State private var isTranscribing = false
    @State private var errorMessage: String?
    @State private var showOptions = false
    @StateObject private var recorder = VoiceRecorder()
    @FocusState private var promptFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            DisclosureGroup(isExpanded: $showOptions) {
                options.padding(.top, 8)
            } label: {
                HStack {
                    Label(showOptions ? "Hide options" : "Options", systemImage: "slider.horizontal.3")
                    Spacer()
                    if agent.resumable {
                        Label("Same chat", systemImage: "link")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AppTheme.mint)
                    }
                }
                .font(.subheadline.weight(.semibold))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, session == nil ? 11 : 8)
            .background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 16, style: .continuous))

            if !thumbnails.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(Array(thumbnails.enumerated()), id: \.offset) { index, image in
                            ZStack(alignment: .topTrailing) {
                                Image(uiImage: image)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 64, height: 64)
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                                Button {
                                    thumbnails.remove(at: index)
                                    images.remove(at: index)
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .symbolRenderingMode(.palette)
                                        .foregroundStyle(.white, .black.opacity(0.65))
                                }
                                .offset(x: 5, y: -5)
                            }
                        }
                    }
                    .padding(.top, 5)
                }
            }

            TextEditor(text: $prompt)
                .focused($promptFocused)
                .frame(minHeight: session == nil ? 96 : 44, maxHeight: session == nil ? 180 : 112)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 7)
                .padding(.vertical, session == nil ? 7 : 2)
                .background(Color.white.opacity(0.085), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 22).stroke(promptFocused ? AppTheme.cyan.opacity(0.55) : .white.opacity(0.10), lineWidth: 1) }
                .overlay(alignment: .topLeading) {
                    if prompt.isEmpty {
                        Text(session == nil ? "What should the agent do?" : "Write a message…")
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, 11)
                            .padding(.vertical, session == nil ? 13 : 8)
                            .allowsHitTesting(false)
                    }
                }

            HStack {
                if prompt.count > maxPromptCharacters {
                    Label("Prompt too long", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }
                Spacer()
                Text("\(prompt.count)/\(maxPromptCharacters)")
                    .foregroundStyle(prompt.count > maxPromptCharacters ? Color.red : Color.secondary)
            }
            .font(.caption.monospacedDigit())

            if let errorMessage {
                Text(errorMessage).font(.footnote).foregroundStyle(.red)
            }

            HStack {
                if agent.images {
                    PhotosPicker(selection: $photoItems, maxSelectionCount: max(1, 4 - images.count), matching: .images) {
                        Image(systemName: "photo.on.rectangle")
                    }
                    .disabled(images.count >= 4)
                }

                if api.me?.voice == true {
                    Button {
                        Task { await toggleRecording() }
                    } label: {
                        if isTranscribing {
                            ProgressView().tint(AppTheme.cyan)
                        } else {
                            Image(systemName: recorder.isRecording ? "stop.fill" : "mic.fill")
                                .foregroundStyle(recorder.isRecording ? .white : AppTheme.cyan)
                        }
                    }
                    .frame(width: 42, height: 42)
                    .background(recorder.isRecording ? Color.red : AppTheme.cyan.opacity(0.13), in: Circle())
                    .overlay { Circle().stroke(recorder.isRecording ? Color.red.opacity(0.8) : AppTheme.cyan.opacity(0.34), lineWidth: 1) }
                    .accessibilityLabel(recorder.isRecording ? "Stop and transcribe" : "Record voice prompt")
                    .disabled(isTranscribing)
                }

                if recorder.isRecording {
                    HStack(spacing: 6) {
                        Circle().fill(.red).frame(width: 7, height: 7)
                            .scaleEffect(1 + recorder.level * 0.9)
                            .animation(.easeOut(duration: 0.1), value: recorder.level)
                        Text(durationLabel(recorder.duration))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.red)
                    }
                }

                if promptFocused {
                    Button { dismissKeyboard() } label: {
                        Image(systemName: "keyboard.chevron.compact.down")
                    }
                    .frame(width: 42, height: 42)
                    .background(Color.white.opacity(0.07), in: Circle())
                    .accessibilityLabel("Hide keyboard")
                }

                Spacer()

                Button {
                    Task { await send() }
                } label: {
                    if isSending { ProgressView().tint(.white) }
                    else { Image(systemName: "arrow.up") }
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.violet)
                .clipShape(Circle())
                .disabled(isSending || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || prompt.count > maxPromptCharacters)
            }
        }
        .animation(.easeInOut(duration: 0.18), value: promptFocused)
        .onAppear {
            configureOptions()
        }
        .onChange(of: agent.id) { _ in configureOptions() }
        .onChange(of: model) { _ in
            if !availableEfforts.contains(effort) { effort = "" }
        }
        .onChange(of: photoItems) { items in
            Task { await loadPhotos(items) }
        }
        .onDisappear {
            if recorder.isRecording { Task { await recorder.cancel() } }
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { dismissKeyboard() }
            }
        }
    }

    @ViewBuilder
    private var options: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                if !agent.models.isEmpty {
                    Picker("Model", selection: $model) {
                        ForEach(agent.models) { Text($0.label).tag($0.id) }
                    }
                    .pickerStyle(.menu)
                }
                if !availableEfforts.isEmpty {
                    Picker("Reasoning", selection: $effort) {
                        Text("Default").tag("")
                        ForEach(availableEfforts, id: \.self) { Text($0).tag($0) }
                    }
                    .pickerStyle(.menu)
                }
                if !agent.modes.isEmpty {
                    Picker("Permissions", selection: $mode) {
                        ForEach(agent.modes, id: \.self) { Text(modeLabel($0)).tag($0) }
                    }
                    .pickerStyle(.menu)
                }
            }
        }
    }

    private var availableEfforts: [String] {
        agent.models.first(where: { $0.id == model })?.efforts ?? []
    }

    private var maxPromptCharacters: Int { api.me?.maxPromptChars ?? 20_000 }

    private func configureOptions() {
        model = agent.models.first?.id ?? ""
        effort = ""
        mode = agent.defaultMode ?? agent.modes.first ?? ""
    }

    private func modeLabel(_ value: String) -> String {
        ["plan": "Plan", "manual": "Manual", "acceptEdits": "Edit files", "auto": "Automatic", "read-only": "Read-only", "workspace-write": "Workspace write", "danger-full-access": "Full access"][value] ?? value
    }

    private func loadPhotos(_ items: [PhotosPickerItem]) async {
        for item in items.prefix(max(0, 4 - images.count)) {
            guard let data = try? await item.loadTransferable(type: Data.self),
                  let image = UIImage(data: data),
                  let jpeg = image.downscaledJPEG(maxDimension: 1600) else { continue }
            thumbnails.append(UIImage(data: jpeg) ?? image)
            images.append(JobImage(mediaType: "image/jpeg", data: jpeg.base64EncodedString()))
        }
        photoItems = []
    }

    private func toggleRecording() async {
        errorMessage = nil
        if recorder.isRecording {
            guard let url = await recorder.stop() else {
                errorMessage = "Recording too short: hold a little longer."
                return
            }
            isTranscribing = true
            defer {
                isTranscribing = false
                try? FileManager.default.removeItem(at: url)
            }
            do {
                let audio = try Data(contentsOf: url)
                let text = try await api.transcribe(data: audio, mimeType: "audio/mp4")
                let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !clean.isEmpty else {
                    errorMessage = "I couldn't catch anything. Speak closer to the microphone."
                    return
                }
                if !prompt.isEmpty, !prompt.hasSuffix(" ") { prompt += " " }
                prompt += clean
            } catch { errorMessage = error.localizedDescription }
        } else {
            do { try await recorder.start() }
            catch { errorMessage = error.localizedDescription }
        }
    }

    private func durationLabel(_ seconds: TimeInterval) -> String {
        let total = Int(seconds)
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    private func dismissKeyboard() {
        promptFocused = false
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    private func send() async {
        isSending = true
        errorMessage = nil
        do {
            try await onSend(PromptSubmission(
                prompt: prompt.trimmingCharacters(in: .whitespacesAndNewlines),
                model: model.isEmpty ? nil : model,
                effort: effort.isEmpty ? nil : effort,
                mode: mode.isEmpty ? nil : mode,
                fork: false,
                images: images.isEmpty ? nil : images
            ))
            prompt = ""
            images = []
            thumbnails = []
            dismissKeyboard()
        } catch { errorMessage = error.localizedDescription }
        isSending = false
    }
}

private extension UIImage {
    func downscaledJPEG(maxDimension: CGFloat) -> Data? {
        let scale = min(1, maxDimension / max(size.width, size.height))
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: target)
        let result = renderer.image { _ in draw(in: CGRect(origin: .zero, size: target)) }
        return result.jpegData(compressionQuality: 0.85)
    }
}
