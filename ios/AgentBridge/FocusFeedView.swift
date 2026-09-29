import SafariServices
import SwiftUI
import UIKit
import WebKit

/// Waiting room shown after a prompt. It opens Instagram Reels inside the app while
/// keeping the native live status available underneath.
struct FocusFeedView: View {
    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss
    let job: JobSummary

    @State private var detail: JobDetailResponse?
    @State private var index = 0
    @State private var errorMessage: String?
    @State private var activity: WaitingActivity?
    @State private var didOpenActivity = false
    @AppStorage("waitingActivity") private var waitingActivity = WaitingActivity.reels.rawValue
    @GestureState private var dragY: CGFloat = 0

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                AuroraBackground()

                ForEach(Array(cards.enumerated()), id: \.offset) { cardIndex, card in
                    FocusCardView(card: card, job: currentJob)
                        .frame(width: proxy.size.width - 28, height: proxy.size.height - 126)
                        .offset(y: CGFloat(cardIndex - index) * proxy.size.height + dragY)
                        .opacity(abs(cardIndex - index) > 1 ? 0 : 1)
                }

                VStack {
                    header
                    Spacer()
                    footer
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 12)

                HStack {
                    Spacer()
                    VStack(spacing: 7) {
                        ForEach(cards.indices, id: \.self) { dot in
                            Capsule()
                                .fill(dot == index ? .white : .white.opacity(0.28))
                                .frame(width: 4, height: dot == index ? 22 : 7)
                                .animation(.spring(response: 0.3), value: index)
                        }
                    }
                }
                .padding(.trailing, 10)
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 12)
                    .updating($dragY) { value, state, _ in state = value.translation.height }
                    .onEnded { value in
                        let threshold = proxy.size.height * 0.12
                        var next = index
                        if value.translation.height < -threshold { next = min(cards.count - 1, index + 1) }
                        if value.translation.height > threshold { next = max(0, index - 1) }
                        if next != index { UIImpactFeedbackGenerator(style: .soft).impactOccurred() }
                        withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) { index = next }
                    }
            )
        }
        .preferredColorScheme(.dark)
        .sheet(item: $activity) { selection in
            WaitingActivityView(activity: selection, job: currentJob)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .task {
            if !didOpenActivity {
                didOpenActivity = true
                activity = WaitingActivity(rawValue: waitingActivity) ?? .reels
            }
            await pollUntilFinished()
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            BrandMark(size: 42)
            VStack(alignment: .leading, spacing: 1) {
                Text("FOCUS FEED").font(.caption2.bold()).tracking(1.6).foregroundStyle(AppTheme.cyan)
                Text(currentJob.agent == "codex" ? "Codex è al lavoro" : "Claude è al lavoro")
                    .font(.subheadline.weight(.semibold))
            }
            Spacer()
            Menu {
                Button { activity = .reels } label: { Label("Instagram Reels", systemImage: "play.rectangle.fill") }
                Button { activity = .happyDev } label: { Label("HappyDEV", systemImage: "gamecontroller.fill") }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.title3).frame(width: 38, height: 38)
                    .background(.thinMaterial, in: Circle())
            }
            .buttonStyle(.plain)
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.headline)
                    .frame(width: 38, height: 38)
                    .background(.thinMaterial, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Chiudi")
        }
    }

    private var footer: some View {
        VStack(spacing: 8) {
            if let errorMessage {
                Text(errorMessage).font(.caption).foregroundStyle(.red)
            }
            if ["queued", "running"].contains(currentJob.status) {
                VStack(spacing: 10) {
                    HStack(spacing: 8) {
                        ProgressView().tint(AppTheme.cyan)
                        Text(currentJob.status == "queued" ? "In coda: partirà appena possibile" : "In esecuzione nella stessa chat")
                    }
                    HStack(spacing: 10) {
                        Button { activity = .reels } label: {
                            Label("Reels", systemImage: "play.fill").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Color(red: 0.86, green: 0.18, blue: 0.49))
                        Button { activity = .happyDev } label: {
                            Label("HappyDEV", systemImage: "gamecontroller.fill").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(AppTheme.violet)
                    }
                }
                .font(.footnote.weight(.medium))
                .foregroundStyle(.white.opacity(0.72))
            } else {
                Button {
                    dismiss()
                } label: {
                    Label(currentJob.status == "done" ? "Lavoro completato" : "Chiudi e controlla l’attività", systemImage: currentJob.status == "done" ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                }
                .buttonStyle(.borderedProminent)
                .tint(currentJob.status == "done" ? AppTheme.mint : .red)
            }
        }
    }

    private var currentJob: JobSummary { detail?.job ?? job }

    private var cards: [FocusCard] {
        let events = detail?.events ?? []
        let lastAnswer = events.last(where: { $0.role == "assistant" })?.text
        let lastActivity = events.last(where: { ["tool", "tool_result", "thinking", "system", "error"].contains($0.role) })
        return [
            FocusCard(
                eyebrow: "IL TUO PROMPT",
                title: currentJob.promptPreview,
                body: "È stato consegnato in modo cifrato al computer \(api.me?.host ?? "remoto").",
                icon: "paperplane.fill",
                colors: [AppTheme.violet, AppTheme.cyan]
            ),
            FocusCard(
                eyebrow: ["queued", "running"].contains(currentJob.status) ? "LIVE" : "STATO",
                title: statusTitle,
                body: "\(events.count) aggiornamenti ricevuti · \(currentJob.cwd.abbreviatedPath)",
                icon: ["queued", "running"].contains(currentJob.status) ? "waveform.path.ecg" : "checkmark.seal.fill",
                colors: [Color(red: 0.02, green: 0.55, blue: 0.70), AppTheme.mint]
            ),
            FocusCard(
                eyebrow: "DAL TUO AGENTE",
                title: lastAnswer ?? "Sto preparando la risposta…",
                body: lastAnswer == nil ? "Questa scheda si aggiorna appena arriva il primo messaggio." : "Ultimo messaggio ricevuto in tempo reale.",
                icon: "sparkles",
                colors: [Color(red: 0.50, green: 0.16, blue: 0.72), Color(red: 0.96, green: 0.30, blue: 0.55)]
            ),
            FocusCard(
                eyebrow: "DIETRO LE QUINTE",
                title: lastActivity?.name ?? activityTitle(lastActivity),
                body: lastActivity?.text ?? "L’agente sta analizzando il contesto e scegliendo il prossimo passo.",
                icon: "terminal.fill",
                colors: [Color(red: 0.06, green: 0.18, blue: 0.33), AppTheme.violet]
            ),
        ]
    }

    private var statusTitle: String {
        switch currentJob.status {
        case "queued": return "Il prompt è in coda"
        case "done": return "Prompt completato"
        case "failed": return "Serve la tua attenzione"
        case "cancelled": return "Attività fermata"
        default: return "\(currentJob.agent == "codex" ? "Codex" : "Claude") sta costruendo la risposta"
        }
    }

    private func activityTitle(_ event: BridgeMessage?) -> String {
        switch event?.role {
        case "thinking": return "Ragionamento in corso"
        case "tool": return "Strumento in uso"
        case "tool_result": return "Risultato ricevuto"
        case "error": return "Dettaglio errore"
        default: return "Elaborazione sicura"
        }
    }

    private func pollUntilFinished() async {
        var previousStatus = currentJob.status
        while !Task.isCancelled {
            do {
                detail = try await api.job(id: job.id)
                errorMessage = nil
                if let status = detail?.job.status,
                   status != previousStatus,
                   !["queued", "running"].contains(status) {
                    UINotificationFeedbackGenerator().notificationOccurred(status == "done" ? .success : .error)
                    previousStatus = status
                }
            } catch {
                errorMessage = error.localizedDescription
            }
            if let status = detail?.job.status, !["queued", "running"].contains(status) {
                // Close Reels/HappyDEV first, then the focus feed itself. The brief
                // delay lets the completion haptic finish without making the UI flash.
                activity = nil
                try? await Task.sleep(nanoseconds: 350_000_000)
                dismiss()
                return
            }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
        }
    }
}

enum WaitingActivity: String, CaseIterable, Identifiable {
    case reels
    case happyDev
    var id: String { rawValue }
    var title: String { self == .reels ? "Instagram Reels" : "HappyDEV" }
    var icon: String { self == .reels ? "play.fill" : "gamecontroller.fill" }
}

private struct WaitingActivityView: View {
    @Environment(\.dismiss) private var dismiss
    let activity: WaitingActivity
    let job: JobSummary

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 11) {
                ZStack {
                    Circle().fill(accent.opacity(0.18))
                    Image(systemName: activity.icon).foregroundStyle(accent)
                }
                .frame(width: 38, height: 38)
                VStack(alignment: .leading, spacing: 1) {
                    Text(activity.title).font(.headline)
                    HStack(spacing: 6) {
                        if ["queued", "running"].contains(job.status) { ProgressView().controlSize(.mini) }
                        Text(["queued", "running"].contains(job.status) ? "L’agente lavora in background" : "Il lavoro è terminato")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Chiudi") { dismiss() }.fontWeight(.semibold)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.bar)

            if activity == .reels {
                InstagramSafariView(url: URL(string: "https://www.instagram.com/reels/")!)
            } else {
                HappyDevWebView()
            }
        }
        .background(AppTheme.ink)
    }

    private var accent: Color { activity == .reels ? Color(red: 0.96, green: 0.24, blue: 0.55) : AppTheme.violet }
}

private struct InstagramSafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.dismissButtonStyle = .close
        controller.preferredControlTintColor = UIColor(AppTheme.cyan)
        return controller
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

private struct HappyDevWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = UIColor(red: 0.067, green: 0.075, blue: 0.102, alpha: 1)
        view.scrollView.isScrollEnabled = false
        view.scrollView.bounces = false
        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "HappyDev") {
            view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

private struct FocusCard {
    let eyebrow: String
    let title: String
    let body: String
    let icon: String
    let colors: [Color]
}

private struct FocusCardView: View {
    let card: FocusCard
    let job: JobSummary

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(colors: card.colors, startPoint: .topLeading, endPoint: .bottomTrailing)
            Circle()
                .fill(.white.opacity(0.15))
                .frame(width: 330, height: 330)
                .blur(radius: 18)
                .offset(x: 150, y: -240)
            Image(systemName: card.icon)
                .font(.system(size: 160, weight: .thin))
                .foregroundStyle(.white.opacity(0.14))
                .rotationEffect(.degrees(-9))
                .offset(x: 120, y: -230)

            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    AgentBadge(job.agent, size: 42)
                    StatusPill(status: job.status)
                }
                Text(card.eyebrow)
                    .font(.caption.bold())
                    .tracking(2.0)
                    .foregroundStyle(.white.opacity(0.72))
                Text(card.title)
                    .font(.system(.title, design: .rounded, weight: .bold))
                    .lineLimit(7)
                    .minimumScaleFactor(0.72)
                Text(card.body)
                    .font(.body)
                    .lineLimit(8)
                    .foregroundStyle(.white.opacity(0.78))
                Label("Scorri", systemImage: "chevron.up")
                    .font(.caption.bold())
                    .foregroundStyle(.white.opacity(0.62))
            }
            .padding(26)
        }
        .clipShape(RoundedRectangle(cornerRadius: 34, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 34, style: .continuous)
                .stroke(.white.opacity(0.22), lineWidth: 1)
        }
        .shadow(color: card.colors.last?.opacity(0.30) ?? .clear, radius: 28, y: 16)
    }
}
