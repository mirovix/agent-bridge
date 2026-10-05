# Install the app on your phone, tablet or another computer

Agent Bridge has no separate app to download. The server serves a web app that
every system can install to the home screen, where it opens full screen, without
a browser bar, and updates by itself whenever you update the server.

Before you start, the computer with your agents must be running Agent Bridge and
be reachable through Tailscale (see the [server guide](INSTALL_SERVER.md)).
On that computer, `tailscale serve status` prints your private address, something
like `https://my-pc.tail1234.ts.net`.

## 1. Join the same tailnet

Install **Tailscale** on the device and sign in with the same account as the
computer: [App Store](https://apps.apple.com/app/tailscale/id1470499037) ·
[Google Play](https://play.google.com/store/apps/details?id=com.tailscale.ipn) ·
[desktop](https://tailscale.com/download). Leave it connected.

## 2. Open your address and sign in

Open the `https://…ts.net` address in the browser, then enter your password and
the 6-digit code from your authenticator app.

## 3. Add it to the home screen

| Device | How |
| --- | --- |
| iPhone, iPad | In **Safari**, tap **Share** (the square with the arrow) → **Add to Home Screen** → **Add**. |
| Android | In **Chrome**, tap **⋮** → **Add to Home screen** (or **Install app**) → **Install**. |
| Windows, Linux | In **Chrome** or **Edge**, click the **install icon** in the address bar (or **⋮ → Cast, save and share → Install**). |
| macOS | In **Safari**, choose **File → Add to Dock**. In Chrome, use the install icon in the address bar. |

That is the whole installation. The icon behaves like any other app: it appears
in the launcher or on the home screen, opens full screen and remembers your
sign-in until the session expires.

## Notes

- **It must be installed from your own address**, not from a store: the app *is*
  your server, so there is nothing to publish and nothing to sign.
- **Offline**: the app opens and shows its shell without a connection, but
  prompts need the computer to be awake and reachable.
- **Updating**: update the server and every device picks up the new version on
  its next launch. Nothing to reinstall.
- **iOS notifications**: iOS delivers web push only to a web app added to the
  home screen, so add it before expecting any notification.
- **Not connecting?** Check that Tailscale is on, that the address matches what
  `tailscale serve status` prints, and that the same address is listed in
  `allowedOrigins` in `~/.agent-bridge/config.json`.

## Optional: the VS Code companion

On the computer itself, the `.vsix` from the
[latest release](https://github.com/mirovix/agent-bridge/releases/latest) keeps
the editor and the app on one Codex conversation:
`code --install-extension agent-bridge-companion-<version>.vsix`.
