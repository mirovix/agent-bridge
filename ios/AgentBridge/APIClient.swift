import Combine
import Foundation

@MainActor
final class APIClient: ObservableObject {
    enum AuthState { case checking, signedOut, signedIn }

    @Published private(set) var authState: AuthState = .checking
    @Published private(set) var me: MeResponse?
    @Published var connectionError: String?

    private var baseURL: URL?
    private var csrf: String?
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = .shared
        configuration.httpShouldSetCookies = true
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration)
    }

    func configure(baseURL: URL) {
        guard self.baseURL != baseURL else { return }
        self.baseURL = baseURL
        csrf = nil
        me = nil
        authState = .checking
    }

    func restoreSession() async {
        do {
            let response: MeResponse = try await get("api/me")
            csrf = response.csrf
            me = response
            connectionError = nil
            authState = .signedIn
        } catch APIError.unauthorized {
            connectionError = nil
            authState = .signedOut
        } catch {
            connectionError = error.localizedDescription
            authState = .signedOut
        }
    }

    func login(password: String, code: String) async throws {
        struct Body: Encodable { let password: String; let code: String }
        let response: LoginResponse = try await post("api/login", body: Body(password: password, code: code), includeCSRF: false)
        csrf = response.csrf
        // Unlike restoreSession(), login must surface a follow-up network error to
        // the form instead of silently clearing credentials and appearing stuck.
        let profile: MeResponse = try await get("api/me")
        csrf = profile.csrf
        me = profile
        connectionError = nil
        authState = .signedIn
    }

    func logout(all: Bool = false) async {
        let path = all ? "api/logout-all" : "api/logout"
        let _: EmptyResponse? = try? await post(path, body: EmptyBody())
        csrf = nil
        me = nil
        authState = .signedOut
    }

    func sessions() async throws -> [SessionItem] {
        let response: SessionsResponse = try await get("api/sessions")
        return response.sessions
    }

    func session(agent: String, id: String) async throws -> SessionDetailResponse {
        try await get("api/sessions/\(agent)/\(id)")
    }

    func jobs() async throws -> [JobSummary] {
        let response: JobsResponse = try await get("api/jobs")
        return response.jobs
    }

    func job(id: String) async throws -> JobDetailResponse {
        try await get("api/jobs/\(id)")
    }

    func startJob(_ request: JobRequest) async throws -> JobSummary {
        let response: JobStartResponse = try await post("api/jobs", body: request)
        return response.job
    }

    func cancelJob(id: String) async throws {
        let _: EmptyResponse = try await post("api/jobs/\(id)/cancel", body: EmptyBody())
    }

    func directory(path: String) async throws -> DirectoryResponse {
        var components = URLComponents()
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        return try await get("api/dirs?\(components.percentEncodedQuery ?? "")")
    }

    func devices() async throws -> [DeviceInfo] {
        let response: DevicesResponse = try await get("api/devices")
        return response.devices
    }

    func revokeDevice(id: String) async throws -> Bool {
        struct Body: Encodable { let id: String }
        struct Response: Decodable {
            let selfDevice: Bool
            enum CodingKeys: String, CodingKey { case selfDevice = "self" }
        }
        let response: Response = try await post("api/devices/revoke", body: Body(id: id))
        if response.selfDevice {
            csrf = nil
            me = nil
            authState = .signedOut
        }
        return response.selfDevice
    }

    func audit() async throws -> [AuditEvent] {
        let response: AuditResponse = try await get("api/audit")
        return response.events
    }

    func serverInfo() async throws -> ServerInfo {
        try await get("api/server-info")
    }

    func transcribe(data: Data, mimeType: String, language: String = "it") async throws -> String {
        guard let url = makeURL("api/transcribe?lang=\(language)") else { throw APIError.notConfigured }
        var request = baseRequest(url: url, method: "POST")
        // The first local Whisper request can spend time loading the model.
        // Match the server's 90-second transcription budget instead of using
        // the generic 30-second timeout shared by the other API calls.
        request.timeoutInterval = 100
        request.setValue(mimeType, forHTTPHeaderField: "Content-Type")
        if let csrf { request.setValue(csrf, forHTTPHeaderField: "X-CSRF-Token") }
        request.httpBody = data
        let response: TranscriptionResponse = try await perform(request)
        return response.text
    }

    private func get<Response: Decodable>(_ path: String) async throws -> Response {
        guard let url = makeURL(path) else { throw APIError.notConfigured }
        return try await perform(baseRequest(url: url, method: "GET"))
    }

    private func post<Response: Decodable, Body: Encodable>(
        _ path: String,
        body: Body,
        includeCSRF: Bool = true
    ) async throws -> Response {
        guard let url = makeURL(path) else { throw APIError.notConfigured }
        var request = baseRequest(url: url, method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if includeCSRF, let csrf { request.setValue(csrf, forHTTPHeaderField: "X-CSRF-Token") }
        request.httpBody = try JSONEncoder().encode(body)
        return try await perform(request)
    }

    private func baseRequest(url: URL, method: String) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("AgentBridge-iOS/1.0 (iPhone)", forHTTPHeaderField: "User-Agent")
        if method != "GET", let baseURL {
            var origin = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
            origin?.path = ""
            origin?.query = nil
            origin?.fragment = nil
            request.setValue(origin?.url?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        }
        return request
    }

    private func makeURL(_ path: String) -> URL? {
        guard let baseURL else { return nil }
        let parts = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        components?.path = "/" + String(parts[0])
        components?.percentEncodedQuery = parts.count > 1 ? String(parts[1]) : nil
        return components?.url
    }

    private func perform<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 {
            authState = .signedOut
            csrf = nil
            me = nil
            throw APIError.unauthorized
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ServerError.self, from: data).error) ?? "Errore server \(http.statusCode)"
            throw APIError.server(message)
        }
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw APIError.invalidResponse
        }
    }
}

private struct EmptyBody: Encodable {}
