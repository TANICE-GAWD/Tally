# Maestro E2E flows

Mobile UI automation that drives the real app on a real device — no native build required because we run against Expo Go.

## Why Maestro instead of Detox

Detox is the React Native standard, but it requires a custom native build, a configured simulator/emulator, and several hundred lines of glue per test run. Maestro is YAML-based, runs against Expo Go via the `host.exp.Exponent` app ID, and gets the same "did the offline-mid-shift flow round-trip correctly" signal in 30 lines. For a portfolio project where the bar is *demonstrating* test discipline, Maestro is the right trade.

## Install

```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
maestro --version
```

You also need an Android emulator running, or an iOS simulator with Expo Go installed, or a real device with Expo Go and USB debugging.

## Run

1. Start the dev server in one terminal: `npx expo start`
2. Scan the QR with Expo Go on your device/emulator. Wait for the login screen to appear.
3. In a second terminal, from the project root:

```bash
maestro test .maestro/flows/login.yaml
maestro test .maestro/flows/clock-cycle.yaml
maestro test .maestro/flows/trade-switch.yaml
maestro test .maestro/flows/foreman-dashboard.yaml
```

Or run all of them in sequence:

```bash
maestro test .maestro/flows
```

## What each flow proves

| Flow | Proves |
|---|---|
| `login.yaml` | Auth happy path against real Supabase, profile loads |
| `clock-cycle.yaml` | Clock-in writes to SQLite, status flips, clock-out flips back |
| `trade-switch.yaml` | Mid-shift trade switch produces the expected pair of events |
| `foreman-dashboard.yaml` | Role-gated UI (worker doesn't see Dashboard, foreman does) |

## Limitations against Expo Go

- The app ID is `host.exp.Exponent` (the Expo Go container), not your real bundle ID. Multiple Expo Go projects share the same container, so the flow assumes our app is the currently-loaded project.
- You can't kill-restart the app between flows in a way that survives a Metro reload — re-scan the QR if state is stuck.
- For true CI you'd want a development build (`npx expo prebuild && eas build --profile development`) and point `appId` at `com.jobsitepulse.app`. The YAML flows themselves don't change.
