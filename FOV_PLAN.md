Driver FOV Handling Plan
========================

Current Observations
- Rendering pipeline rebuilds projection matrices each frame from `XRDevice.fovy`, but the wasm runtime still writes a fixed ±45° half-angle into its head pose buffer.
- The WebXR layer never changes viewports; the app canvas always fills the container, which already clips overflow and hosts other driver-controlled UI (devui/SEM canvases).
- Apps that cache their first projection (e.g. A-Frame) ignore later matrix updates, so changing `fovy` alone may not be sufficient.

Plan of Action
1. Extend the wasm → JS contract so the runtime exposes its instantaneous FOV instead of clamping to `DEFAULT_HALF_FOV_RAD` inside `PortalControllerRuntime.writeInputs`.
2. Plumb that value through `portalControllerRuntime.updateFrame(...)` to let the driver assign `xrDevice.fovy` before `XRSession` rebuilds the per-frame projection matrices.
3. Prototype a CSS zoom fallback: store the baseline FOV, compute `scale = tan(base/2) / tan(target/2)`, and apply a centered `transform` on the app canvas (and sibling devui/SEM surfaces) in `XRDevice.onFrameStart`.
4. Evaluate side effects (controller ray alignment, UI hotspots). If CSS zoom causes unacceptable aliasing:
   - 4a. Try a viewport crop + DOM scale approach (`XRDevice.getViewport`) while optionally increasing the app’s framebuffer scale factor.
   - 4b. If fidelity still suffers, design an off-screen framebuffer composite so the driver can resample the rendered image with custom UVs.
5. Document configuration knobs (enable true projection updates, enable visual zoom, zoom factor blending) so integrators can tune per engine.

Outstanding Questions / Risks
- How does the wasm runtime encode its dynamic FOV today, and can we read it without breaking other consumers?
- Should we keep app-level math unmodified (visual zoom only) or offer a mode that also feeds the reduced FOV back into interaction rays?
- When we scale the canvas, how do we keep devui/SEM overlays and potential pointer cursors in sync?
- Do we need a per-eye FOV (asymmetric) path, and if so, how do we represent that through the driver layer?
