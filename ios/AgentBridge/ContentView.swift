import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var configuration: AppConfiguration
    @StateObject private var api = APIClient()

    var body: some View {
        Group {
            if let serverURL = configuration.serverURL {
                switch api.authState {
                case .checking:
                    ProgressView("Connessione a Agent Bridge…")
                        .task(id: serverURL) {
                            api.configure(baseURL: serverURL)
                            await api.restoreSession()
                        }
                case .signedOut:
                    LoginView()
                        .environmentObject(api)
                case .signedIn:
                    MainTabView()
                        .environmentObject(api)
                }
            } else {
                ConnectionSettingsView(currentURL: "")
            }
        }
        .onChange(of: configuration.serverURL) { newURL in
            if let newURL {
                api.configure(baseURL: newURL)
                Task { await api.restoreSession() }
            }
        }
        .preferredColorScheme(.dark)
    }
}

private struct MainTabView: View {
    var body: some View {
        TabView {
            NavigationStack { SessionsView() }
                .tabItem { Label("Sessioni", systemImage: "bubble.left.and.bubble.right") }
            NavigationStack { NewPromptView() }
                .tabItem { Label("Nuovo", systemImage: "plus.circle") }
            NavigationStack { JobsView() }
                .tabItem { Label("Attività", systemImage: "waveform.path.ecg") }
            NavigationStack { NativeSettingsView() }
                .tabItem { Label("Impostazioni", systemImage: "gearshape") }
        }
        .tint(AppTheme.cyan)
    }
}
