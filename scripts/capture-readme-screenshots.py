#!/usr/bin/env python3
"""Capture the real web UI with deterministic demo API data.

Requires: `pip install playwright` and `playwright install chromium`.
No live Agent Bridge configuration, account, or conversation is read.
"""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "images"
SESSION_ID = "12345678-1234-4234-8234-123456789abc"
NOW = "2026-09-29T15:30:00.000Z"

AGENTS = [
    {
        "id": "claude",
        "name": "Claude Code",
        "resumable": True,
        "fork": True,
        "images": True,
        "modes": ["plan", "manual", "acceptEdits", "auto"],
        "defaultMode": "acceptEdits",
        "models": [{"id": "", "label": "Default", "efforts": ["low", "medium", "high"]}],
    },
    {
        "id": "codex",
        "name": "Codex",
        "resumable": True,
        "fork": True,
        "images": True,
        "modes": ["read-only", "workspace-write"],
        "defaultMode": "workspace-write",
        "models": [{"id": "", "label": "Default", "efforts": ["low", "medium", "high"]}],
    },
]

SESSION = {
    "agent": "codex",
    "id": SESSION_ID,
    "cwd": "/home/demo/workspace/agent-bridge",
    "title": "Polish the mobile chat",
    "origin": "VS Code",
    "updated": 1790695800000,
    "canSend": True,
    "live": True,
    "busy": False,
}

MESSAGES = [
    {
        "id": "m1",
        "role": "user",
        "text": "Make the mobile composer easier to use and keep this conversation synced with VS Code.",
        "ts": "2026-09-29T15:26:00.000Z",
    },
    {
        "id": "m2",
        "role": "thinking",
        "text": "Reviewing the composer, keyboard behavior, and shared-session flow.",
        "ts": "2026-09-29T15:26:04.000Z",
    },
    {
        "id": "m3",
        "role": "tool",
        "name": "tests",
        "text": "48 tests passed",
        "ts": "2026-09-29T15:26:12.000Z",
    },
    {
        "id": "m4",
        "role": "assistant",
        "text": "Done. The composer is cleaner, the keyboard can be dismissed, and new prompts continue in the same desktop conversation.",
        "ts": "2026-09-29T15:26:18.000Z",
    },
]


def payload(path: str) -> dict:
    if path == "/api/me":
        return {
            "csrf": "demo-csrf",
            "agents": AGENTS,
            "workspaces": {"roots": ["/home/demo/workspace"], "recent": ["/home/demo/workspace/agent-bridge"]},
            "host": "development-pc",
            "idleMinutes": 30,
            "expiresAt": 1790739000000,
            "maxPromptChars": 20000,
            "voice": True,
        }
    if path == "/api/sessions":
        return {"sessions": [SESSION]}
    if path == f"/api/sessions/codex/{SESSION_ID}":
        return {"session": SESSION, "messages": MESSAGES, "truncated": False}
    if path == "/api/jobs":
        return {"jobs": []}
    return {}


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    server = subprocess.Popen(
        ["python3", "-m", "http.server", "9876", "--bind", "127.0.0.1", "--directory", str(ROOT / "public")],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        time.sleep(0.5)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            for name, viewport, mobile in [
                ("agent-bridge-desktop.png", {"width": 1440, "height": 900}, False),
                ("agent-bridge-mobile.png", {"width": 390, "height": 844}, True),
            ]:
                context = browser.new_context(
                    viewport=viewport,
                    device_scale_factor=1,
                    is_mobile=mobile,
                    color_scheme="dark",
                )
                page = context.new_page()

                def mock_api(route):
                    url = route.request.url
                    path = "/" + url.split("/", 3)[3].split("?", 1)[0]
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(payload(path)))

                page.route("**/api/**", mock_api)
                page.goto(f"http://127.0.0.1:9876/#/s/codex/{SESSION_ID}", wait_until="networkidle")
                page.locator(".thread").wait_for()
                page.screenshot(path=str(OUTPUT / name), full_page=False)
                context.close()
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)


if __name__ == "__main__":
    main()
