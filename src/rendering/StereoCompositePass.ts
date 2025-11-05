export type StereoCompositeParams = {
  leftTexture: WebGLTexture;
  rightTexture: WebGLTexture;
  outputFramebuffer: WebGLFramebuffer | null;
  outputWidth: number;
  outputHeight: number;
};

export class StereoCompositePass {
  private readonly gl: WebGLRenderingContext | WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private vbo: WebGLBuffer | null = null;
  private aPosLoc = -1;
  private uLeftLoc: WebGLUniformLocation | null = null;
  private uRightLoc: WebGLUniformLocation | null = null;

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.gl = gl;
    this.initProgram();
  }

  dispose(): void {
    const gl = this.gl;
    try {
      if (this.vbo) gl.deleteBuffer(this.vbo);
      if (this.program) gl.deleteProgram(this.program);
    } catch {
      // ignore disposal failures
    }
    this.vbo = null;
    this.program = null;
    this.uLeftLoc = null;
    this.uRightLoc = null;
    this.aPosLoc = -1;
  }

  compose(params: StereoCompositeParams): void {
    if (!this.program || !this.vbo || this.aPosLoc < 0) {
      return;
    }
    const {
      leftTexture,
      rightTexture,
      outputFramebuffer,
      outputWidth,
      outputHeight,
    } = params;
    if (!leftTexture || !rightTexture) {
      return;
    }
    if (outputWidth <= 0 || outputHeight <= 0) {
      return;
    }
    const gl = this.gl;
    const prevFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const prevArrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    const prevActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    gl.activeTexture(gl.TEXTURE0);
    const prevTex0 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    gl.activeTexture(gl.TEXTURE1);
    const prevTex1 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;

    const gl2 = this.gl as WebGL2RenderingContext;
    const hasVAO = typeof (gl as WebGLRenderingContext & { bindVertexArray?: unknown }).bindVertexArray === 'function';
    const prevVAO =
      hasVAO && gl2
        ? (gl2.getParameter(gl2.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null)
        : null;

    const depthEnabled = gl.isEnabled(gl.DEPTH_TEST);
    const blendEnabled = gl.isEnabled(gl.BLEND);
    const cullEnabled = gl.isEnabled(gl.CULL_FACE);
    const scissorEnabled = gl.isEnabled(gl.SCISSOR_TEST);
    const prevScissor = gl.getParameter(gl.SCISSOR_BOX) as Int32Array;
    const colorMask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];

    gl.activeTexture(gl.TEXTURE0);
    if (depthEnabled) gl.disable(gl.DEPTH_TEST);
    if (blendEnabled) gl.disable(gl.BLEND);
    if (cullEnabled) gl.disable(gl.CULL_FACE);
    if (scissorEnabled) gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    if (hasVAO && gl2) {
      gl2.bindVertexArray(null);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, outputFramebuffer);
    gl.viewport(0, 0, outputWidth, outputHeight);
    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, leftTexture);
    if (this.uLeftLoc) gl.uniform1i(this.uLeftLoc, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, rightTexture);
    if (this.uRightLoc) gl.uniform1i(this.uRightLoc, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(this.aPosLoc);
    gl.vertexAttribPointer(this.aPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(this.aPosLoc);

    if (hasVAO && gl2) {
      gl2.bindVertexArray(prevVAO);
    }
    if (depthEnabled) gl.enable(gl.DEPTH_TEST);
    if (blendEnabled) gl.enable(gl.BLEND);
    if (cullEnabled) gl.enable(gl.CULL_FACE);
    if (scissorEnabled) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(prevScissor[0], prevScissor[1], prevScissor[2], prevScissor[3]);
    }
    gl.colorMask(colorMask[0], colorMask[1], colorMask[2], colorMask[3]);

    gl.bindBuffer(gl.ARRAY_BUFFER, prevArrayBuffer);
    gl.useProgram(prevProgram);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prevTex1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prevTex0);
    gl.activeTexture(prevActiveTexture);

    gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFramebuffer);
  }

  private initProgram(): void {
    const gl = this.gl;
    const vsSource = `
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main() {
        v_uv = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;
    const fsSource = `
      precision mediump float;
      varying vec2 v_uv;
      uniform sampler2D u_left;
      uniform sampler2D u_right;
      void main() {
        vec4 leftColor = texture2D(u_left, v_uv);
        vec4 rightColor = texture2D(u_right, v_uv);
        gl_FragColor = vec4(rightColor.r, 0.0, leftColor.b, 1.0);
      }
    `;
    const vs = this.createShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.createShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) {
      return;
    }
    const program = gl.createProgram();
    if (!program) {
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    this.program = program;

    this.aPosLoc = gl.getAttribLocation(program, 'a_pos');
    this.uLeftLoc = gl.getUniformLocation(program, 'u_left');
    this.uRightLoc = gl.getUniformLocation(program, 'u_right');

    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const verts = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  private createShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) {
      return null;
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }
}
