# FBO_HIJACK: Minimal Stereo Framebuffer Hijacking Plan

## Objective
Enable the runtime to intercept (“hijack”) default framebuffer usage in immersive stereo sessions so each eye renders into its own off-screen framebuffer, and then composite those two eye textures back to the screen. The plan assumes no prior context; it rewinds to a stable baseline and then adds the minimum necessary steps to reach per-eye FBO hijacking.

## Prerequisites
- Working build of the WebXR emulator with stereo side-by-side rendering already functioning.
- Ability to run both bundled demos (`example/` and `hello-webxr/`) in immersive stereo mode to validate behavior.

## Step 1 – Return to a Known-Good Baseline (DONE)
1. Revert the stereo rendering pipeline to the previously working implementation that copies the left/right halves of the base-layer framebuffer into textures.
2. Remove any temporary console logging or diagnostic wrappers.
3. Verify both demos render correctly in stereo and mono modes.

## Step 2 – Observe Eye Rendering State (No Hijacking Yet) (DONE)
1. Wrap `gl.viewport` during immersive stereo sessions to record each viewport call.
2. Infer which eye is being rendered:
   - Left eye when `x ≈ 0` and width ≈ half the canvas.
   - Right eye when `x ≈ canvasWidth / 2` and width ≈ half the canvas.
3. Log the inferred eye per frame for both demos to confirm the viewport split assumptions hold.

## Step 3 – Intercept Default Framebuffer Binds Lazily
1. Wrap `gl.bindFramebuffer` once per immersive stereo context.
2. When the app calls `bindFramebuffer(FRAMEBUFFER, null)`:
   - Determine the current eye from the state tracked in Step 2.
   - Lazily allocate an off-screen framebuffer and color texture for that eye, mirroring relevant context attributes (color format, depth/stencil buffers).
   - Bind the eye’s framebuffer instead of the default.
3. If the app binds any other framebuffer, pass the call through unchanged.
4. Add minimal logging to confirm each eye FBO is created and bound.

## Step 4 – Validate Eye FBO Contents Before Changing Compositor
1. Keep the existing compositor (which copies from the base-layer framebuffer) untouched for now.
2. After the app finishes rendering an eye, temporarily call `gl.readPixels` on the hijacked framebuffer to ensure non-zero color data is present.
3. If readbacks show non-zero pixels, disable the readbacks and proceed; if not, debug the viewport or bind interception until pixels appear.

## Step 5 – Update the Stereo Compositor to Use Eye Textures Directly
1. Extend the compositor to accept two texture inputs (left/right) and render them in the final pass (initially shade them with obvious tints to confirm execution).
2. Replace the old “copy halves” step with direct usage of the hijacked eye textures.
3. Verify the compositor runs by observing the tint; then restore the intended fragment shader.

## Step 6 – Add Cleanup and Fallback Controls
1. Ensure hooks are installed only when:
   - The session is immersive.
   - Stereo mode is enabled.
2. Remove hooks and delete eye FBO resources when stereo ends or the session exits.
3. Provide a runtime toggle (e.g., feature flag or dev setting) to fall back to the legacy compositor path for quick regression isolation.

## Step 7 – Final Validation
1. Run both demos in stereo to confirm:
   - Each eye renders correctly (no black frames).
   - The final composite displays the expected imagery.
2. Run mono/inline sessions to ensure they bypass the hijacking code path.
3. Remove residual diagnostic logging and keep only guarded debug output for future troubleshooting.
