import Combine
import Foundation

@MainActor
final class AppConfiguration: ObservableObject {
    private static let serverKey = "agentBridge.serverURL"
    private static let defaultServer = ""

    @Published private(set) var serverURL: URL?

    init() {
        let value = UserDefaults.standard.string(forKey: Self.serverKey) ?? Self.defaultServer
        serverURL = Self.normalizedURL(from: value)
        if UserDefaults.standard.string(forKey: Self.serverKey) == nil, let serverURL {
            UserDefaults.standard.set(serverURL.absoluteString, forKey: Self.serverKey)
        }
    }

    func save(_ value: String) throws {
        guard let url = Self.normalizedURL(from: value) else {
            throw ConfigurationError.invalidURL
        }
        UserDefaults.standard.set(url.absoluteString, forKey: Self.serverKey)
        serverURL = url
    }

    func clear() {
        UserDefaults.standard.removeObject(forKey: Self.serverKey)
        serverURL = nil
    }

    static func normalizedURL(from value: String) -> URL? {
        var text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix("/") { text.removeLast() }
        guard
            let components = URLComponents(string: text),
            components.scheme?.lowercased() == "https",
            components.host != nil,
            components.user == nil,
            components.password == nil,
            components.path.isEmpty,
            components.query == nil,
            components.fragment == nil
        else { return nil }
        return components.url
    }
}

enum ConfigurationError: LocalizedError {
    case invalidURL
    case unexpectedResponse

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Enter a valid HTTPS address, e.g. https://my-pc.tail1234.ts.net"
        case .unexpectedResponse:
            return "The server responded, but it doesn't appear to be Agent Bridge."
        }
    }
}
