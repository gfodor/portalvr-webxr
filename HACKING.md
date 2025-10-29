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

Adding a hook layer around those methods lets you swap in your own values right before
the runtime exposes them to applications.

## Hook API

The runtime now exposes an optional `installHooks` entrypoint on `XRDevice`. You can
register callbacks to mutate head pose, controller pose, and controller button state:

```ts
import { XRController, XRDevice, XRTrackedInput, metaQuest3 } from 'iwer';

const device = new XRDevice(metaQuest3);
device.installRuntime();

type MyPose = {
  position: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
};

function applyPose(target: XRTrackedInput, pose: MyPose) {
  target.position.set(pose.position.x, pose.position.y, pose.position.z);
  target.quaternion.set(
    pose.orientation.x,
    pose.orientation.y,
    pose.orientation.z,
    pose.orientation.w,
  );
}

device.installHooks({
  onHeadPose(device, frame) {
    // Copy your external pose into the runtime before the frame is processed
    const pose = externalDriver.getHeadPose(frame.predictedDisplayTime);
    device.position.set(pose.position.x, pose.position.y, pose.position.z);
    device.quaternion.set(
      pose.orientation.x,
      pose.orientation.y,
      pose.orientation.z,
      pose.orientation.w,
    );
  },
  onControllerPose(input, frame) {
    if (input.inputSource.handedness === 'left') {
      applyPose(input, externalDriver.getControllerPose('left', frame.predictedDisplayTime));
    } else if (input.inputSource.handedness === 'right') {
      applyPose(input, externalDriver.getControllerPose('right', frame.predictedDisplayTime));
    }
  },
  onControllerButtons(input, frame) {
    const buttons = externalDriver.getControllerButtons(input.inputSource.handedness);
    Object.entries(buttons).forEach(([id, value]) => {
      input instanceof XRController && input.updateButtonValue(id, value);
    });
  },
});
```

Each hook fires once per frame, immediately before the runtime mirrors the data into
WebXR reference spaces and `XRInputSource.gamepad` structures. If you do not register a
hook, the emulator keeps using the stock DevUI inputs.

### Head pose hook

**Location:** `XRDevice.invokeHeadPoseHook` (called inside `onFrameStart`).  
**Responsibilities:** Write to `device.position` and `device.quaternion`, adjust IPD/FOV
if needed, or forward camera control commands. Runs once per frame.

### Controller pose hook

**Location:** `XRDevice.invokeControllerPoseHook`.  
**Responsibilities:** Update each `XRTrackedInput.position` and `.quaternion`. The runtime
copies those into the target ray and grip `XRSpace` offsets automatically.

### Controller button hook

**Location:** `XRDevice.invokeControllerButtonsHook`.  
**Responsibilities:** Push button/axis state via the existing helpers (`updateButtonValue`,
`updateButtonTouch`, `updateAxes`). `XRTrackedInput.onFrameStart` will fire WebXR events
for edge transitions (e.g. `selectstart`, `selectend`).

## Logging Stubs

Each hook currently emits a debug log (`[IWER hook] ... stub invoked`). This keeps the
default behaviour intact while giving you confirmation that the hook point fired. Replace
those logs with your actual integration logic once you start injecting real data.

## Recommended Hacking Loop

1. `npm run build` (root) and `npm run build` (devui/) after code changes.
2. `cd example && npm run serve` to bundle against the local sources.
3. Load `http://localhost:8080`, open DevTools, and ensure the hook logs appear each
   frame. Wire your custom pipeline in place of the stub bodies.

With the hooks wired up, you can iterate purely on pose/button logic while the emulator
continues to satisfy the rest of the WebXR Device API contracts.
