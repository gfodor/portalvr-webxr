# Anaglyph Rendering Plan

## High-Level Strategy
- Capture the app’s per-eye output into off-screen textures each frame while leaving the existing `XRWebGLLayer`/app rendering path untouched.
- Run a single fullscreen post-process that uses DuBois color matrices to combine the eye buffers and write the anaglyph result back to the default framebuffer.
- Gate the compositor behind a new `XRDevice` option so inline sessions or monoscopic stereo paths behave exactly as they do today.
- Surface runtime controls (mode, eye swap, gamma/focal offsets) so developers can tune leakage without rebuilding the emulator.

## Implementation Steps
- Audit the current viewport/canvas flow: `getViewport` in `src/device/XRDevice.ts:496` and the frame-loop hook in `src/session/XRSession.ts:184` show where to intercept rendering for stereo sessions.
- Add `src/rendering/AnaglyphComposer.ts` that owns GL resources (FBOs, textures, VAO, shaders) plus configuration (`mode`, `swapEyes`, `fullscreenBlend`, `focalOffset`), exposing `ensureSize`, `captureEye`, and `compose`.
- Instantiate the composer from `XRDevice.onBaseLayerSet` (`src/device/XRDevice.ts:539`), watch canvas resizes, and have `XRWebGLLayer` hand the composer’s framebuffer to apps only when anaglyph mode is enabled.
- During per-eye rendering either:
  - Bind the composer’s FBO before each eye draw (`captureEye` returns a framebuffer) **or**
  - Render into the default framebuffer then copy the finished viewport into the composer textures. Document the chosen path and why it preserves existing app assumptions.
- After animation callbacks run in `XRSession.[P_SESSION].onDeviceFrame` (`src/session/XRSession.ts:338-351`), call `composer.compose(frameTime)` to execute the fullscreen pass, then restore any GL state the app might rely on (viewport, framebuffer bindings, depth test, etc.).
- Extend `XRDeviceOptions` (`src/device/XRDevice.ts:442`) and dev tooling to toggle anaglyph, choose color matrices, compute a normalized `focal_offset` from IPD/canvas dimensions, and persist settings across sessions.

## Shader Notes
- Port the reference GLSL 450 code to WebGL2: remove `layout` qualifiers, replace UBO with standard uniforms, and provide DuBois matrices and gamma values from JS.
- Keep linear ↔ sRGB conversions so channel mixing happens in linear space; expose booleans to bypass conversions if the source app already renders in linear color space.
- Allocate left/right color textures as `RGBA8` with `LINEAR` filtering; recreate them when `ensureSize` detects canvas dimension changes or when MSAA targets must be resolved.
- Implement mode switching for red/cyan, amber/blue, and green/magenta via uniform matrix sets; honor the swap-eyes flag (the sample’s `flags & 2u`) to debug ghosting.
- Treat `fullscreen_blend` and `focal_offset` as uniforms, defaulting to `1.0` and `(0, 0)` while allowing runtime overrides for calibration.

## GLSL Pseudocode (Fragment Shader)
```glsl
#version 300 es
precision highp float;

uniform sampler2D uLeftEye;
uniform sampler2D uRightEye;

// 0 = off, 1 = red/cyan, 2 = amber/blue, 3 = green/magenta
uniform int uMode;
uniform bool uSwapEyes;
uniform float uFullscreenBlend; // 0..1
uniform vec2 uFocalOffset;      // normalized offset to apply to right eye sample

// DuBois matrices packed as mat3 arrays (rows = output channels, columns = RGB input)
uniform mat3 uLeftMatrix;
uniform mat3 uRightMatrix;

// Precomputed inverse gamma for RC to lessen leakage (optional)
uniform vec3 uInverseGamma; // e.g. vec3(1.0/1.6, 1.0/0.8, 1.0)
uniform bool uUseInverseGamma;

vec3 toLinear(vec3 c) {
  bvec3 cutoff = lessThan(c, vec3(0.04045));
  vec3 higher = pow((c + 0.055) / 1.055, vec3(2.4));
  vec3 lower = c / 12.92;
  return mix(higher, lower, cutoff);
}

vec3 fromLinear(vec3 c) {
  bvec3 cutoff = lessThan(c, vec3(0.0031308));
  vec3 higher = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  vec3 lower = 12.92 * c;
  return mix(higher, lower, cutoff);
}

void main() {
  if (uMode == 0) {
    gl_FragColor = texture(uLeftEye, gl_FragCoord.xy / uResolution);
    return;
  }

  vec2 uv = gl_FragCoord.xy / uResolution;

  // Optional vignette / fullscreen blend
  if (uFullscreenBlend < 1.0) {
    float radius = mix(0.5, 0.8, clamp((uFullscreenBlend - 0.8) / 0.2, 0.0, 1.0));
    if (distance(uv, vec2(0.5)) > radius) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
  }

  vec2 leftUV = uv;
  vec2 rightUV = uv - uFocalOffset;
  vec3 leftColor = texture(uLeftEye, leftUV).rgb;
  vec3 rightColor = texture(uRightEye, rightUV).rgb;

  if (uUseInverseGamma) {
    leftColor = pow(leftColor, uInverseGamma);
    rightColor = pow(rightColor, uInverseGamma);
  }

  leftColor = toLinear(leftColor);
  rightColor = toLinear(rightColor);

  if (uSwapEyes) {
    vec3 tmp = leftColor;
    leftColor = rightColor;
    rightColor = tmp;
  }

  vec3 mixedLeft = uLeftMatrix * leftColor;
  vec3 mixedRight = uRightMatrix * rightColor;
  vec3 finalColor = mixedLeft + mixedRight;

  gl_FragColor = vec4(fromLinear(finalColor), 1.0);
}
```

### DuBois Matrix Constants (for JS setup)
- Red/Cyan (optimized for anaglyph glasses):
  - Left: `mat3(vec3(0.437, 0.449, 0.164), vec3(-0.062, -0.062, -0.024), vec3(-0.048, -0.050, -0.017))`
  - Right: `mat3(vec3(-0.0434706, -0.0879388, -0.00155529), vec3(0.378476, 0.73364, -0.0184503), vec3(-0.0721527, -0.112961, 1.2264))`
- Amber/Blue:
  - Left: `mat3(vec3(1.062, -0.205, 0.299), vec3(-0.026, 0.908, 0.068), vec3(-0.038, -0.173, 0.022))`
  - Right: `mat3(vec3(-0.016, -0.123, -0.017), vec3(0.006, 0.062, -0.017), vec3(0.094, 0.185, 0.991))`
- Green/Magenta:
  - Left: `mat3(vec3(0.5290, 0.7050, 0.0240), vec3(-0.0160, -0.0150, -0.0650), vec3(0.0090, 0.0750, 0.9370))`
  - Right: `mat3(vec3(-0.0565, -0.1488, -0.0370), vec3(0.2587, 0.6293, 0.1356), vec3(-0.0137, -0.0254, 0.0199))`

These values match the reference shader and should be uploaded per mode switch.
