# iPhone and iPad installation

## Quickest: the web app (nothing to install)

1. Install **Tailscale** from the App Store and sign in with the same account as your computer.
2. Open the `https://…ts.net` address that `tailscale serve status` prints on the computer, in **Safari**.
3. Sign in with your password and 2FA code, then tap **Share → Add to Home Screen**.

It opens full screen like an app, and updates by itself whenever the server is updated.
The native app below is optional.

The iOS client is a native SwiftUI app. It requires iOS 16 or newer and the
HTTPS address of an Agent Bridge server reachable through Tailscale.

## Recommended: Xcode on a Mac

1. Clone the repository on the Mac and open `ios/AgentBridge.xcodeproj`.
2. Select the **Agent Bridge** target and open **Signing & Capabilities**.
3. Choose your Apple Team. If needed, replace `com.agentbridge.ios` with a
   unique bundle identifier.
4. Connect and trust the iPhone, select it as the destination, and press **Run**.
5. On first launch, enter the URL printed by `tailscale serve status` on the
   computer running the server, followed by your Agent Bridge password and 2FA code.

A free Apple account normally requires the development signature to be renewed
every seven days. TestFlight requires the Apple Developer Program.

## Without a Mac: the release IPA

1. Download `AgentBridge-<version>-ios-unsigned.ipa` from the
   [latest release](https://github.com/mirovix/agent-bridge/releases/latest).
2. Sign and install it with SideStore, AltStore or another sideloading tool you trust.
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
