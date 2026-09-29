# iPhone and iPad installation

The iOS client is a native SwiftUI app. It requires iOS 16 or newer and the
HTTPS address of an Agent Bridge server reachable through Tailscale.

## Recommended: Xcode on a Mac

1. Clone the repository on the Mac and open `ios/AgentBridge.xcodeproj`.
2. Select the **Agent Bridge** target and open **Signing & Capabilities**.
3. Choose your Apple Team. If needed, replace `com.agentbridge.ios` with a
   unique bundle identifier.
4. Connect and trust the iPhone, select it as the destination, and press **Run**.
5. On first launch, enter the URL printed by `tailscale serve status` on the
   Linux PC, followed by your Agent Bridge password and 2FA code.

A free Apple account normally requires the development signature to be renewed
every seven days. TestFlight requires the Apple Developer Program.

## Without a Mac: GitHub Actions

1. Open the repository **Actions** tab.
2. Run **Build iPhone app (unsigned)**.
3. Download the `AgentBridge-unsigned-ipa` artifact.
4. Sign and install it using SideStore or another trusted sideloading tool.
5. If requested, enable **Developer Mode** and trust the profile under
   **Settings → General → VPN & Device Management**.

An unsigned IPA cannot run directly. Signing associates the build with your
device and Apple account. Enter Apple credentials only in the official tool you
choose, never in a repository issue or file.

## Simulator

The official iPhone simulator requires macOS and Xcode:

```bash
scripts/run-ios-simulator.sh
```

On Linux, use a physical iPhone or the GitHub Actions build. There is no official
iOS simulator for Linux that replaces testing on a real device.
