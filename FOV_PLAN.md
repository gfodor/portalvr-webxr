Driver FOV Handling Plan
========================

Current Observations
- Apps that cache their first projection (e.g. A-Frame) ignore later matrix updates, so changing `fovy` alone may not be sufficient.

# Camera FOV Data Flow

This note traces how the Portal modules derive and publish the camera field of view (FoV) that the Android OpenXR driver ultimately writes into the runtime state. Each section highlights the exact entry points you can hook when you need to inspect or override the FoV during the per-frame update loop.

## Portal Controller Core

- The controller pose state owns the FoV fields (`camera_fov_deg`, plus mode-specific defaults) inside `struct portal_pose_state` (`src/portal/portal_controller_pose.c:311-315`).
- `portal_pose_state_zero` leaves these values at `0.0f`; callers must seed them every frame (same file, `src/portal/portal_controller_pose.c:789-815`).
- `portal_pose_state_set_fov_defaults` simply records the three mode defaults supplied by the host (head, stretch, aim) (`src/portal/portal_controller_pose.c:958-966`).
- During `portal_pose_update`, once the stretch/aim weights are resolved, the state blends the configured defaults and writes the result to `state->camera_fov_deg` (`src/portal/portal_controller_pose.c:1495-1505`). This is the authoritative “desired FoV” for the current controller frame.
- Consumers read the number via `portal_pose_state_get_camera_fov_deg`, which is just a thin accessor (`src/portal/portal_controller_pose.c:1001-1007`).

## WebAssembly Bindings

- The WASM shim surfaces the same APIs: you can set FoV defaults with `portal_wasm_set_fov_defaults(...)` and query the live value with `portal_wasm_get_camera_fov_deg(...)`, which forwards directly to the native accessor (`src/portal/portal_pose_wasm_api.c:87-117`).

## Practical Ways to Inspect the FoV

1. **Inside the controller loop:** capture `portal_pose_state_get_camera_fov_deg(state)` immediately after `portal_pose_update` runs; this is the raw blended FoV straight from the portal core.
4. **From WebAssembly hosts:** call `portal_wasm_get_camera_fov_deg(state)` to mirror the native behaviour without touching Android-specific code (`src/portal/portal_pose_wasm_api.c:113-117`).

Following this chain lets you reason about the FoV in any runtime: the controller core is the single source of truth.

- When the reported desired FOV from the controller core deviates from the app’s baseline FOV (the 90 degree default), we have two options:
  1. Update the app’s projection matrices directly (best quality, more invasive).
  2. Apply a visual zoom effect on the final canvas (less ideal, easier to implement).

Because we cannot count on the underlying engine to respect dynamic projection changes, we will pursue option 2.

Store the baseline FOV, compute `scale = tan(base/2) / tan(target/2)`, and apply a centered `transform` on the app canvas (and sibling devui/SEM surfaces) in `XRDevice.onFrameStart`.

