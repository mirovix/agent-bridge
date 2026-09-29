import Foundation
import SwiftUI

struct MessageView: View {
    let message: BridgeMessage
    let agentName: String

    var body: some View {
        switch message.role {
        case "user": bubble(isMine: true)
        case "assistant": bubble(isMine: false)
        case "error":
            Label(message.text, systemImage: "exclamationmark.triangle.fill")
                .font(.callout).foregroundStyle(.red).padding(11)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
        case "tool", "tool_result", "thinking":
            DisclosureGroup {
                Text(message.text).font(.caption.monospaced()).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 5)
            } label: {
                Label(toolLabel, systemImage: message.role == "thinking" ? "brain" : "wrench.and.screwdriver")
                    .font(.caption)
            }
            .padding(9)
            .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        default:
            Text(message.text).font(.caption).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private func bubble(isMine: Bool) -> some View {
        HStack(alignment: .bottom, spacing: 7) {
            if isMine { Spacer(minLength: 50) }
            if !isMine { AgentBadge(agentKey, size: 28) }
            VStack(alignment: .leading, spacing: 5) {
                if !isMine {
                    Text(agentName).font(.caption2.bold()).foregroundStyle(AppTheme.mint)
                }
                markdown(message.text)
                    .font(.body).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                if let time = messageTime {
                    Text(time)
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.55))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .foregroundStyle(.white)
            .background(isMine ? AnyShapeStyle(Color(red: 0.04, green: 0.43, blue: 0.34)) : AnyShapeStyle(Color(red: 0.12, green: 0.15, blue: 0.20)), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(.white.opacity(0.06), lineWidth: 1) }
            .frame(maxWidth: 330, alignment: isMine ? .trailing : .leading)
            if !isMine { Spacer(minLength: 34) }
        }
        .frame(maxWidth: .infinity, alignment: isMine ? .trailing : .leading)
        .accessibilityElement(children: .combine)
    }

    private var agentKey: String { agentName.lowercased().contains("claude") ? "claude" : "codex" }
    private var messageTime: String? {
        guard let value = message.ts, let date = ISO8601DateFormatter().date(from: value) else { return nil }
        return date.formatted(date: .omitted, time: .shortened)
    }
    private var toolLabel: String {
        if message.role == "thinking" { return "Reasoning" }
        return message.name ?? (message.role == "tool_result" ? "Output" : "Tool")
    }
    @ViewBuilder private func markdown(_ value: String) -> some View {
        if let attributed = try? AttributedString(markdown: value) { Text(attributed) }
        else { Text(value) }
    }
}

struct AgentBadge: View {
    let agent: String
    let size: CGFloat
    init(_ agent: String, size: CGFloat = 36) { self.agent = agent; self.size = size }
    var body: some View {
        Text(agent == "claude" ? "C" : agent == "codex" ? "X" : String(agent.prefix(1)).uppercased())
            .font(.system(size: size * 0.42, weight: .bold)).foregroundStyle(.white)
            .frame(width: size, height: size).background(color, in: Circle())
    }
    private var color: Color {
        switch agent {
        case "claude": return Color(red: 0.82, green: 0.46, blue: 0.29)
        case "codex": return Color(red: 0.13, green: 0.5, blue: 0.43)
        default: return .indigo
        }
    }
}

struct StatusPill: View {
    let status: String
    var body: some View {
        Label(label, systemImage: icon).font(.caption.bold()).foregroundStyle(color)
            .padding(.horizontal, 8).padding(.vertical, 4).background(color.opacity(0.12), in: Capsule())
    }
    private var label: String { ["running": "running", "done": "done", "failed": "error", "cancelled": "stopped"][status] ?? status }
    private var icon: String { ["running": "circle.dotted", "done": "checkmark.circle.fill", "failed": "exclamationmark.circle.fill", "cancelled": "stop.circle.fill"][status] ?? "circle" }
    private var color: Color { ["running": Color.orange, "done": Color.green, "failed": Color.red, "cancelled": Color.secondary][status] ?? .secondary }
}
