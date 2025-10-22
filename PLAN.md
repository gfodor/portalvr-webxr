# Implementation Plan

## Overview
- Introduce extensibility points on `src/device/XRDevice.ts` to plug in head pose providers, compositor hooks, controller bridges, and overlay managers.
- Keep feature lifecycles aligned with `XRSession` start/stop using the existing `onBaseLayerSet`/`onSessionEnd` plumbing in `XRDevice` and the frame loop in `src/session/XRSession.ts`.
- Surface configuration flags (via `XRDeviceOptions` or follow-on setters) so each feature can be toggled independently at runtime.

## 1. Front-Facing Camera Pose Driver
- Define a `HeadPoseProvider` wrapper in `src/pose/HeadPoseDriver.ts` that encapsulates the existing camera + face tracking implementation (start/stop/subscribe/getLatestPose).
- Extend `XRDevice` to accept an optional provider (`setHeadPoseProvider`), storing it on `[P_DEVICE]` and defaulting to the current manual pose controls.
- In `XRDevice.onFrameStart` (just before the first `updateViews()` call) pull the latest pose from the provider, convert to the emulator’s reference space, and copy the values into `this[P_DEVICE].position` and `this[P_DEVICE].quaternion`.
- Handle provider loss/reacquisition: fall back to the default pose, trigger `pendingReferenceSpaceReset`, and expose calibration offsets/IPD overrides through `XRDeviceOptions`.
- Start the provider when an immersive session is granted (e.g., alongside `grantOfferedSession` or explicit opt-in) and stop/cleanup inside `XRDevice.onSessionEnd`.

## 2. Anaglyph Rendering Pipeline
- Add `src/rendering/AnaglyphComposer.ts` to manage offscreen color targets for left/right eyes, a fullscreen quad program, and the red/cyan color matrix.
- Instantiate the composer from `XRDevice.onBaseLayerSet`, wiring it to the session’s `XRWebGLLayer` context and respecting canvas resize events triggered there.
- Introduce compositor hooks in `XRSession.[P_SESSION].onDeviceFrame`: after executing the app’s animation callbacks but before deactivating the frame, call `composer.compose(frameTime)` to copy the left/right viewports and output the anaglyph image to the default framebuffer.
- Bypass the composer for inline sessions or when stereo rendering is disabled; reallocate FBOs whenever `canvas.width`/`height` change.
- Gate the feature behind a new option (e.g., `XRDeviceOptions.enableAnaglyph`) and expose runtime toggles for debugging.

## 3. WebRTC Controller Pose Pipeline
- Implement `src/input/webrtc/WebRTCControllerBridge.ts` to own the `RTCPeerConnection`, `RTCDataChannel`, and message queue feeding a bundled Wasm module (loaded via `WebAssembly.instantiate` or dynamic `import`).
- Define a clear Wasm interface (init/handleMessage/getPoseState) that returns controller transforms, button pressures, and per-axis values.
- Extend `XRDevice` with `registerControllerPoseBridge(bridge, handedness)` so each bridge updates the corresponding `XRController` stored in `[P_DEVICE].controllers`.
- During `XRDevice.onFrameStart`, before iterating `this.activeInputs`, invoke `bridge.update(frameTime)` to retrieve the latest pose and push it into `controller.position`, `controller.quaternion`, and the gamepad state helpers (`updateButtonValue`, `updateAxes`).
- Reflect connection health by toggling `controller.connected`, which will propagate `inputsourceschange` events through the existing session machinery.
- Tear down the bridge (closing the data channel and freeing Wasm resources) inside `XRDevice.onSessionEnd` and provide hooks for reconnection or multiple controllers if needed.

## 4. XR UI Overlay
- Replace the current dev UI layer with a new overlay module (`src/ui/XROverlay.ts`) that mounts a DOM/canvas surface on `XRDevice.canvasContainer` with z-index above `Z_INDEX_APP_CANVAS`.
- Update `XRDevice.onBaseLayerSet` to mount the overlay, hide/remove the previous `devui` canvas/container when the new overlay is active, and expose API methods (`showOverlay`, `hideOverlay`, `setOverlayContent`).
- Ensure `XRDevice.onSessionEnd` unmounts the overlay nodes and restores any prior UI state.
- Provide toggle controls (keyboard/gamepad hooks or public API) so gameplay can hide the overlay on demand while still allowing full-screen menus or diagnostics.

## Cross-Cutting Items
- Extend `XRDeviceOptions` (or follow-up setters) with flags/calibration data for the pose driver, anaglyph compositor, WebRTC controllers, and overlay enablement.
- Add telemetry/logging helpers to trace head pose latency, compositor timing, and WebRTC health for debugging.
- Update `docs/` and `README.md` with configuration instructions, capability notes, and troubleshooting tips for each feature.

## Validation
- Use the `example/` app to manually verify: (1) front-facing poses align with camera motion, (2) anaglyph output renders depth correctly with red/cyan glasses, (3) WebRTC controller data drives the emulated controllers without drift, and (4) the overlay toggles on/off cleanly during gameplay.
- Where feasible, add smoke tests or scripted mocks (e.g., a fake data channel) to exercise the new pipelines in CI.
