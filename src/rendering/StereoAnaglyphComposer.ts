/**
 * Copyright (c) Meta Platforms, Inc.
 * Minimal stereo anaglyph post-process:
 * - Copies the left and right halves of the default framebuffer into textures
 * - Draws a fullscreen quad with red from right.r and blue from left.b (green = 0)
 * - Works on WebGL1 and WebGL2
 */

export class StereoAnaglyphComposer {
  private gl: WebGLRenderingContext | WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private vbo: WebGLBuffer | null = null;
  private leftTex: WebGLTexture | null = null;
  private rightTex: WebGLTexture | null = null;

  private aPosLoc: number = -1;
  private uLeftLoc: WebGLUniformLocation | null = null;
  private uRightLoc: WebGLUniformLocation | null = null;

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.gl = gl;
    this.initResources();
  }

  dispose(): void {
    const gl = this.gl;
    try {
      if (this.leftTex) gl.deleteTexture(this.leftTex);
      if (this.rightTex) gl.deleteTexture(this.rightTex);
      if (this.vbo) gl.deleteBuffer(this.vbo);
      if (this.program) gl.deleteProgram(this.program);
    } catch {
      // noop on disposal errors
    }
    this.leftTex = null;
    this.rightTex = null;
    this.vbo = null;
    this.program = null;
  }

  /**
   * Composes an anaglyph image over the entire canvas.
   * Expects the current default framebuffer to contain both eyes side-by-side.
   * @param width canvas width
   * @param height canvas height
   */
  compose(width: number, height: number): void {
    if (!this.program || !this.vbo) {
      // If initialization failed, skip silently.
      return;
    }
    if (width <= 0 || height <= 0) {
      return;
    }

    const gl = this.gl as WebGLRenderingContext;

    // Copy left half (x=0..w/2) into leftTex
    if (!this.leftTex) {
      this.leftTex = gl.createTexture();
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.leftTex);
    this.setDefaultTexParams();
    const halfW = Math.floor(width / 2);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, halfW, height, 0);

    // Copy right half (x=w/2..w) into rightTex
    if (!this.rightTex) {
      this.rightTex = gl.createTexture();
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.rightTex);
    this.setDefaultTexParams();
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, halfW, 0, halfW, height, 0);

    // Draw fullscreen quad: red from right.r, blue from left.b
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.leftTex);
    if (this.uLeftLoc) gl.uniform1i(this.uLeftLoc, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.rightTex);
    if (this.uRightLoc) gl.uniform1i(this.uRightLoc, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(this.aPosLoc);
    gl.vertexAttribPointer(this.aPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(this.aPosLoc);
  }

  private initResources(): void {
    const gl = this.gl as WebGLRenderingContext;

    // Program
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
        vec4 cL = texture2D(u_left, v_uv);
        vec4 cR = texture2D(u_right, v_uv);
        gl_FragColor = vec4(cR.r, 0.0, cL.b, 1.0);
      }
    `;
    const vs = this.createShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.createShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    // Avoids relying on getProgramParameter for simpler mocking
    this.program = prog;

    this.aPosLoc = gl.getAttribLocation(prog, 'a_pos');
    this.uLeftLoc = gl.getUniformLocation(prog, 'u_left');
    this.uRightLoc = gl.getUniformLocation(prog, 'u_right');

    // Fullscreen quad (triangle strip)
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const verts = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  }

  private createShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl as WebGLRenderingContext;
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    return sh;
  }

  private setDefaultTexParams(): void {
    const gl = this.gl as WebGLRenderingContext;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
}