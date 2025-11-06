/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { P_DEVICE, P_SESSION, P_VIEW, P_WEBGL_LAYER } from '../private.js';

import { XRSession } from '../session/XRSession.js';
import { XREye, XRView } from '../views/XRView.js';

export class XRLayer extends EventTarget {}

type LayerInit = {
  antialias?: boolean;
  depth?: boolean;
  stencil?: boolean;
  alpha?: boolean;
  ignoreDepthValues?: boolean;
  framebufferScaleFactor?: number;
};

const defaultLayerInit: LayerInit = {
  antialias: true,
  depth: true,
  stencil: false,
  alpha: true,
  ignoreDepthValues: false,
  framebufferScaleFactor: 1.0,
};

export class XRWebGLLayer extends XRLayer {
  [P_WEBGL_LAYER]: {
    session: XRSession;
    context: WebGLRenderingContext | WebGL2RenderingContext;
    antialias: boolean;
    stereoTargets: StereoTargets | null;
  };

  private _layerInit: Required<LayerInit>;

  constructor(
    session: XRSession,
    context: WebGLRenderingContext | WebGL2RenderingContext,
    layerInit: LayerInit = {},
  ) {
    super();

    if (session[P_SESSION].ended) {
      throw new DOMException('Session has ended', 'InvalidStateError');
    }

    // TO-DO: Check that the context attribute has xrCompatible set to true
    // may require polyfilling the context and perhaps canvas.getContext

    // Default values for XRWebGLLayerInit, can be overridden by layerInit
    const config = { ...defaultLayerInit, ...layerInit };

    this[P_WEBGL_LAYER] = {
      session,
      context,
      antialias: config.antialias!,
      stereoTargets: null,
    };

    this._layerInit = config as Required<LayerInit>;
  }

  get context() {
    return this[P_WEBGL_LAYER].context;
  }

  get antialias() {
    return this[P_WEBGL_LAYER].antialias;
  }

  get ignoreDepthValues() {
    return true;
  }

  get framebuffer() {
    return this[P_WEBGL_LAYER].stereoTargets?.framebuffer ?? null;
  }

  get framebufferWidth() {
    return (
      this[P_WEBGL_LAYER].stereoTargets?.width ??
      this[P_WEBGL_LAYER].context.drawingBufferWidth
    );
  }

  get framebufferHeight() {
    return (
      this[P_WEBGL_LAYER].stereoTargets?.height ??
      this[P_WEBGL_LAYER].context.drawingBufferHeight
    );
  }

  getViewport(view: XRView) {
    if (view[P_VIEW].session !== this[P_WEBGL_LAYER].session) {
      throw new DOMException(
        "View's session differs from Layer's session",
        'InvalidStateError',
      );
    }
    // TO-DO: check frame
    return this[P_WEBGL_LAYER].session[P_SESSION].device[P_DEVICE].getViewport(
      this,
      view,
    );
  }

  static getNativeFramebufferScaleFactor(session: XRSession): number {
    if (!(session instanceof XRSession)) {
      throw new TypeError(
        'getNativeFramebufferScaleFactor must be passed a session.',
      );
    }

    if (session[P_SESSION].ended) {
      return 0.0;
    }

    // Return 1.0 for simplicity, actual implementation might vary based on the device capabilities
    return 1.0;
  }

  getStereoTargets(): StereoTargets | null {
    return this[P_WEBGL_LAYER].stereoTargets;
  }

  ensureStereoTargets(width: number, height: number): boolean {
    const gl = this[P_WEBGL_LAYER].context;
    const targets = this[P_WEBGL_LAYER].stereoTargets;
    if (
      targets &&
      targets.width === width &&
      targets.height === height &&
      targets.eyeWidth === Math.max(1, Math.floor(width / 2))
    ) {
      return true;
    }

    this.disposeStereoTargets();

    const framebuffer = gl.createFramebuffer();
    const renderTexture = gl.createTexture();
    const leftTexture = gl.createTexture();
    const rightTexture = gl.createTexture();
    if (!framebuffer || !renderTexture || !leftTexture || !rightTexture) {
      this.disposeStereoTargets();
      return false;
    }

    const prevFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const prevActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
    gl.activeTexture(gl.TEXTURE0);
    const prevTex0 = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const prevRenderbuffer = gl.getParameter(gl.RENDERBUFFER_BINDING);

    const halfWidth = Math.max(1, Math.floor(width / 2));

    const initializeTexture = (texture: WebGLTexture, texWidth: number) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        texWidth,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
    };

    initializeTexture(renderTexture, width);
    initializeTexture(leftTexture, halfWidth);
    initializeTexture(rightTexture, halfWidth);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      renderTexture,
      0,
    );

    let depthRenderbuffer: WebGLRenderbuffer | null = null;
    if (this._layerInit.depth) {
      depthRenderbuffer = gl.createRenderbuffer();
      if (depthRenderbuffer) {
        gl.bindRenderbuffer(gl.RENDERBUFFER, depthRenderbuffer);
        const isWebGL2 =
          typeof WebGL2RenderingContext !== 'undefined' &&
          gl instanceof WebGL2RenderingContext;

        let attachment = gl.DEPTH_ATTACHMENT;
        let depthFormat: number = isWebGL2 ? gl.DEPTH_COMPONENT24 : gl.DEPTH_COMPONENT16;

        if (this._layerInit.stencil) {
          if (isWebGL2) {
            depthFormat = gl.DEPTH24_STENCIL8;
            attachment = gl.DEPTH_STENCIL_ATTACHMENT;
          } else {
            const depthStencilExt =
              gl.getExtension('WEBGL_depth_texture') ||
              gl.getExtension('WEBKIT_WEBGL_depth_texture') ||
              gl.getExtension('MOZ_WEBGL_depth_texture');
            if (depthStencilExt) {
              depthFormat = gl.DEPTH_STENCIL;
              attachment = gl.DEPTH_STENCIL_ATTACHMENT;
            } else {
              console.warn(
                '[XRWebGLLayer] Stencil buffer requested but WEBGL_depth_texture is unavailable; disabling stencil attachment.',
              );
              gl.deleteRenderbuffer(depthRenderbuffer);
              depthRenderbuffer = null;
            }
          }
        }

        if (depthRenderbuffer) {
          gl.renderbufferStorage(gl.RENDERBUFFER, depthFormat, width, height);
          gl.framebufferRenderbuffer(
            gl.FRAMEBUFFER,
            attachment,
            gl.RENDERBUFFER,
            depthRenderbuffer,
          );
        }
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFramebuffer);
    gl.bindTexture(gl.TEXTURE_2D, prevTex0);
    gl.bindRenderbuffer(gl.RENDERBUFFER, prevRenderbuffer);
    gl.activeTexture(prevActiveTexture);

    this[P_WEBGL_LAYER].stereoTargets = {
      framebuffer,
      renderTexture,
      leftTexture,
      rightTexture,
      depthRenderbuffer,
      width,
      eyeWidth: halfWidth,
      height,
    };

    return true;
  }

  disposeStereoTargets() {
    const gl = this[P_WEBGL_LAYER].context;
    const targets = this[P_WEBGL_LAYER].stereoTargets;
    if (!targets) {
      return;
    }
    try {
      if (targets.framebuffer) {
        gl.deleteFramebuffer(targets.framebuffer);
      }
      if (targets.renderTexture) {
        gl.deleteTexture(targets.renderTexture);
      }
      if (targets.leftTexture) {
        gl.deleteTexture(targets.leftTexture);
      }
      if (targets.rightTexture) {
        gl.deleteTexture(targets.rightTexture);
      }
      if (targets.depthRenderbuffer) {
        gl.deleteRenderbuffer(targets.depthRenderbuffer);
      }
    } catch (error) {
      console.warn('[XRWebGLLayer] Failed to dispose stereo targets', error);
    }

    this[P_WEBGL_LAYER].stereoTargets = null;
  }

  bindFramebufferForEye(_: XREye) {}

  copyStereoTargets() {
    const targets = this[P_WEBGL_LAYER].stereoTargets;
    if (!targets) {
      return;
    }

    const gl = this[P_WEBGL_LAYER].context;
    if (!(gl instanceof WebGL2RenderingContext)) {
      console.warn('[XRWebGLLayer] copyStereoTargets requires WebGL2');
      return;
    }

    const prevActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    const prevFramebufferDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const prevFramebufferRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const prevReadBuffer = gl.getParameter(gl.READ_BUFFER) as number;

    const prevTex0 = (() => {
      gl.activeTexture(gl.TEXTURE0);
      return gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    })();
    const prevTex1 = (() => {
      gl.activeTexture(gl.TEXTURE1);
      return gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    })();

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, targets.framebuffer);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);

    const halfWidth = targets.eyeWidth;
    const height = targets.height;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets.leftTexture);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, halfWidth, height);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, targets.rightTexture);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, halfWidth, 0, halfWidth, height);

    // Restore read framebuffer and its read buffer first, then restore draw framebuffer
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevFramebufferRead);
    gl.readBuffer(prevReadBuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevFramebufferDraw);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prevTex0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prevTex1);
    gl.activeTexture(prevActiveTexture);
  }
}

export type StereoTargets = {
  framebuffer: WebGLFramebuffer;
  renderTexture: WebGLTexture;
  leftTexture: WebGLTexture;
  rightTexture: WebGLTexture;
  depthRenderbuffer: WebGLRenderbuffer | null;
  width: number;
  eyeWidth: number;
  height: number;
};
