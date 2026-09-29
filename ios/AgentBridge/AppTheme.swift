import SwiftUI

enum AppTheme {
    static let ink = Color(red: 0.025, green: 0.035, blue: 0.075)
    static let cyan = Color(red: 0.08, green: 0.78, blue: 1.0)
    static let violet = Color(red: 0.48, green: 0.24, blue: 1.0)
    static let mint = Color(red: 0.20, green: 0.92, blue: 0.72)
}

struct AuroraBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [AppTheme.ink, Color(red: 0.055, green: 0.04, blue: 0.14), AppTheme.ink],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Circle()
                .fill(AppTheme.cyan.opacity(0.22))
                .frame(width: 310, height: 310)
                .blur(radius: 72)
                .offset(x: -150, y: -280)
            Circle()
                .fill(AppTheme.violet.opacity(0.24))
                .frame(width: 360, height: 360)
                .blur(radius: 86)
                .offset(x: 180, y: 300)
        }
        .ignoresSafeArea()
    }
}

struct GlassPanel: ViewModifier {
    var cornerRadius: CGFloat = 24

    func body(content: Content) -> some View {
        content
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(
                        LinearGradient(
                            colors: [.white.opacity(0.28), AppTheme.cyan.opacity(0.10), AppTheme.violet.opacity(0.22)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
            }
            .shadow(color: .black.opacity(0.28), radius: 24, y: 12)
    }
}

extension View {
    func glassPanel(cornerRadius: CGFloat = 24) -> some View {
        modifier(GlassPanel(cornerRadius: cornerRadius))
    }
}

struct BrandMark: View {
    var size: CGFloat = 68

    var body: some View {
        Image("BridgeLogo")
            .resizable()
            .scaledToFill()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.24, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
                    .stroke(.white.opacity(0.22), lineWidth: 1)
            }
            .shadow(color: AppTheme.cyan.opacity(0.30), radius: 18)
    }
}
