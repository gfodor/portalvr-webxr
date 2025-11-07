# PortalVR for WebXR – Chrome Web Store Submission

## Listing Text
- **Extension Name**: PortalVR for WebXR
- **Short Description**: Play WebXR worlds on your laptop while your phone handles tracked controls - no headset required.
- **Long Description**:
PortalVR for WebXR is a WebXR runtime that lets you play immersive WebXR experiences without wearing a headset by pairing your laptop or desktop with the phone you already own. Drop into full VR sessions from your desk, keep your display in view, and move naturally while PortalVR handles rendering, pose tracking, and input.

Any ARCore- or ARKit-compatible phone becomes a 6DoF controller with all axis controls and buttons, so entire VR experiences run with just your mobile device. Ultra-low-latency motion response keeps handheld play snappy, and optional green-magenta 3D glasses add comfortable stereo depth when you want a more enveloping view, giving you solid tracking without strapping on hardware.

PortalVR works with the WebXR experiences you already ship or browse today. Launch built-in demos like Open Brush, Open Blocks, ALVR, and the Wolvic WebXR browser, or point the runtime at any WebXR site to stream, demo, and record without touching the original code.

All camera, motion, Bluetooth, and optional microphone data stays on-device to power tracking, while only minimal diagnostic telemetry (crash reports and basic events) is sent to Sentry or Mixpanel; there is no targeted advertising, selling, or sharing of personal information. Contact Founder and Chief Privacy Officer Greg Fodor (gfodor@portalvr.io) for privacy requests.

Need help? Support@portalvr.io responds within one U.S. business day, and the Support page links Discord for live triage plus the Polar billing portal for licenses and invoices.

## Release Notes (v1.0.0)
- First Chrome Web Store build of PortalVR for WebXR
- Pair any ARCore/ARKit phone as a fully tracked WebXR controller
- Enable handheld 3D play with 3D glasses and optional stereo rendering
- Launch built-in demos plus any WebXR site via the bundled Wolvic browser
- Record and share desktop-friendly captures without booting a headset

## Privacy, Support, and Legal
- **Privacy Policy URL**: https://portalvr.io/privacy (effective September 12, 2025)
- **Data Handling Summary**: Sensor streams (camera, motion, microphone, Bluetooth) stay local; only crash reports and basic event telemetry go to Sentry and Mixpanel. No targeted ads, no selling or sharing of personal data. Email gfodor@portalvr.io to access or delete diagnostics.
- **Support URL**: https://portalvr.io/support
- **Support Email**: support@portalvr.io (target response ≤1 U.S. business day)
- **Community**: PortalVR Discord (linked from Support page) for live help/releases.
- **Billing Portal**: Polar customer portal for invoices and license transfers.
- **Developer / Publisher**: Portal VR, Inc., 333 W San Carlos St, Suite 600, San Jose, CA 95110, USA (legal@portalvr.io).
- **Latest Terms of Service**: https://portalvr.io/terms (last updated September 26, 2025; Delaware law, no user accounts required, three paid tiers).

## Chrome Web Store Data Disclosure Defaults
- **Collected Data Types**: Diagnostics (crash reports, basic event telemetry); device metadata needed for updates.
- **Usage**: Maintain and debug functionality; improve reliability.
- **Sharing**: Service providers Sentry (crash monitoring) and Mixpanel (event analytics) under contractual limits; no advertising use.
- **User Control**: Revoke Android permissions anytime; email gfodor@portalvr.io for data access or deletion; telemetry retained ≈90 days unless legally required otherwise.

## Asset Inventory
- Icons (PNG, transparent):
  - `submission/chrome/icons/portalvr-icon-16.png`
  - `submission/chrome/icons/portalvr-icon-32.png`
  - `submission/chrome/icons/portalvr-icon-48.png`
  - `submission/chrome/icons/portalvr-icon-128.png`
  - `submission/chrome/icons/portalvr-icon-512.png`
- Listing Screenshot (1280×800): `submission/chrome/screenshots/portalvr-webxr-1280x800.png`

## Build & Packaging Notes
1. Run `npm run build:emulator` from the repo root.
2. Zip the contents of `immersive-web-emulator/build/` (manifest, icons, JS bundles, runtime, wasm) for the Chrome Web Store upload.
3. Record the commit hash used for packaging and attach release notes above to the Store listing.
