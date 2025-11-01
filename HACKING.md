# Hacking the Immersive Web Emulation Runtime

This document explains where to graft custom head pose, controller pose, and controller
button state into the emulator. The goal is to let you pipe an external tracking/inputs
stack (for example, your OpenXR driver UX) straight into the runtime without rewriting
its WebXR plumbing.

## Overview

`XRDevice` encapsulates the emulated headset and all linked tracked inputs. Every
rendered frame ends up flowing through:

1. `XRDevice.onFrameStart` – invoked once for each XR animation frame.
2. `XRTrackedInput.onFrameStart` – run for every active controller/hand to push pose
   matrices and button state into WebXR-facing objects.

`XRDevice` now invokes the built-in head pose and WebRTC streaming modules inline – no
registration step is required. You can swap those modules or disable them entirely by
calling the new helper methods outlined below.

## Inline update modules

- **Portal pose camera controller** – handles keyboard navigation + WASM nudge logic for
  the virtual headset. Enabled by default via `xrDevice.enablePortalPoseCamera()`.
- **WebRTC controller streamer** – mirrors controller telemetry from the SIGCF signaling
  service into the emulator for diagnostics. Automatically enabled when the Web page is
  allowed to use WebRTC (configurable through globals and query parameters).

Both modules lazily initialize on first frame and can be reconfigured at runtime.

### Configuring the head pose controller

```ts
import { XRDevice, metaQuest3 } from 'iwer';

const xrDevice = new XRDevice(metaQuest3);
xrDevice.installRuntime();

// Use different movement speed + pitch defaults.
xrDevice.enablePortalPoseCamera({
  speedMetersPerSecond: 2.0,
  cameraPitchDegrees: 30,
});

// `disablePortalPoseCamera()` removes the keyboard listener if you provide your own data.
```

`PortalPoseCameraController` lives in `src/head/PortalPoseCameraController.ts` if you need
to fork the implementation. The controller consumes WASM helpers to smooth and blend head
poses while respecting the existing DevUI offsets.

### Configuring WebRTC controller streaming

```ts
// Leave defaults in place or override the worker / room details.
xrDevice.enableWebRTCControllerStreaming({
  workerUrl: 'wss://custom-signal.example.com',
  roomId: 'my-room',
});

// When you want to silence the streamer entirely:
xrDevice.disableWebRTCControllerStreaming();
```

You can also control the default behaviour with globals (for example, set
`window.__IWER_DISABLE_WEBRTC_STREAM__ = true` before constructing the device) or URL
search parameters (`?iwerWebRTC=0`).

### Writing your own pipelines

If you prefer to source pose data directly from another system:

1. Call `xrDevice.disablePortalPoseCamera()` to turn off the keyboard-driven head pose.
2. Update `xrDevice.position`/`xrDevice.quaternion` within your own loop or by subclassing
   `XRDevice` and overriding `onFrameStart`.
3. Iterate `xrDevice.activeInputs` and write to each `XRTrackedInput` before calling
   `activeInput.onFrameStart(frame)`.

The inline modules keep the emulator working out of the box, while still allowing you to
replace portions with custom logic where needed.

## Recommended hacking loop

1. `npm run build` (root) and `npm run build` (devui/) after code changes.
2. `cd example && npm run serve` to bundle against the local sources.
3. Load `http://localhost:8080`, open DevTools, and verify the inline controller/wrtc logs.

With the inline modules in place, you can iterate purely on pose/button logic while the
emulator continues to satisfy the rest of the WebXR Device API contracts.
