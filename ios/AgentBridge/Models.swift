import Foundation

struct LoginResponse: Decodable {
    let csrf: String
    let usedRecovery: Bool
    let recoveryCodesLeft: Int
}

struct AgentModelInfo: Codable, Hashable, Identifiable {
    let id: String
    let label: String
    let description: String?
    let efforts: [String]
}

struct AgentInfo: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let resumable: Bool
    let fork: Bool
    let images: Bool
    let modes: [String]
    let defaultMode: String?
    let models: [AgentModelInfo]
}

struct WorkspaceChoices: Decodable {
    let roots: [String]
    let recent: [String]
}

struct MeResponse: Decodable {
    let csrf: String
    let agents: [AgentInfo]
    let workspaces: WorkspaceChoices
    let host: String
    let idleMinutes: Int
    let expiresAt: Double
    let maxPromptChars: Int
    let voice: Bool
}

struct SessionItem: Decodable, Identifiable, Hashable {
    let agent: String
    let id: String
    let cwd: String?
    let title: String?
    let origin: String?
    let updated: Double
    let canSend: Bool
    let busy: Bool
}

struct BridgeMessage: Decodable, Identifiable {
    let id = UUID()
    let role: String
    let text: String
    let name: String?
    let ts: String?
    let meta: Bool?
    let error: Bool?

    private enum CodingKeys: String, CodingKey {
        case role, text, name, ts, meta, error
    }
}

struct SessionDetailResponse: Decodable {
    let session: SessionItem
    let messages: [BridgeMessage]
    let truncated: Bool
}

struct SessionsResponse: Decodable { let sessions: [SessionItem] }

struct JobSummary: Decodable, Identifiable, Hashable {
    let id: String
    let agent: String
    let sessionId: String?
    let resumeOf: String?
    let fork: Bool
    let model: String?
    let effort: String?
    let images: Int
    let cwd: String
    let mode: String?
    let transport: String?
    let status: String
    let started: Double
    let ended: Double?
    let exitCode: Int?
    let promptPreview: String
}

struct JobsResponse: Decodable { let jobs: [JobSummary] }
struct JobStartResponse: Decodable { let job: JobSummary }
struct JobDetailResponse: Decodable {
    let job: JobSummary
    let events: [BridgeMessage]
}

struct JobImage: Encodable {
    let mediaType: String
    let data: String
}

struct JobRequest: Encodable {
    let agent: String
    let sessionId: String?
    let cwd: String?
    let mode: String?
    let model: String?
    let effort: String?
    let prompt: String
    let fork: Bool
    let images: [JobImage]?
}

struct DirectoryResponse: Decodable {
    let path: String
    let parent: String?
    let dirs: [String]
}

struct DevicesResponse: Decodable { let devices: [DeviceInfo] }
struct DeviceInfo: Decodable, Identifiable {
    let id: String
    let current: Bool
    let created: Double
    let lastSeen: Double
    let from: String?
    let tailscaleUser: String?
    let ua: String?
}

struct AuditResponse: Decodable { let events: [AuditEvent] }
struct AuditEvent: Decodable, Identifiable {
    let id = UUID()
    let ts: String?
    let event: String?
    let forwardedFor: String?
    let tailscaleUser: String?
    let ua: String?
    let reason: String?
    let agent: String?
    let mode: String?
    let model: String?
    let effort: String?
    let status: String?
    let fork: Bool?
    let images: Int?
    let usedRecovery: Bool?

    private enum CodingKeys: String, CodingKey {
        case ts, event, forwardedFor, tailscaleUser, ua, reason, agent, mode, model, effort, status, fork, images, usedRecovery
    }
}

struct ServerVersions: Decodable {
    let claude: String?
    let codex: String?
}

struct ServerInfo: Decodable {
    let host: String
    let workspaces: [String]
    let allowedOrigins: [String]
    let sessionIdleMinutes: Int
    let sessionMaxHours: Int
    let allowDangerousModes: Bool
    let maxConcurrentJobs: Int
    let jobTimeoutMinutes: Int
    let versions: ServerVersions
    let voice: Bool
    let configPath: String
}

struct EmptyResponse: Decodable { let ok: Bool? }
struct TranscriptionResponse: Decodable { let text: String }
struct ServerError: Decodable { let error: String }

enum APIError: LocalizedError {
    case notConfigured
    case unauthorized
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "The server is not configured."
        case .unauthorized: return "Session expired."
        case .invalidResponse: return "Invalid response from the server."
        case .server(let message): return message
        }
    }
}

extension String {
    var abbreviatedPath: String {
        if hasPrefix("/home/") {
            let parts = split(separator: "/", omittingEmptySubsequences: true)
            if parts.count >= 3 { return "~/" + parts.dropFirst(2).joined(separator: "/") }
        }
        return self
    }

    var lastPathComponent: String {
        (self as NSString).lastPathComponent
    }
}

func relativeTime(_ milliseconds: Double) -> String {
    let interval = Date().timeIntervalSince1970 - milliseconds / 1000
    if interval < 60 { return "just now" }
    if interval < 3600 { return "\(Int(interval / 60)) min ago" }
    if interval < 86_400 { return "\(Int(interval / 3600)) h ago" }
    if interval < 604_800 { return "\(Int(interval / 86_400)) d ago" }
    return Date(timeIntervalSince1970: milliseconds / 1000).formatted(date: .abbreviated, time: .omitted)
}
