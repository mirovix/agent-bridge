import SwiftUI
import UIKit

@main
struct AgentBridgeApp: App {
    @StateObject private var configuration = AppConfiguration()

    init() {
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = UIColor(red: 0.035, green: 0.043, blue: 0.075, alpha: 0.96)
        tab.stackedLayoutAppearance.normal.iconColor = UIColor.systemGray
        tab.stackedLayoutAppearance.selected.iconColor = UIColor(AppTheme.cyan)
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab

        let navigation = UINavigationBarAppearance()
        navigation.configureWithTransparentBackground()
        navigation.titleTextAttributes = [.foregroundColor: UIColor.white]
        UINavigationBar.appearance().standardAppearance = navigation
        UINavigationBar.appearance().scrollEdgeAppearance = navigation
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(configuration)
        }
    }
}
