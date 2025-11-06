/**
 * Stereo compositor that combines offscreen left/right eye textures into a single
 * green–magenta anaglyph image and draws it to the default framebuffer.
 */

type ComposeParams = {
  leftTexture: WebGLTexture;
  rightTexture: WebGLTexture;
  outputFramebuffer: WebGLFramebuffer | null;
  outputWidth: number;
  outputHeight: number;
  focalOffset: number;
};

const VERT_SRC = `#version 300 es
layout (location = 0) in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
layout (location = 0) out vec4 outColor;
uniform sampler2D u_left;
uniform sampler2D u_right;
uniform float u_focalOffset;

vec3 toLinear(vec3 sRGB) {
  bvec3 cutoff = lessThan(sRGB, vec3(0.04045));
  vec3 higher = pow((sRGB + vec3(0.055)) / vec3(1.055), vec3(2.4));
  vec3 lower = sRGB / vec3(12.92);
  return mix(higher, lower, vec3(cutoff));
}

vec3 fromLinear(vec3 linearRGB) {
  bvec3 cutoff = lessThan(linearRGB, vec3(0.0031308));
  vec3 higher = vec3(1.055) * pow(linearRGB, vec3(1.0 / 2.4)) - vec3(0.055);
  vec3 lower = linearRGB * vec3(12.92);
  return mix(higher, lower, vec3(cutoff));
}

const vec3 L_R_GREEN_MAGENTA = vec3(0.5290, 0.7050, 0.0240);
const vec3 L_G_GREEN_MAGENTA = vec3(-0.0160, -0.0150, -0.0650);
const vec3 L_B_GREEN_MAGENTA = vec3(0.0090, 0.0750, 0.9370);

const vec3 R_R_GREEN_MAGENTA = vec3(-0.0565, -0.1488, -0.0370);
const vec3 R_G_GREEN_MAGENTA = vec3(0.2587, 0.6293, 0.1356);
const vec3 R_B_GREEN_MAGENTA = vec3(-0.0137, -0.0254, 0.0199);

void main() {
  vec2 rightUv = v_uv - vec2(u_focalOffset, 0.0);
  vec3 leftColor = toLinear(texture(u_left, v_uv).rgb);
  vec3 rightColor = toLinear(texture(u_right, rightUv).rgb);

  vec3 c_left = vec3(
    dot(L_R_GREEN_MAGENTA, leftColor),
    dot(L_G_GREEN_MAGENTA, leftColor),
    dot(L_B_GREEN_MAGENTA, leftColor)
  );

  vec3 c_right = vec3(
    dot(R_R_GREEN_MAGENTA, rightColor),
    dot(R_G_GREEN_MAGENTA, rightColor),
    dot(R_B_GREEN_MAGENTA, rightColor)
  );

  vec3 color = fromLinear(c_left + c_right);
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

export class StereoCompositePass {
  private readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private uLeftLoc: WebGLUniformLocation | null = null;
  private uRightLoc: WebGLUniformLocation | null = null;
  private uFocalOffsetLoc: WebGLUniformLocation | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.initProgram();
  }

  dispose() {
    const gl = this.gl;
    try {
      if (this.vbo) gl.deleteBuffer(this.vbo);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.program) gl.deleteProgram(this.program);
    } catch (error) {
      console.warn('[StereoCompositePass] dispose failed', error);
    }
    this.vbo = null;
    this.vao = null;
    this.program = null;
    this.uLeftLoc = null;
  }

  compose(params: ComposeParams) {
    if (!this.program || !this.vao || !this.uLeftLoc) {
      return;
    }

    const {
      leftTexture,
      rightTexture,
      outputFramebuffer,
      outputWidth,
      outputHeight,
      focalOffset,
    } = params;
    if (!leftTexture || !rightTexture || outputWidth <= 0 || outputHeight <= 0) {
      return;
    }

    const gl = this.gl;

    // ---- Snapshot state we will touch ----
    // Programs & viewport
    const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;

    // Textures & active unit
    const prevActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    gl.activeTexture(gl.TEXTURE0);
    const prevTex0 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    gl.activeTexture(gl.TEXTURE1);
    const prevTex1 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;

    // Vertex array binding (VAO)
    const prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;

    // Framebuffers (READ & DRAW separately in WebGL2)
    const prevDrawFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const prevReadFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;

    // Enables
    const depthTestEnabled = gl.isEnabled(gl.DEPTH_TEST);
    const blendEnabled = gl.isEnabled(gl.BLEND);
    const cullEnabled = gl.isEnabled(gl.CULL_FACE);
    const scissorEnabled = gl.isEnabled(gl.SCISSOR_TEST);

    // Masks
    const prevColorMask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];

    // Blend function/equation/color (these can be mutated by libraries)
    const prevBlendSrcRGB   = gl.getParameter(gl.BLEND_SRC_RGB) as number;
    const prevBlendDstRGB   = gl.getParameter(gl.BLEND_DST_RGB) as number;
    const prevBlendSrcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA) as number;
    const prevBlendDstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA) as number;
    const prevBlendEqRGB    = gl.getParameter(gl.BLEND_EQUATION_RGB) as number;
    const prevBlendEqAlpha  = gl.getParameter(gl.BLEND_EQUATION_ALPHA) as number;
    const prevBlendColor    = gl.getParameter(gl.BLEND_COLOR) as Float32Array;

    // Scissor box (in case the engine had set a tight box)
    const prevScissorBox = gl.getParameter(gl.SCISSOR_BOX) as Int32Array;

    // ---- Set state for fullscreen composite ----
    // Bind only DRAW framebuffer so READ stays untouched
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, outputFramebuffer);
    gl.viewport(0, 0, outputWidth, outputHeight);

    if (depthTestEnabled) gl.disable(gl.DEPTH_TEST);
    if (blendEnabled)     gl.disable(gl.BLEND);
    if (cullEnabled)      gl.disable(gl.CULL_FACE);

    // Disable scissor to ensure full-screen draw, regardless of prior engine scissor
    if (scissorEnabled) gl.disable(gl.SCISSOR_TEST);

    gl.colorMask(true, true, true, true);

    gl.useProgram(this.program);

    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, leftTexture);
    gl.uniform1i(this.uLeftLoc, 0);

    if (this.uRightLoc) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, rightTexture);
      gl.uniform1i(this.uRightLoc, 1);
    }
    if (this.uFocalOffsetLoc) {
      gl.uniform1f(this.uFocalOffsetLoc, focalOffset);
    }

    // Draw fullscreen triangle using compositor VAO
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- Restore previous state (inverse order is a reasonable heuristic) ----
    // Restore VAO binding
    gl.bindVertexArray(prevVAO);

    // Restore masks & toggles
    gl.colorMask(prevColorMask[0], prevColorMask[1], prevColorMask[2], prevColorMask[3]);

    // Restore scissor state & box
    gl.scissor(prevScissorBox[0], prevScissorBox[1], prevScissorBox[2], prevScissorBox[3]);
    if (scissorEnabled) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);

    // Restore blend func/equation/color and toggle
    gl.blendFuncSeparate(prevBlendSrcRGB, prevBlendDstRGB, prevBlendSrcAlpha, prevBlendDstAlpha);
    gl.blendEquationSeparate(prevBlendEqRGB, prevBlendEqAlpha);
    gl.blendColor(prevBlendColor[0], prevBlendColor[1], prevBlendColor[2], prevBlendColor[3]);
    if (blendEnabled) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);

    // Restore cull/depth toggles
    if (cullEnabled) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
    if (depthTestEnabled) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);

    // Restore textures & active texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prevTex1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prevTex0);
    gl.activeTexture(prevActiveTexture);

    // Restore program & viewport
    gl.useProgram(prevProgram);
    gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);

    // Restore READ/DRAW FBOs exactly as they were
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevDrawFramebuffer);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevReadFramebuffer);
  }

  private initProgram() {
    const gl = this.gl;
    const program = gl.createProgram();
    if (!program) {
      console.warn('[StereoCompositePass] Failed to create program');
      return;
    }

    const vs = this.createShader(gl.VERTEX_SHADER, VERT_SRC);
    const fs = this.createShader(gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) {
      gl.deleteProgram(program);
      return;
    }

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[StereoCompositePass] Program link failed', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return;
    }

    this.program = program;
    this.uLeftLoc = gl.getUniformLocation(program, 'u_left');
    this.uRightLoc = gl.getUniformLocation(program, 'u_right');
    this.uFocalOffsetLoc = gl.getUniformLocation(program, 'u_focalOffset');

    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();

    if (!this.vao || !this.vbo) {
      console.warn('[StereoCompositePass] Failed to allocate buffers');
      return;
    }

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const verts = new Float32Array([
      -1, -1,
       3, -1,
      -1,  3,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);
  }

  private createShader(type: GLenum, source: string): WebGLShader | null {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) {
      console.warn('[StereoCompositePass] Failed to create shader');
      return null;
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('[StereoCompositePass] Shader compile failed', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
}
