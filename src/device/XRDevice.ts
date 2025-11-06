/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { GlobalSpace, XRSpace } from '../spaces/XRSpace.js';
import {
  P_DEVICE,
  P_REF_SPACE,
  P_SESSION,
  P_SPACE,
  P_SYSTEM,
} from '../private.js';
import { Quaternion, Vector3 } from '../utils/Math.js';
import { XRController, XRControllerConfig } from './XRController.js';
import {
  XREnvironmentBlendMode,
  XRInteractionMode,
  XRSession,
  XRSessionMode,
  XRVisibilityState,
} from '../session/XRSession.js';
import { XREye, XRView } from '../views/XRView.js';
import { XRHandInput, oculusHandConfig } from './XRHandInput.js';
import {
  XRHandedness,
  XRInputSource,
  XRInputSourceArray,
} from '../input/XRInputSource.js';
import {
  XRLayer,
  XRWebGLLayer,
  type StereoTargets,
} from '../layers/XRWebGLLayer.js';
import { StereoCompositePass } from '../rendering/StereoCompositePass.js';
import {
  XRReferenceSpace,
  XRReferenceSpaceType,
} from '../spaces/XRReferenceSpace.js';
import { mat4, quat, vec3 } from 'gl-matrix';

import { VERSION } from '../version.js';
import { XRFrame } from '../frameloop/XRFrame.js';
import { XRHand } from '../input/XRHand.js';
import { XRInputSourceEvent } from '../events/XRInputSourceEvent.js';
import { XRInputSourcesChangeEvent } from '../events/XRInputSourcesChangeEvent.js';
import { XRJointPose } from '../pose/XRJointPose.js';
import { XRJointSpace } from '../spaces/XRJointSpace.js';
import { XRPose } from '../pose/XRPose.js';
import { XRReferenceSpaceEvent } from '../events/XRReferenceSpaceEvent.js';
import { XRRenderState } from '../session/XRRenderState.js';
import { XRRigidTransform } from '../primitives/XRRigidTransform.js';
import { XRSessionEvent } from '../events/XRSessionEvent.js';
import { XRSystem } from '../initialization/XRSystem.js';
import { XRTrackedInput } from './XRTrackedInput.js';
import { XRViewerPose } from '../pose/XRViewerPose.js';
import { XRViewport } from '../views/XRViewport.js';
import { NativePlane } from '../planes/XRPlane.js';
import { NativeMesh } from '../meshes/XRMesh.js';
// @ts-ignore
import WebXRLayerPolyfill from 'webxr-layers-polyfill';
import {
  PortalPoseCameraController,
  type PortalPoseCameraOptions,
} from '../head/PortalPoseCameraController.js';
import {
  FaceTracker,
  type FaceTrackerOutputs,
} from '../head/FaceTracker.js';
import {
  WebRTCControllerStreamer,
  type WebRTCControllerStreamOptions,
} from '../webrtc/WebRTCControllerStreamer.js';
import type { ControllerState } from '../webrtc/controllerParser.js';
import {
  PortalControllerRuntime,
  type PortalPose,
} from '../wasm/PortalControllerRuntime.js';
import {
  getPortalEmulatorConfig,
  onPortalEmulatorConfigChange,
  type PortalEmulatorConfig,
} from './PortalEmulatorConfig.js';
import { degreesToRadians } from '../wasm/PortalPoseLoader.js';
import { getPersistentPortalDeviceIdentity } from './PortalDeviceIdentity.js';
import { PortalDeviceQrOverlay } from './PortalDeviceQrOverlay.js';

export type WebXRFeature =
  | 'viewer'
  | 'local'
  | 'local-floor'
  | 'bounded-floor'
  | 'unbounded'
  | 'dom-overlay'
  | 'anchors'
  | 'plane-detection'
  | 'mesh-detection'
  | 'hit-test'
  | 'hand-tracking'
  | 'depth-sensing';

type ActiveWandState = 'none' | 'left' | 'right' | 'both';

function resolveActiveWandState(mode: number): ActiveWandState {
  switch (mode) {
    case 0: // BLE_WAND_RIGHT_PERSISTENT
    case 2: // BLE_WAND_RIGHT_EPHEMERAL
      return 'right';
    case 1: // BLE_WAND_LEFT_PERSISTENT
    case 3: // BLE_WAND_LEFT_EPHEMERAL
      return 'left';
    case 4: // BLE_WAND_DUAL_MIRRORED
    case 5: // BLE_WAND_DUAL_OPPOSED
      return 'both';
    default:
      return 'right';
  }
}

const SIGCF_PAIRING_BASE_URL = 'https://portalvr.io/controller';
const PORTAL_DEVICE_ID_PREFIX = 'PORTALVR-';

function buildPortalDeviceId(suffix: string): string {
  return `${PORTAL_DEVICE_ID_PREFIX}${suffix}`;
}

function buildSigcfPairingUrl(deviceId: string): string {
  const url = new URL(SIGCF_PAIRING_BASE_URL);
  url.searchParams.set('device_id', deviceId);
  url.searchParams.set('service_type', 'sigcf');
  return url.toString();
}

function getNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function clampAxis(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value > 1) return 1;
  if (value < -1) return -1;
  return value;
}

const MAX_FACE_TRACK_OFFSET_METERS = 0.35;
const FACE_TRACK_SMOOTHING_TAU_MS = 16;
const clampFaceOffset = (value: number): number =>
  Math.max(Math.min(value, MAX_FACE_TRACK_OFFSET_METERS), -MAX_FACE_TRACK_OFFSET_METERS);

const FACE_TRACKER_SMOOTH_DEFAULT = {
  minCutoff: 5,
  beta: 75,
  dCutoff: 5,
} as const;
const FACE_TRACKER_DISTANCE_BASE = 0.99;
const FACE_TRACKER_HFOV_DEG = 60;
const FACE_TRACKER_WASM_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const FACE_TRACKER_MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const FACE_TRACKING_RESOLUTIONS: Array<{ width: number; height: number }> = [
  { width: 320, height: 240 },
  { width: 640, height: 480 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];

const WEBRTC_VISIBILITY_SUSPEND_DELAY_MS = 5000;

function makeIdentityPortalPose(): PortalPose {
  return {
    position: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
}

const THUMBSTICK_TOUCH_EPSILON = 1e-3;

export interface XRDeviceConfig {
  name: string;
  controllerConfig: XRControllerConfig | undefined;
  supportedSessionModes: XRSessionMode[];
  supportedFeatures: WebXRFeature[];
  supportedFrameRates: number[];
  isSystemKeyboardSupported: boolean;
  internalNominalFrameRate: number;
  environmentBlendModes: Partial<{
    [sessionMode in XRSessionMode]: XREnvironmentBlendMode;
  }>;
  interactionMode: XRInteractionMode;
  userAgent: string;
}

export interface XRDeviceOptions {
  ipd: number;
  fovy: number;
  stereoEnabled: boolean;
  headsetPosition: Vector3;
  headsetQuaternion: Quaternion;
  canvasContainer: HTMLDivElement;
}

const FORCED_IPD_METERS = 0.0075;

const DEFAULTS = {
  ipd: FORCED_IPD_METERS,
  fovy: Math.PI / 2,
  headsetPosition: new Vector3(0, 1.6, 0),
  headsetQuaternion: new Quaternion(),
  stereoEnabled: false,
};

export interface DevUIConstructor {
  new (xrDevice: XRDevice): DevUI;
}
export interface DevUI {
  version: string;
  render(time: number): void;
  get devUICanvas(): HTMLCanvasElement;
  get devUIContainer(): HTMLDivElement;
}

export interface SEMConstructor {
  new (xrDevice: XRDevice): SyntheticEnvironmentModule;
}
export interface SyntheticEnvironmentModule {
  version: string;
  render(time: number): void;
  loadEnvironment(json: any): void;
  loadDefaultEnvironment(envId: string): void;
  planesVisible: boolean;
  boundingBoxesVisible: boolean;
  meshesVisible: boolean;
  get environmentCanvas(): HTMLCanvasElement;
  get trackedPlanes(): Set<NativePlane>;
  get trackedMeshes(): Set<NativeMesh>;
  computeHitTestResults(rayMatrix: mat4): mat4[];
}

interface RuntimeOptions {
  globalObject?: any;
  polyfillLayers?: boolean;
  enforce?: boolean;
}

const Z_INDEX_SEM_CANVAS = 1;
const Z_INDEX_APP_CANVAS = 2;
const Z_INDEX_DEVUI_CANVAS = 3;
const Z_INDEX_DEVUI_CONTAINER = 4;

function resolveDefaultWebRTCStreamOptions(): WebRTCControllerStreamOptions | null {
  if (typeof globalThis === 'undefined') return null;
  const globalAny = globalThis as Record<string, any>;
  const disableFlag =
    globalAny.__PORTALVR_DISABLE_WEBRTC_STREAM__ ??
    globalAny.__PORTALVR_DISABLE_WEBRTC_HOOKS__ ??
    globalAny.__IWER_DISABLE_WEBRTC_STREAM__ ??
    globalAny.__IWER_DISABLE_WEBRTC_HOOKS__;
  if (disableFlag) return null;
  if (typeof globalAny.window === 'undefined') return null;
  if (typeof globalAny.RTCPeerConnection !== 'function') return null;

  let enable = true;

  const legacyEnable =
    globalAny.__PORTALVR_ENABLE_WEBRTC_HOOKS__ ?? globalAny.__IWER_ENABLE_WEBRTC_HOOKS__;
  const explicitEnable =
    globalAny.__PORTALVR_ENABLE_WEBRTC_STREAM__ ??
    globalAny.__IWER_ENABLE_WEBRTC_STREAM__ ??
    legacyEnable;
  if (explicitEnable === false) enable = false;
  if (explicitEnable === true) enable = true;

  let roomId: string | undefined =
    typeof globalAny.__PORTALVR_WEBRTC_ROOM__ === 'string'
      ? globalAny.__PORTALVR_WEBRTC_ROOM__
      : typeof globalAny.__IWER_WEBRTC_ROOM__ === 'string'
        ? globalAny.__IWER_WEBRTC_ROOM__
        : undefined;
  let workerUrl: string | undefined =
    typeof globalAny.__PORTALVR_WEBRTC_WORKER__ === 'string'
      ? globalAny.__PORTALVR_WEBRTC_WORKER__
      : typeof globalAny.__IWER_WEBRTC_WORKER__ === 'string'
        ? globalAny.__IWER_WEBRTC_WORKER__
        : undefined;
  let autoStart: boolean | undefined =
    typeof globalAny.__PORTALVR_WEBRTC_AUTOSTART__ === 'boolean'
      ? globalAny.__PORTALVR_WEBRTC_AUTOSTART__
      : typeof globalAny.__IWER_WEBRTC_AUTOSTART__ === 'boolean'
        ? globalAny.__IWER_WEBRTC_AUTOSTART__
        : undefined;
  const customLog =
    typeof globalAny.__PORTALVR_WEBRTC_LOG__ === 'function'
      ? (globalAny.__PORTALVR_WEBRTC_LOG__ as (m: string) => void)
      : typeof globalAny.__IWER_WEBRTC_LOG__ === 'function'
        ? (globalAny.__IWER_WEBRTC_LOG__ as (m: string) => void)
        : undefined;

  const search =
    typeof globalAny.location?.search === 'string'
      ? (globalAny.location.search as string)
      : '';

  if (search) {
    try {
      const params = new URLSearchParams(search);
      const runtimeToggleKey =
        params.has('portalvrWebRTC') && params.get('portalvrWebRTC') !== null
          ? 'portalvrWebRTC'
          : params.has('iwerWebRTC')
            ? 'iwerWebRTC'
            : null;
      if (runtimeToggleKey) {
        const val = params.get(runtimeToggleKey);
        if (val === '0' || val?.toLowerCase() === 'false') {
          enable = false;
        } else if (val && val.toLowerCase() !== '0') {
          enable = true;
        }
      }
      const roomKey =
        params.has('portalvrWebRTCRoom') && params.get('portalvrWebRTCRoom') !== null
          ? 'portalvrWebRTCRoom'
          : params.has('iwerWebRTCRoom')
            ? 'iwerWebRTCRoom'
            : null;
      if (roomKey) {
        const value = params.get(roomKey);
        roomId = value || undefined;
      }
      const workerKey =
        params.has('portalvrWebRTCWorker') && params.get('portalvrWebRTCWorker') !== null
          ? 'portalvrWebRTCWorker'
          : params.has('iwerWebRTCWorker')
            ? 'iwerWebRTCWorker'
            : null;
      if (workerKey) {
        const value = params.get(workerKey);
        workerUrl = value || undefined;
      }
      const autoStartKey =
        params.has('portalvrWebRTCAutoStart') && params.get('portalvrWebRTCAutoStart') !== null
          ? 'portalvrWebRTCAutoStart'
          : params.has('iwerWebRTCAutoStart')
            ? 'iwerWebRTCAutoStart'
            : null;
      if (autoStartKey) {
        const value = params.get(autoStartKey);
        if (value) {
          const normalized = value.toLowerCase();
          autoStart = !(normalized === '0' || normalized === 'false');
        }
      }
    } catch {
      // Ignore malformed search parameters; fall back to defaults.
    }
  }

  if (!enable) return null;

  const opts: WebRTCControllerStreamOptions = {};
  if (workerUrl) opts.workerUrl = workerUrl;
  if (roomId) opts.roomId = roomId;
  if (typeof autoStart === 'boolean') opts.autoStart = autoStart;
  if (customLog) opts.log = customLog;
  return opts;
}

/**
 * XRDevice is not a standard API class outlined in the WebXR Device API Specifications
 * Instead, it serves as an user-facing interface to control the emulated XR Device
 */
export class XRDevice {
  public readonly version = VERSION;

  [P_DEVICE]: {
    // device config
    name: string;
    supportedSessionModes: string[];
    supportedFeatures: string[];
    supportedFrameRates: number[];
    isSystemKeyboardSupported: boolean;
    internalNominalFrameRate: number;
    environmentBlendModes: Partial<{
      [sessionMode in XRSessionMode]: XREnvironmentBlendMode;
    }>;
    interactionMode: XRInteractionMode;
    userAgent: string;
    portalDeviceSuffix: string;
    portalDeviceName: string;
    portalDeviceUiCode: string;
    portalDeviceId: string;

    // device state
    position: Vector3;
    quaternion: Quaternion;
    stereoEnabled: boolean;
	/** New: user preference for face tracking */
	faceTrackingEnabled: boolean;
    immersiveFullscreenEnabled: boolean;
    ipd: number;
    fovy: number;
    controllers: { [key in XRHandedness]?: XRController };
    hands: { [key in XRHandedness]?: XRHandInput };
    primaryInputMode: 'controller' | 'hand';
    pendingReferenceSpaceReset: boolean;
    visibilityState: XRVisibilityState;
    pendingVisibilityState: XRVisibilityState | null;
    xrSystem: XRSystem | null;

    matrix: mat4;
    globalSpace: GlobalSpace;
    viewerSpace: XRReferenceSpace;
    viewSpaces: { [key in XREye]: XRSpace };

    canvasData?: {
      canvas: HTMLCanvasElement;
      parent: HTMLElement | null;
      width: number;
      height: number;
      zIndex: string;
    };
    canvasContainer: HTMLDivElement;
    currentBaseLayer: XRWebGLLayer | null;
    stereoTargets: StereoTargets | null;
    stereoCompositePass: StereoCompositePass | null;

    getViewport: (layer: XRWebGLLayer, view: XRView) => XRViewport;
    updateViews: () => void;
    onBaseLayerSet: (baseLayer: XRWebGLLayer | null) => void;
    onSessionEnd: () => void;
    onFrameStart: (frame: XRFrame) => void;

    // add-on modules:
    devui?: DevUI;
    sem?: SyntheticEnvironmentModule;
  };

  private portalPoseCamera: PortalPoseCameraController | null = null;
  private portalPoseCameraOptions: PortalPoseCameraOptions | undefined;
  private webrtcStreamer: WebRTCControllerStreamer | null = null;
  private webrtcStreamOptions: WebRTCControllerStreamOptions | undefined;
  private webrtcVisibilitySuspendTimer: ReturnType<typeof setTimeout> | null = null;
  private webrtcVisibilitySuspended = false;
  private webrtcSuspendedForVisibility = false;
  private lastImmersiveSessionForWebRTC: XRSession | null = null;
  private portalControllerRuntimePromise: Promise<PortalControllerRuntime> | null = null;
  private portalControllerRuntime: PortalControllerRuntime | null = null;
  private readonly handleConfigEvent = (event: Event) => {
    const detail = (event as CustomEvent<PortalEmulatorConfig | null | undefined>).detail;
    if (!detail) {
      return;
    }
    this.applyConfigSettings(detail);
  };
  private pendingOrientationReset = false;
  private lastControllerState: ControllerState | null = null;
  private activeWandState: ActiveWandState = 'none';
  private lastControllerPacketMs: number | null = null;
  private portalQrOverlay: PortalDeviceQrOverlay | null = null;
  private readonly lastControllerPoseByHand = {
    left: null as PortalPose | null,
    right: null as PortalPose | null,
  };
  private readonly cameraLockState: Record<'left' | 'right', { active: boolean; offset: PortalPose }> = {
    left: { active: false, offset: makeIdentityPortalPose() },
    right: { active: false, offset: makeIdentityPortalPose() },
  };
  private faceTracker: FaceTracker | null = null;
  private faceTrackerUnsubscribe: (() => void) | null = null;
  private faceTrackerVideoEl: HTMLVideoElement | null = null;
  private faceTrackerStream: MediaStream | null = null;
  private faceTrackingReference: { x: number; y: number; z: number } | null = null;
  private faceTrackingRecenterPending = false;
  private faceTrackingStartPromise: Promise<void> | null = null;
  private faceTrackingPermissionRejected = false;
  private readonly faceTrackingTarget = vec3.create();
  private readonly faceTrackingOffset = vec3.create();
  private readonly faceTrackingLocalOffset = vec3.create();
  private readonly faceTrackingTempPosition = vec3.create();
  private faceTrackingLastFrameMs = 0;
  private faceTrackingVisibilitySuspended = false;
  private faceTrackingSuspendedForVisibility = false;
  private dualOpposedNeutral: { y: number; z: number } | null = null;
  private lastDualSubmode: 'mirrored' | 'opposed' | null = null;
  private readonly baseCanvasFovRad: number;
  private lastCanvasZoomScale = 1;

  constructor(
    deviceConfig: XRDeviceConfig,
    deviceOptions: Partial<XRDeviceOptions> = {},
  ) {
    const portalIdentity = getPersistentPortalDeviceIdentity();
    const persistedConfig = getPortalEmulatorConfig();
    const configStereoEnabled = Boolean(persistedConfig.settings.stereoRenderingEnabled);
    const configFaceTrackingEnabled = persistedConfig.settings.faceTrackingEnabled !== false;
    const configImmersiveFullscreenEnabled =
      persistedConfig.settings.immersiveFullscreenEnabled !== false;
    const initialStereoEnabled =
      deviceOptions.stereoEnabled ?? configStereoEnabled;
    const globalSpace = new GlobalSpace();
    const viewerSpace = new XRReferenceSpace(
      XRReferenceSpaceType.Viewer,
      globalSpace,
    );
    const viewSpaces: { [key in XREye]: XRSpace } = {
      [XREye.Left]: new XRSpace(viewerSpace),
      [XREye.Right]: new XRSpace(viewerSpace),
      [XREye.None]: new XRSpace(viewerSpace),
    };
    const controllerConfig = deviceConfig.controllerConfig;
    const controllers: { [key in XRHandedness]?: XRController } = {};
    if (controllerConfig) {
      Object.values(XRHandedness).forEach((handedness) => {
        if (controllerConfig.layout[handedness]) {
          const controller = new XRController(
            controllerConfig,
            handedness,
            globalSpace,
          );
          controller.connected = false;
          this.resetControllerState(controller);
          controllers[handedness] = controller;
        }
      });
    }
    const hands = {
      [XRHandedness.Left]: new XRHandInput(
        oculusHandConfig,
        XRHandedness.Left,
        globalSpace,
      ),
      [XRHandedness.Right]: new XRHandInput(
        oculusHandConfig,
        XRHandedness.Right,
        globalSpace,
      ),
    };
    const canvasContainer =
      deviceOptions.canvasContainer ?? document.createElement('div');
    canvasContainer.dataset.webxr_runtime = `Immersive Web Emulation Runtime v${VERSION}`;
    canvasContainer.style.position = 'fixed';
    canvasContainer.style.width = '100%';
    canvasContainer.style.height = '100%';
    canvasContainer.style.top = '0';
    canvasContainer.style.left = '0';
    canvasContainer.style.display = 'flex';
    canvasContainer.style.justifyContent = 'center';
    canvasContainer.style.alignItems = 'center';
    canvasContainer.style.overflow = 'hidden';
    canvasContainer.style.zIndex = '999';

    const portalDeviceId = buildPortalDeviceId(portalIdentity.suffix);

    if (typeof document !== 'undefined') {
      const pairingUrl = buildSigcfPairingUrl(portalDeviceId);
      this.portalQrOverlay = new PortalDeviceQrOverlay({
        parent: canvasContainer,
        pairingUrl,
        deviceName: portalIdentity.fullName,
        deviceUiCode: portalIdentity.uiCode,
        deviceId: portalDeviceId,
      });
      this.portalQrOverlay.setVisible(false);
    }

    this[P_DEVICE] = {
      name: deviceConfig.name,
      supportedSessionModes: deviceConfig.supportedSessionModes,
      supportedFeatures: deviceConfig.supportedFeatures,
      supportedFrameRates: deviceConfig.supportedFrameRates,
      isSystemKeyboardSupported: deviceConfig.isSystemKeyboardSupported,
      internalNominalFrameRate: deviceConfig.internalNominalFrameRate,
      environmentBlendModes: deviceConfig.environmentBlendModes,
      interactionMode: deviceConfig.interactionMode,
      userAgent: deviceConfig.userAgent,
      portalDeviceSuffix: portalIdentity.suffix,
      portalDeviceName: portalIdentity.fullName,
      portalDeviceUiCode: portalIdentity.uiCode,
      portalDeviceId,

      position:
        deviceOptions.headsetPosition ?? DEFAULTS.headsetPosition.clone(),
      quaternion:
        deviceOptions.headsetQuaternion ?? DEFAULTS.headsetQuaternion.clone(),
      stereoEnabled: initialStereoEnabled,
      faceTrackingEnabled: configFaceTrackingEnabled,
      immersiveFullscreenEnabled: configImmersiveFullscreenEnabled,
      ipd: FORCED_IPD_METERS,
      fovy: deviceOptions.fovy ?? DEFAULTS.fovy,
      controllers,
      hands,
      primaryInputMode: 'controller',
      pendingReferenceSpaceReset: false,
      visibilityState: 'visible',
      pendingVisibilityState: null,
      xrSystem: null,

      matrix: mat4.create(),
      globalSpace,
      viewerSpace,
      viewSpaces,
      canvasContainer,
      currentBaseLayer: null as XRWebGLLayer | null,
      stereoTargets: null as StereoTargets | null,
      stereoCompositePass: null,

      getViewport: (layer: XRWebGLLayer, view: XRView) => {
        const isStereoEye =
          this[P_DEVICE].stereoEnabled && view.eye !== XREye.None;

        if (isStereoEye) {
          const gl = layer.context;
          if (layer.ensureStereoTargets(gl.drawingBufferWidth, gl.drawingBufferHeight)) {
            this[P_DEVICE].stereoTargets = layer.getStereoTargets();
          }
        }

        const canvas = layer.context.canvas;
        const { width, height } = canvas;
        switch (view.eye) {
          case XREye.None:
            return new XRViewport(0, 0, width, height);
          case XREye.Left:
            return new XRViewport(
              0,
              0,
              this[P_DEVICE].stereoEnabled ? width / 2 : width,
              height,
            );
          case XREye.Right:
            return new XRViewport(
              width / 2,
              0,
              this[P_DEVICE].stereoEnabled ? width / 2 : 0,
              height,
            );
        }
      },
      updateViews: () => {
        // update viewerSpace
        const viewerSpace = this[P_DEVICE].viewerSpace;
        const basePosition = this[P_DEVICE].position.vec3;
        vec3.add(this.faceTrackingTempPosition, basePosition, this.faceTrackingOffset);
        mat4.fromRotationTranslation(
          viewerSpace[P_SPACE].offsetMatrix,
          this[P_DEVICE].quaternion.quat,
          this.faceTrackingTempPosition,
        );

        // update viewSpaces
        mat4.fromTranslation(
          this[P_DEVICE].viewSpaces[XREye.Left][P_SPACE].offsetMatrix,
          vec3.fromValues(-this[P_DEVICE].ipd / 2, 0, 0),
        );
        mat4.fromTranslation(
          this[P_DEVICE].viewSpaces[XREye.Right][P_SPACE].offsetMatrix,
          vec3.fromValues(this[P_DEVICE].ipd / 2, 0, 0),
        );
      },
      onBaseLayerSet: (baseLayer: XRWebGLLayer | null) => {
        if (!baseLayer) return;

        this[P_DEVICE].currentBaseLayer = baseLayer;

        if (this[P_DEVICE].stereoEnabled) {
          const gl = baseLayer.context;
          if (!(gl instanceof WebGL2RenderingContext)) {
            console.warn('[XRDevice] Stereo rendering requires WebGL2 context.');
            this[P_DEVICE].stereoTargets = null;
          } else {
            baseLayer.ensureStereoTargets(
              gl.drawingBufferWidth,
              gl.drawingBufferHeight,
            );
            this[P_DEVICE].stereoTargets = baseLayer.getStereoTargets();
            if (!this[P_DEVICE].stereoCompositePass) {
              this[P_DEVICE].stereoCompositePass = new StereoCompositePass(gl);
            }
          }
        } else {
          baseLayer.disposeStereoTargets();
          this[P_DEVICE].stereoTargets = null;
        }

        // backup canvas data
        const canvas = baseLayer.context.canvas as HTMLCanvasElement;
        if (canvas.parentElement !== this[P_DEVICE].canvasContainer) {
          const devui = this[P_DEVICE].devui;
          if (devui) {
            const { devUICanvas, devUIContainer } = devui;
            devUICanvas.style.zIndex = Z_INDEX_DEVUI_CANVAS.toString();
            devUIContainer.style.zIndex = Z_INDEX_DEVUI_CONTAINER.toString();
            this[P_DEVICE].canvasContainer.appendChild(devui.devUICanvas);
            this[P_DEVICE].canvasContainer.appendChild(devui.devUIContainer);
          }
          const sem = this[P_DEVICE].sem;
          if (sem) {
            sem.environmentCanvas.style.zIndex = Z_INDEX_SEM_CANVAS.toString();
            this[P_DEVICE].canvasContainer.appendChild(sem.environmentCanvas);
          }
          this[P_DEVICE].canvasData = {
            canvas,
            parent: canvas.parentElement,
            width: canvas.width,
            height: canvas.height,
            zIndex: canvas.style.zIndex,
          };
          canvas.style.zIndex = Z_INDEX_APP_CANVAS.toString();
          this[P_DEVICE].canvasContainer.appendChild(canvas);
          document.body.appendChild(this[P_DEVICE].canvasContainer);
        }

        if (this[P_DEVICE].stereoEnabled) {
          canvas.width = window.innerWidth * 2;
        } else {
          canvas.width = window.innerWidth;
        }
        canvas.height = window.innerHeight;

        this.ensureFullscreenForImmersiveSession();
      },
      onSessionEnd: () => {
        this.exitFullscreenForImmersiveSession();
        this[P_DEVICE].currentBaseLayer?.disposeStereoTargets();
        this[P_DEVICE].currentBaseLayer = null;
        this[P_DEVICE].stereoTargets = null;
        if (this[P_DEVICE].stereoCompositePass) {
          this[P_DEVICE].stereoCompositePass.dispose();
          this[P_DEVICE].stereoCompositePass = null;
        }
        if (this[P_DEVICE].canvasData) {
          this.resetCanvasZoomTransform();
          const { canvas, parent, width, height, zIndex } =
            this[P_DEVICE].canvasData;
          canvas.width = width;
          canvas.height = height;
          canvas.style.zIndex = zIndex;
          if (parent) {
            parent.appendChild(canvas);
          } else {
            this[P_DEVICE].canvasContainer.removeChild(canvas);
          }
          const devui = this[P_DEVICE].devui;
          if (devui) {
            this[P_DEVICE].canvasContainer.removeChild(devui.devUICanvas);
            this[P_DEVICE].canvasContainer.removeChild(devui.devUIContainer);
          }
          const sem = this[P_DEVICE].sem;
          if (sem) {
            this[P_DEVICE].canvasContainer.removeChild(sem.environmentCanvas);
          }
          document.body.removeChild(this[P_DEVICE].canvasContainer);
          this[P_DEVICE].canvasData = undefined;
          window.dispatchEvent(new Event('resize'));
        }
        this.lastImmersiveSessionForWebRTC = null;
        this.stopFaceTracking();
      },
      onFrameStart: (frame: XRFrame) => {
        const session = frame.session;
        this.ensureDefaultWebRTCStreamerForSession(session);
        this.portalPoseCamera?.update(frame);
        this.updateFaceTrackingForSession(session);
        this[P_DEVICE].updateViews();

        if (this[P_DEVICE].pendingVisibilityState) {
          this[P_DEVICE].visibilityState =
            this[P_DEVICE].pendingVisibilityState;
          this[P_DEVICE].pendingVisibilityState = null;
          session.dispatchEvent(
            new XRSessionEvent('visibilitychange', { session }),
          );
        }
        if (this[P_DEVICE].visibilityState === 'visible') {
          this.webrtcStreamer?.update(frame);
          this.updateControllerPose(frame);
          this.activeInputs.forEach((activeInput) => {
            activeInput.onFrameStart(frame);
          });
        }

        if (this[P_DEVICE].pendingReferenceSpaceReset) {
          session[P_SESSION].referenceSpaces.forEach((referenceSpace) => {
            switch (referenceSpace[P_REF_SPACE].type) {
              case XRReferenceSpaceType.Local:
              case XRReferenceSpaceType.LocalFloor:
              case XRReferenceSpaceType.BoundedFloor:
              case XRReferenceSpaceType.Unbounded:
                referenceSpace.dispatchEvent(
                  new XRReferenceSpaceEvent('reset', { referenceSpace }),
                );
                break;
            }
          });
          this[P_DEVICE].pendingReferenceSpaceReset = false;
        }

        this.updateCanvasZoomTransform();
        this[P_DEVICE].updateViews();
      },
    };

    this.baseCanvasFovRad =
      Number.isFinite(this[P_DEVICE].fovy) && this[P_DEVICE].fovy > 0
        ? this[P_DEVICE].fovy
        : DEFAULTS.fovy;

    this.applyConfigSettings(persistedConfig);
    if (typeof window !== 'undefined') {
      window.addEventListener('portalvr:set-config', this.handleConfigEvent);
    }
    onPortalEmulatorConfigChange((config) => {
      this.applyConfigSettings(config);
    });

    if (typeof document !== 'undefined') {
      const isVisible = document.visibilityState === 'visible';
      this.faceTrackingVisibilitySuspended = !isVisible;
      this.webrtcVisibilitySuspended = !isVisible;
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    this.enablePortalPoseCamera();
    this[P_DEVICE].updateViews();
    globalThis;
  }

	installRuntime(options?: RuntimeOptions) {
		const globalObject = options?.globalObject ?? globalThis;
		const polyfillLayers = options?.polyfillLayers;
		const enforce = options?.enforce ?? true;
		const navigatorObject = (
			(globalObject as { navigator?: Navigator }).navigator ??
			((globalThis as { navigator?: Navigator })?.navigator ?? undefined)
		);
		const xrGlobalKeys = [
			'XRSystem',
			'XRSession',
			'XRRenderState',
			'XRFrame',
			'XRSpace',
			'XRReferenceSpace',
			'XRJointSpace',
			'XRView',
			'XRViewport',
			'XRRigidTransform',
			'XRPose',
			'XRViewerPose',
			'XRJointPose',
			'XRInputSource',
			'XRInputSourceArray',
			'XRHand',
			'XRLayer',
			'XRWebGLLayer',
			'XRSessionEvent',
			'XRInputSourceEvent',
			'XRInputSourcesChangeEvent',
			'XRReferenceSpaceEvent',
			'XRMediaBinding',
			'XRWebGLBinding',
		];
		let navigatorXRLocked = false;
		let currentXRSystem: XRSystem;

		const removeNavigatorXR = () => {
			if (!navigatorObject) {
				return;
			}
			try {
				if (!Reflect.deleteProperty(navigatorObject, 'xr')) {
					(navigatorObject as any).xr = undefined;
				}
			} catch (_error) {
				try {
					Object.defineProperty(navigatorObject, 'xr', {
						configurable: true,
						value: undefined,
					});
					Reflect.deleteProperty(navigatorObject, 'xr');
				} catch (_secondError) {
					(navigatorObject as any).xr = undefined;
				}
			}
		};

		const purgeXRGlobals = () => {
			xrGlobalKeys.forEach((key) => {
				if (key in globalObject) {
					try {
						Reflect.deleteProperty(globalObject, key);
					} catch (_error) {
						(globalObject as any)[key] = undefined;
					}
				}
			});
		};

		const applyRuntimeSurface = () => {
			Object.defineProperty(
				WebGL2RenderingContext.prototype,
				'makeXRCompatible',
				{
					value: function () {
						return Promise.resolve(true);
					},
					configurable: true,
				},
			);
			const xrSystem = new XRSystem(this);
			this[P_DEVICE].xrSystem = xrSystem;
			if (navigatorObject) {
				Object.defineProperty(navigatorObject, 'userAgent', {
					value: this[P_DEVICE].userAgent,
					writable: false,
					configurable: false,
					enumerable: true,
				});
			}
			(globalObject as any)['XRSystem'] = XRSystem;
			(globalObject as any)['XRSession'] = XRSession;
			(globalObject as any)['XRRenderState'] = XRRenderState;
			(globalObject as any)['XRFrame'] = XRFrame;
			(globalObject as any)['XRSpace'] = XRSpace;
			(globalObject as any)['XRReferenceSpace'] = XRReferenceSpace;
			(globalObject as any)['XRJointSpace'] = XRJointSpace;
			(globalObject as any)['XRView'] = XRView;
			(globalObject as any)['XRViewport'] = XRViewport;
			(globalObject as any)['XRRigidTransform'] = XRRigidTransform;
			(globalObject as any)['XRPose'] = XRPose;
			(globalObject as any)['XRViewerPose'] = XRViewerPose;
			(globalObject as any)['XRJointPose'] = XRJointPose;
			(globalObject as any)['XRInputSource'] = XRInputSource;
			(globalObject as any)['XRInputSourceArray'] = XRInputSourceArray;
			(globalObject as any)['XRHand'] = XRHand;
			(globalObject as any)['XRLayer'] = XRLayer;
			(globalObject as any)['XRWebGLLayer'] = XRWebGLLayer;
			(globalObject as any)['XRSessionEvent'] = XRSessionEvent;
			(globalObject as any)['XRInputSourceEvent'] = XRInputSourceEvent;
			(globalObject as any)['XRInputSourcesChangeEvent'] =
				XRInputSourcesChangeEvent;
			(globalObject as any)['XRReferenceSpaceEvent'] =
				XRReferenceSpaceEvent;
			if (polyfillLayers) {
				new WebXRLayerPolyfill();
			} else {
				(globalObject as any)['XRMediaBinding'] = undefined;
				(globalObject as any)['XRWebGLBinding'] = undefined;
			}
			return xrSystem;
		};

		const setNavigatorXR = (xrSystem: XRSystem) => {
			currentXRSystem = xrSystem;
			if (!navigatorObject) {
				return;
			}
			if (!navigatorXRLocked) {
				Object.defineProperty(navigatorObject, 'xr', {
					configurable: false,
					enumerable: false,
					get: () => currentXRSystem,
				});
				navigatorXRLocked = true;
			}
		};

		const install = () => {
			if (!navigatorXRLocked) {
				removeNavigatorXR();
			}
			purgeXRGlobals();
			const xrSystem = applyRuntimeSurface();
			setNavigatorXR(xrSystem);
			return xrSystem;
		};

		if (!enforce || !navigatorObject) {
			removeNavigatorXR();
			purgeXRGlobals();
			const xrSystem = applyRuntimeSurface();
			currentXRSystem = xrSystem;
			if (navigatorObject) {
				Object.defineProperty(navigatorObject, 'xr', {
					configurable: true,
					enumerable: false,
					get: () => currentXRSystem,
				});
			}
			return;
		}

		const reinstall = () => install();
		reinstall();

		const originalPolyfillCtor =
			typeof (globalObject as any).WebXRPolyfill === 'function'
				? (globalObject as any).WebXRPolyfill
				: null;
		const guardCtor = function PortalVRWebXRPolyfillGuard(
			this: unknown,
			...args: any[]
		) {
			reinstall();
			if (originalPolyfillCtor) {
				return Reflect.construct(
					originalPolyfillCtor,
					args,
					(new.target ?? guardCtor) as unknown as Function,
				);
			}
			return undefined;
		} as any;

		Object.defineProperty(globalObject, 'WebXRPolyfill', {
			configurable: false,
			enumerable: false,
			get: () => guardCtor,
			set: () => {
				reinstall();
			},
		});

		if (typeof queueMicrotask === 'function') {
			queueMicrotask(reinstall);
		} else {
			Promise.resolve().then(reinstall);
		}
	}

  installDevUI(devUIConstructor: DevUIConstructor) {
    this[P_DEVICE].devui = new devUIConstructor(this);
  }

  installSEM(semConstructor: SEMConstructor) {
    this[P_DEVICE].sem = new semConstructor(this);
  }

  get supportedSessionModes() {
    return this[P_DEVICE].supportedSessionModes;
  }

  get supportedFeatures() {
    return this[P_DEVICE].supportedFeatures;
  }

  get supportedFrameRates() {
    return this[P_DEVICE].supportedFrameRates;
  }

  get isSystemKeyboardSupported() {
    return this[P_DEVICE].isSystemKeyboardSupported;
  }

  get internalNominalFrameRate() {
    return this[P_DEVICE].internalNominalFrameRate;
  }

  get portalDeviceName(): string {
    return this[P_DEVICE].portalDeviceName;
  }

  get portalDeviceSuffix(): string {
    return this[P_DEVICE].portalDeviceSuffix;
  }

  get portalDeviceUiCode(): string {
    return this[P_DEVICE].portalDeviceUiCode;
  }

  get portalDeviceId(): string {
    return this[P_DEVICE].portalDeviceId;
  }

  get stereoEnabled() {
    return this[P_DEVICE].stereoEnabled;
  }

  set stereoEnabled(value: boolean) {
    this[P_DEVICE].stereoEnabled = value;
  }

	get faceTrackingEnabled(): boolean {
	return this[P_DEVICE].faceTrackingEnabled;
	}

	set faceTrackingEnabled(value: boolean) {
	const prev = this[P_DEVICE].faceTrackingEnabled;
	this[P_DEVICE].faceTrackingEnabled = Boolean(value);
	if (prev === this[P_DEVICE].faceTrackingEnabled) {
		return;
	}
	const session = this.activeSession;
	if (!session) {
		// No active session; nothing to do. When session starts, it will use the flag.
		return;
	}
	if (this[P_DEVICE].faceTrackingEnabled) {
		// Best effort to start if appropriate
		if (this.shouldRunFaceTrackingForSession(session)) {
		this.ensureFaceTracking();
		}
	} else {
		// Immediately stop if running
		this.stopFaceTracking();
	}
	}

  get immersiveFullscreenEnabled(): boolean {
    return this[P_DEVICE].immersiveFullscreenEnabled;
  }

  set immersiveFullscreenEnabled(value: boolean) {
    const next = Boolean(value);
    const prev = this[P_DEVICE].immersiveFullscreenEnabled;
    if (prev === next) {
      return;
    }
    this[P_DEVICE].immersiveFullscreenEnabled = next;
    const session = this.activeSession;
    if (!session || !this.isImmersiveSession(session)) {
      return;
    }
    if (next) {
      this.ensureFullscreenForImmersiveSession();
    } else {
      this.exitFullscreenForImmersiveSession();
    }
  }

  get ipd() {
    return this[P_DEVICE].ipd;
  }

  set ipd(value: number) {
    void value; // IPD is pinned for consistent emulator behaviour.
    this[P_DEVICE].ipd = FORCED_IPD_METERS;
  }

  get fovy() {
    return this[P_DEVICE].fovy;
  }

  set fovy(value: number) {
    this[P_DEVICE].fovy = value;
  }

  get position(): Vector3 {
    return this[P_DEVICE].position;
  }

  get quaternion(): Quaternion {
    return this[P_DEVICE].quaternion;
  }

  get viewerSpace() {
    return this[P_DEVICE].viewerSpace;
  }

  get viewSpaces() {
    return this[P_DEVICE].viewSpaces;
  }

  get controllers() {
    return this[P_DEVICE].controllers;
  }

  get hands() {
    return this[P_DEVICE].hands;
  }

  get primaryInputMode() {
    return this[P_DEVICE].primaryInputMode;
  }

  set primaryInputMode(mode: 'controller' | 'hand') {
    if (mode !== 'controller' && mode !== 'hand') {
      console.warn('primary input mode can only be "controller" or "hand"');
      return;
    }
    this[P_DEVICE].primaryInputMode = mode;
  }

  get activeInputs(): XRTrackedInput[] {
    if (this[P_DEVICE].visibilityState !== 'visible') {
      return [];
    }
    const activeInputs: XRTrackedInput[] =
      this[P_DEVICE].primaryInputMode === 'controller'
        ? Object.values(this[P_DEVICE].controllers)
        : Object.values(this[P_DEVICE].hands);
    return activeInputs.filter((input) => input.connected);
  }

  get inputSources(): XRInputSource[] {
    return this.activeInputs.map((input) => input.inputSource);
  }

  get canvasContainer(): HTMLDivElement {
    return this[P_DEVICE].canvasContainer;
  }

  get canvasDimensions(): { width: number; height: number } | undefined {
    if (this[P_DEVICE].canvasData) {
      const { width, height } = this[P_DEVICE].canvasData.canvas;
      return { width, height };
    }
    return;
  }

  get activeSession(): XRSession | undefined {
    return this[P_DEVICE].xrSystem?.[P_SYSTEM].activeSession;
  }

  get sessionOffered(): boolean {
    return Boolean(this[P_DEVICE].xrSystem?.[P_SYSTEM].offeredSessionConfig);
  }

  get name() {
    return this[P_DEVICE].name;
  }

  grantOfferedSession(): void {
    const xrSystem = this[P_DEVICE].xrSystem;
    const pSystem = xrSystem?.[P_SYSTEM];
    if (pSystem && pSystem.offeredSessionConfig) {
      const { resolve, reject, mode, options } = pSystem.offeredSessionConfig;
      
      // Clear the offered session config first
      pSystem.offeredSessionConfig = undefined;
      
      // Use the same requestSession flow to ensure identical behavior
      xrSystem.requestSession(mode, options)
        .then(resolve)
        .catch(reject);
    }
  }

  recenter() {
    const deltaVec = new Vector3(-this.position.x, 0, -this.position.z);
    const forward = new Vector3(0, 0, -1).applyQuaternion(this.quaternion);
    forward.y = 0;
    forward.normalize();
    const angle = Math.atan2(forward.x, -forward.z);
    const deltaQuat = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      angle,
    );
    this.position.add(deltaVec);
    this.quaternion.multiply(deltaQuat);

    [
      ...Object.values(this[P_DEVICE].controllers),
      ...Object.values(this[P_DEVICE].hands),
    ].forEach((activeInput) => {
      activeInput.position.add(deltaVec);
      activeInput.quaternion.multiply(deltaQuat);
      activeInput.position.applyQuaternion(deltaQuat);
    });

    this[P_DEVICE].pendingReferenceSpaceReset = true;
  }

  get visibilityState() {
    return this[P_DEVICE].visibilityState;
  }

  // visibility state updates are queued until the XRSession produces frames
  updateVisibilityState(state: XRVisibilityState) {
    if (
      !Object.values(['visible', 'visible-blurred', 'hidden']).includes(state)
    ) {
      throw new DOMException(
        'Invalid XRVisibilityState value',
        'NotSupportedError',
      );
    }
    if (state !== this[P_DEVICE].visibilityState) {
      this[P_DEVICE].pendingVisibilityState = state;
    }
  }

  get devui() {
    return this[P_DEVICE].devui;
  }

  get sem() {
    return this[P_DEVICE].sem;
  }

  private handleControllerState = async (state: ControllerState) => {
    this.lastControllerState = state;
    this.lastControllerPacketMs = getNowMs();
    try {
      const runtime = await this.ensurePortalControllerRuntime();
      runtime.ingestPacket(state);
      runtime.setWandMode(state.wandMode);
    } catch (error) {
      console.error('[XRDevice] Failed to process controller state', error);
    }

    const activeState = resolveActiveWandState(state.wandMode);
    this.setActiveWandState(activeState);
    this.updateControllerButtons(state, activeState);
  };

  private handleControllerConnectionChange = (connected: boolean) => {
    this.portalQrOverlay?.setVisible(!connected);
    if (!connected) {
      this.portalControllerRuntime?.handleDisconnect();
      this.lastControllerState = null;
      this.lastControllerPacketMs = null;
      this.lastControllerPoseByHand.left = null;
      this.lastControllerPoseByHand.right = null;
      this.dualOpposedNeutral = null;
      this.lastDualSubmode = null;
      this.updateCameraLockState('left', false);
      this.updateCameraLockState('right', false);
      this.setActiveWandState('none', true);
    }
  };

  private handleOrientationReset = () => {
    this.faceTrackingRecenterPending = true;
    if (this.portalControllerRuntime) {
      this.portalControllerRuntime.handleOrientationReset();
    } else {
      this.pendingOrientationReset = true;
    }
  };

  private handleVisibilityChange = (): void => {
    if (typeof document === 'undefined') {
      return;
    }
    const visibilityState = document.visibilityState;
    if (visibilityState !== 'visible') {
      this.faceTrackingVisibilitySuspended = true;
      if (this.faceTracker || this.faceTrackingStartPromise) {
        this.faceTrackingSuspendedForVisibility = true;
      }
      this.webrtcVisibilitySuspended = true;
      this.scheduleWebRTCVisibilitySuspend();
      this.stopFaceTracking();
      return;
    }

    this.cancelWebRTCVisibilitySuspendTimer();
    this.webrtcVisibilitySuspended = false;
    const resumeNeeded = this.faceTrackingSuspendedForVisibility;
    this.faceTrackingVisibilitySuspended = false;
    if (resumeNeeded) {
      this.faceTrackingSuspendedForVisibility = false;
      this.faceTrackingRecenterPending = true;
      const session = this.activeSession;
      if (session && this.shouldRunFaceTrackingForSession(session)) {
        this.ensureFaceTracking();
      }
    }
    this.resumeWebRTCStreamingAfterVisibility();
  };

  private ensurePortalControllerRuntime(): Promise<PortalControllerRuntime> {
    if (!this.portalControllerRuntimePromise) {
      const options = this.portalPoseCameraOptions;
      this.portalControllerRuntimePromise = PortalControllerRuntime.create(options)
        .then((runtime) => {
          this.portalControllerRuntime = runtime;
          if (this.pendingOrientationReset) {
            runtime.handleOrientationReset();
            this.pendingOrientationReset = false;
          }
          if (this.lastControllerState) {
            runtime.setWandMode(this.lastControllerState.wandMode);
          }
          this.syncAllCameraLocksToRuntime();
          return runtime;
        })
        .catch((error) => {
          console.error('[XRDevice] Failed to initialise Portal controller runtime', error);
          this.portalControllerRuntimePromise = null;
          throw error;
        });
    }
    return this.portalControllerRuntimePromise;
  }

  private setActiveWandState(next: ActiveWandState, force = false) {
    if (!force && this.activeWandState === next) {
      return;
    }

    const prevState = this.activeWandState;

    if (next === 'none') {
      this.portalControllerRuntime?.setWandMode(0);
    }

    if (next !== 'both') {
      this.dualOpposedNeutral = null;
      this.lastDualSubmode = null;
    }

    this.activeWandState = next;

    const controllers = this[P_DEVICE].controllers;
    const left = controllers[XRHandedness.Left];
    const right = controllers[XRHandedness.Right];

    const shouldTrackLeft = next === 'left' || next === 'both';
    const shouldTrackRight = next === 'right' || next === 'both';
    const shouldFreezeLeft = !shouldTrackLeft && next !== 'none';
    const shouldFreezeRight = !shouldTrackRight && next !== 'none';

    this.updateHandConnection(left, 'left', prevState, {
      shouldTrack: shouldTrackLeft,
      shouldFreeze: shouldFreezeLeft,
      force,
    });

    this.updateHandConnection(right, 'right', prevState, {
      shouldTrack: shouldTrackRight,
      shouldFreeze: shouldFreezeRight,
      force,
    });

    const anyConnected =
      shouldTrackLeft ||
      shouldTrackRight ||
      shouldFreezeLeft ||
      shouldFreezeRight;

    if (anyConnected) {
      this[P_DEVICE].primaryInputMode = 'controller';
    }

    if (next === 'none') {
      this.lastControllerPoseByHand.left = null;
      this.lastControllerPoseByHand.right = null;
    }
  }

  private updateHandConnection(
    controller: XRController | undefined,
    hand: 'left' | 'right',
    prevState: ActiveWandState,
    options: { shouldTrack: boolean; shouldFreeze: boolean; force: boolean },
  ) {
    if (!controller) {
      return;
    }

    const { shouldTrack, shouldFreeze, force } = options;

    if (shouldFreeze && !this.lastControllerPoseByHand[hand]) {
      this.lastControllerPoseByHand[hand] = this.snapshotControllerPose(controller);
    }

    const newConnected = shouldTrack || shouldFreeze;
    const wasConnected = controller.connected;
    controller.connected = newConnected;

    const wasTracking = this.handWasTracked(prevState, hand);
    const wasFrozen = !wasTracking && this.lastControllerPoseByHand[hand] != null;

    if (!newConnected) {
      this.updateCameraLockState(hand, false);
      this.resetControllerState(controller);
      this.lastControllerPoseByHand[hand] = null;
      return;
    }

    if (!shouldTrack) {
      this.resetControllerState(controller);
      const stored = this.lastControllerPoseByHand[hand];
      if (stored) {
        const headPortalPose = this.createCurrentHeadPortalPose();
        const offset = this.computeHeadRelativeOffset(headPortalPose, stored);
        if (offset) {
          this.updateCameraLockState(hand, true, offset);
        } else {
          this.updateCameraLockState(hand, false);
        }
        controller.position.set(
          stored.position.x,
          stored.position.y,
          stored.position.z,
        );
        controller.quaternion.set(
          stored.orientation.x,
          stored.orientation.y,
          stored.orientation.z,
          stored.orientation.w,
        );
      } else {
        this.updateCameraLockState(hand, false);
      }
      return;
    }

    this.updateCameraLockState(hand, false);
    if (force || !wasConnected || !wasTracking || wasFrozen) {
      this.resetControllerState(controller);
    }
  }

  private handWasTracked(state: ActiveWandState, hand: 'left' | 'right'): boolean {
    if (state === 'both') {
      return true;
    }
    if (state === 'left') {
      return hand === 'left';
    }
    if (state === 'right') {
      return hand === 'right';
    }
    return false;
  }

  private resetControllerState(controller?: XRController) {
    if (!controller) {
      return;
    }

    if (this.controllerHasButton(controller, 'trigger')) {
      controller.updateButtonValue('trigger', 0);
    }
    if (this.controllerHasButton(controller, 'squeeze')) {
      controller.updateButtonValue('squeeze', 0);
    }
    if (this.controllerHasButton(controller, 'thumbstick')) {
      controller.updateButtonValue('thumbstick', 0);
      controller.updateButtonTouch('thumbstick', false);
    }
    if (this.controllerHasAxis(controller, 'thumbstick')) {
      controller.updateAxes('thumbstick', 0, 0);
    }

    const handedness = controller.inputSource.handedness;
    if (handedness === XRHandedness.Left) {
      if (this.controllerHasButton(controller, 'x-button')) {
        controller.updateButtonValue('x-button', 0);
      }
      if (this.controllerHasButton(controller, 'y-button')) {
        controller.updateButtonValue('y-button', 0);
      }
    } else if (handedness === XRHandedness.Right) {
      if (this.controllerHasButton(controller, 'a-button')) {
        controller.updateButtonValue('a-button', 0);
      }
      if (this.controllerHasButton(controller, 'b-button')) {
        controller.updateButtonValue('b-button', 0);
      }
    }

    if (this.controllerHasButton(controller, 'thumbrest')) {
      controller.updateButtonValue('thumbrest', 0);
      controller.updateButtonTouch('thumbrest', false);
    }
  }

  private controllerHasButton(controller: XRController, id: string): boolean {
    return controller.gamepadConfig.buttons.some((button) => button?.id === id);
  }

  private controllerHasAxis(controller: XRController, id: string): boolean {
    return controller.gamepadConfig.axes.some((axis) => axis?.id === id);
  }

  private updateControllerButtons(state: ControllerState, activeState: ActiveWandState) {
    const controllers = this[P_DEVICE].controllers;
    const left = controllers[XRHandedness.Left];
    const right = controllers[XRHandedness.Right];

    const thumbstickTouched =
      Math.abs(state.joystick.x) > THUMBSTICK_TOUCH_EPSILON ||
      Math.abs(state.joystick.y) > THUMBSTICK_TOUCH_EPSILON ||
      state.buttons.stick;

    if (activeState === 'left' || activeState === 'both') {
      this.applyButtonsToController(left, state, XRHandedness.Left, thumbstickTouched);
    } else if (left) {
      this.resetControllerState(left);
    }

    if (activeState === 'right' || activeState === 'both') {
      this.applyButtonsToController(right, state, XRHandedness.Right, thumbstickTouched);
    } else if (right) {
      this.resetControllerState(right);
    }
  }

  private applyButtonsToController(
    controller: XRController | undefined,
    state: ControllerState,
    handedness: XRHandedness,
    thumbstickTouched: boolean,
  ) {
    if (!controller) {
      return;
    }

    if (this.controllerHasButton(controller, 'trigger')) {
      controller.updateButtonValue('trigger', state.buttons.trigger ? 1 : 0);
    }
    if (this.controllerHasButton(controller, 'squeeze')) {
      controller.updateButtonValue('squeeze', state.buttons.squeeze ? 1 : 0);
    }
    if (this.controllerHasButton(controller, 'thumbstick')) {
      controller.updateButtonValue('thumbstick', state.buttons.stick ? 1 : 0);
      controller.updateButtonTouch('thumbstick', thumbstickTouched);
    }
    if (this.controllerHasAxis(controller, 'thumbstick')) {
      controller.updateAxes(
        'thumbstick',
        clampAxis(state.joystick.x),
        clampAxis(state.joystick.y),
      );
    }

    if (handedness === XRHandedness.Left) {
      if (this.controllerHasButton(controller, 'x-button')) {
        controller.updateButtonValue('x-button', state.buttons.action1 ? 1 : 0);
      }
      if (this.controllerHasButton(controller, 'y-button')) {
        controller.updateButtonValue('y-button', state.buttons.action2 ? 1 : 0);
      }
    } else if (handedness === XRHandedness.Right) {
      if (this.controllerHasButton(controller, 'a-button')) {
        controller.updateButtonValue('a-button', state.buttons.action1 ? 1 : 0);
      }
      if (this.controllerHasButton(controller, 'b-button')) {
        controller.updateButtonValue('b-button', state.buttons.action2 ? 1 : 0);
      }
    }

    if (this.controllerHasButton(controller, 'thumbrest')) {
      controller.updateButtonValue('thumbrest', state.buttons.menu ? 1 : 0);
      controller.updateButtonTouch('thumbrest', state.buttons.menu);
    }
  }

  private updateControllerPose(frame: XRFrame) {
    const runtime = this.portalControllerRuntime;
    if (!runtime || !this.lastControllerState) {
      return;
    }

    const nowMs = getNowMs();
    if (
      this.lastControllerPacketMs != null &&
      nowMs - this.lastControllerPacketMs > 1500
    ) {
      runtime.handleDisconnect();
      this.handleControllerConnectionChange(false);
      return;
    }

    const controllers = this[P_DEVICE].controllers;
    if (!controllers) {
      return;
    }

    const timestampNs =
      frame.predictedDisplayTime > 0
        ? frame.predictedDisplayTime * 1e6
        : nowMs * 1e6;

    const headPose = {
      position: {
        x: this.position.x,
        y: this.position.y,
        z: this.position.z,
      },
      orientation: {
        x: this.quaternion.x,
        y: this.quaternion.y,
        z: this.quaternion.z,
        w: this.quaternion.w,
      },
    };

	this.portalControllerRuntime?.setExternalUiYawRad(
		this.portalPoseCamera?.getYawOffsetRad?.() ?? 0,
	);

    const update = runtime.updateFrame(timestampNs, headPose);
    if (!update) {
      return;
    }

    if (update.cameraFovDeg > 0) {
      const clampedFovDeg = Math.min(Math.max(update.cameraFovDeg, 1), 179);
      const newFovyRad = degreesToRadians(clampedFovDeg);
      if (Number.isFinite(newFovyRad) && newFovyRad > 0) {
        this.fovy = newFovyRad;
      }
    }

    let leftPose: PortalPose | null = null;
    let rightPose: PortalPose | null = null;

    switch (this.activeWandState) {
      case 'both': {
        const wandMode = this.lastControllerState?.wandMode ?? 0;
        const submode: 'mirrored' | 'opposed' = wandMode === 5 ? 'opposed' : 'mirrored';
        if (this.lastDualSubmode !== submode) {
          this.lastDualSubmode = submode;
          this.dualOpposedNeutral = null;
        }
        const dominantPose = this.clonePortalPose(update.finalPose);
        rightPose = dominantPose;
        const offhand = this.computeDualOffhandPose(dominantPose, headPose, submode);
        leftPose = offhand ?? this.clonePortalPose(dominantPose);
        break;
      }
      case 'left':
        leftPose = this.clonePortalPose(update.finalPose);
        this.lastDualSubmode = null;
        this.dualOpposedNeutral = null;
        break;
      case 'right':
        rightPose = this.clonePortalPose(update.finalPose);
        this.lastDualSubmode = null;
        this.dualOpposedNeutral = null;
        break;
      default:
        this.lastDualSubmode = null;
        this.dualOpposedNeutral = null;
        break;
    }

    const headPortalPose: PortalPose = {
      position: { ...headPose.position },
      orientation: { ...headPose.orientation },
    };

    if (runtime) {
      if (!leftPose && this.cameraLockState.left.active && this.lastControllerPoseByHand.left) {
        const updated = runtime.updateCameraLockedPose('left', headPortalPose, this.lastControllerPoseByHand.left);
        if (updated) {
          const lockedPose = this.clonePortalPose(updated);
          leftPose = lockedPose;
          this.lastControllerPoseByHand.left = lockedPose;
        }
      }
      if (!rightPose && this.cameraLockState.right.active && this.lastControllerPoseByHand.right) {
        const updated = runtime.updateCameraLockedPose('right', headPortalPose, this.lastControllerPoseByHand.right);
        if (updated) {
          const lockedPose = this.clonePortalPose(updated);
          rightPose = lockedPose;
          this.lastControllerPoseByHand.right = lockedPose;
        }
      }
    }

    if (leftPose) {
      this.applyControllerPose(controllers[XRHandedness.Left], leftPose);
    }
    if (rightPose) {
      this.applyControllerPose(controllers[XRHandedness.Right], rightPose);
    }

    if (update.cameraDrag) {
      this.portalPoseCamera?.applyCameraDragIncrements(update.cameraDrag);
    }
  }

  private applyControllerPose(
    controller: XRController | undefined,
    pose: PortalPose,
  ) {
    if (!controller) {
      return;
    }
    controller.position.set(pose.position.x, pose.position.y, pose.position.z);
    controller.quaternion.set(
      pose.orientation.x,
      pose.orientation.y,
      pose.orientation.z,
      pose.orientation.w,
    );

    const handedness = controller.inputSource.handedness;
    if (handedness === XRHandedness.Left) {
      this.lastControllerPoseByHand.left = this.clonePortalPose(pose);
    } else if (handedness === XRHandedness.Right) {
      this.lastControllerPoseByHand.right = this.clonePortalPose(pose);
    }
  }

  private computeDualOffhandPose(
    activePose: PortalPose,
    headPose: { position: { x: number; y: number; z: number }; orientation: { x: number; y: number; z: number; w: number } },
    submode: 'mirrored' | 'opposed',
  ): PortalPose | null {
    const camQuat = quat.fromValues(
      headPose.orientation.x,
      headPose.orientation.y,
      headPose.orientation.z,
      headPose.orientation.w,
    );
    quat.normalize(camQuat, camQuat);

    const forward = vec3.fromValues(0, 0, -1);
    vec3.transformQuat(forward, forward, camQuat);
    if (vec3.length(forward) < 1e-5) {
      vec3.set(forward, 0, 0, -1);
    } else {
      vec3.normalize(forward, forward);
    }

    const worldUp = vec3.fromValues(0, 1, 0);
    const right = vec3.create();
    vec3.cross(right, worldUp, forward);
    if (vec3.length(right) < 1e-5) {
      vec3.set(right, 1, 0, 0);
    } else {
      vec3.normalize(right, right);
    }

    const up = vec3.create();
    vec3.cross(up, forward, right);
    if (vec3.length(up) < 1e-5) {
      vec3.set(up, 0, 1, 0);
    } else {
      vec3.normalize(up, up);
    }

    const diff = vec3.fromValues(
      activePose.position.x - headPose.position.x,
      activePose.position.y - headPose.position.y,
      activePose.position.z - headPose.position.z,
    );

    const xh = vec3.dot(diff, right);
    const yh = vec3.dot(diff, up);
    const zh = vec3.dot(diff, forward);

    if (submode !== 'opposed') {
      this.dualOpposedNeutral = null;
    }

    let neutral = this.dualOpposedNeutral;
    if (submode === 'opposed' && !neutral) {
      neutral = { y: yh, z: zh };
      this.dualOpposedNeutral = neutral;
    }

    const mirroredY =
      submode === 'opposed' && neutral ? 2 * neutral.y - yh : yh;
    const mirroredZ =
      submode === 'opposed' && neutral ? 2 * neutral.z - zh : zh;

    const mirroredDiff = vec3.create();
    vec3.scale(mirroredDiff, right, -xh);
    vec3.scaleAndAdd(mirroredDiff, mirroredDiff, up, mirroredY);
    vec3.scaleAndAdd(mirroredDiff, mirroredDiff, forward, mirroredZ);

    if (
      !Number.isFinite(mirroredDiff[0]) ||
      !Number.isFinite(mirroredDiff[1]) ||
      !Number.isFinite(mirroredDiff[2])
    ) {
      return this.clonePortalPose(activePose);
    }

    return {
      position: {
        x: headPose.position.x + mirroredDiff[0],
        y: headPose.position.y + mirroredDiff[1],
        z: headPose.position.z + mirroredDiff[2],
      },
      orientation: {
        x: activePose.orientation.x,
        y: activePose.orientation.y,
        z: activePose.orientation.z,
        w: activePose.orientation.w,
      },
    };
  }

  private updateCameraLockState(hand: 'left' | 'right', active: boolean, offset?: PortalPose): void {
    const state = this.cameraLockState[hand];
    if (active && offset) {
      state.active = true;
      state.offset = this.clonePortalPose(offset);
    } else {
      state.active = false;
      state.offset = makeIdentityPortalPose();
    }
    this.syncCameraLockToRuntime(hand);
  }

  private syncCameraLockToRuntime(hand: 'left' | 'right'): void {
    const runtime = this.portalControllerRuntime;
    if (!runtime) {
      return;
    }
    const state = this.cameraLockState[hand];
    if (state.active) {
      runtime.setCameraLock(hand, true, state.offset);
    } else {
      runtime.setCameraLock(hand, false);
    }
  }

  private syncAllCameraLocksToRuntime(): void {
    this.syncCameraLockToRuntime('left');
    this.syncCameraLockToRuntime('right');
  }

  private createCurrentHeadPortalPose(): PortalPose {
    return {
      position: {
        x: this.position.x,
        y: this.position.y,
        z: this.position.z,
      },
      orientation: {
        x: this.quaternion.x,
        y: this.quaternion.y,
        z: this.quaternion.z,
        w: this.quaternion.w,
      },
    };
  }

  private computeHeadRelativeOffset(headPose: PortalPose, controllerPose: PortalPose): PortalPose | null {
    const headQuat = quat.fromValues(
      headPose.orientation.x,
      headPose.orientation.y,
      headPose.orientation.z,
      headPose.orientation.w,
    );
    if (quat.length(headQuat) < 1e-5) {
      return null;
    }

    const headInv = quat.create();
    quat.invert(headInv, headQuat);

    const ctrlQuat = quat.fromValues(
      controllerPose.orientation.x,
      controllerPose.orientation.y,
      controllerPose.orientation.z,
      controllerPose.orientation.w,
    );

    const offsetQuat = quat.create();
    quat.multiply(offsetQuat, headInv, ctrlQuat);
    quat.normalize(offsetQuat, offsetQuat);

    const headPos = vec3.fromValues(
      headPose.position.x,
      headPose.position.y,
      headPose.position.z,
    );
    const ctrlPos = vec3.fromValues(
      controllerPose.position.x,
      controllerPose.position.y,
      controllerPose.position.z,
    );
    const delta = vec3.create();
    vec3.sub(delta, ctrlPos, headPos);
    vec3.transformQuat(delta, delta, headInv);

    return {
      position: { x: delta[0], y: delta[1], z: delta[2] },
      orientation: {
        x: offsetQuat[0],
        y: offsetQuat[1],
        z: offsetQuat[2],
        w: offsetQuat[3],
      },
    };
  }

  private clonePortalPose(pose: PortalPose): PortalPose {
    return {
      position: {
        x: pose.position.x,
        y: pose.position.y,
        z: pose.position.z,
      },
      orientation: {
        x: pose.orientation.x,
        y: pose.orientation.y,
        z: pose.orientation.z,
        w: pose.orientation.w,
      },
    };
  }

  private snapshotControllerPose(controller: XRController): PortalPose {
    return {
      position: {
        x: controller.position.x,
        y: controller.position.y,
        z: controller.position.z,
      },
      orientation: {
        x: controller.quaternion.x,
        y: controller.quaternion.y,
        z: controller.quaternion.z,
        w: controller.quaternion.w,
      },
    };
  }

  private updateCanvasZoomTransform(): void {
    const baseFov = this.baseCanvasFovRad;
    const currentFov = this[P_DEVICE].fovy;
    if (!Number.isFinite(baseFov) || baseFov <= 0) {
      this.applyCanvasZoomScale(1);
      return;
    }
    if (!Number.isFinite(currentFov) || currentFov <= 0) {
      this.applyCanvasZoomScale(1);
      return;
    }
    const numerator = Math.tan(baseFov / 2);
    const denominator = Math.tan(currentFov / 2);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || Math.abs(denominator) < 1e-6) {
      this.applyCanvasZoomScale(1);
      return;
    }
    const scale = numerator / denominator;
    if (!Number.isFinite(scale) || scale <= 0) {
      this.applyCanvasZoomScale(1);
      return;
    }
    this.applyCanvasZoomScale(scale);
  }

  private applyCanvasZoomScale(scale: number, force = false): void {
    const canvasData = this[P_DEVICE].canvasData;
    if (!canvasData) {
      return;
    }

    const devui = this[P_DEVICE].devui;
    const sem = this[P_DEVICE].sem;

    const targets: HTMLElement[] = [canvasData.canvas];
    if (devui) {
      targets.push(devui.devUICanvas);
      targets.push(devui.devUIContainer);
    }
    if (sem) {
      targets.push(sem.environmentCanvas);
    }

    const normalizedScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    if (!force && Math.abs(normalizedScale - this.lastCanvasZoomScale) < 1e-4) {
      return;
    }

    this.lastCanvasZoomScale = normalizedScale;

    const useTransform = Math.abs(normalizedScale - 1) > 1e-4;
    const transformValue = useTransform ? `scale(${normalizedScale})` : '';

    for (const element of targets) {
      if (!element) {
        continue;
      }
      element.style.transformOrigin = '50% 50%';
      if (useTransform) {
        element.style.transform = transformValue;
      } else {
        element.style.removeProperty('transform');
      }
    }
  }

  private getActiveFullscreenElement(): Element | null {
    if (typeof document === 'undefined') {
      return null;
    }
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      mozFullScreenElement?: Element | null;
      msFullscreenElement?: Element | null;
    };
    return (
      doc.fullscreenElement ??
      doc.webkitFullscreenElement ??
      doc.mozFullScreenElement ??
      doc.msFullscreenElement ??
      null
    );
  }

  private ensureFullscreenForImmersiveSession(): void {
    if (typeof document === 'undefined') {
      return;
    }
    const session = this.activeSession;
    if (!session || session[P_SESSION].mode !== 'immersive-vr') {
      return;
    }
    if (!this[P_DEVICE].immersiveFullscreenEnabled) {
      return;
    }
    const container = this[P_DEVICE].canvasContainer;
    if (this.getActiveFullscreenElement() === container) {
      return;
    }

    const anyContainer = container as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
      mozRequestFullScreen?: () => Promise<void>;
      msRequestFullscreen?: () => Promise<void>;
    };

    const requestFullscreen =
      anyContainer.requestFullscreen ??
      anyContainer.webkitRequestFullscreen ??
      anyContainer.mozRequestFullScreen ??
      anyContainer.msRequestFullscreen;

    if (!requestFullscreen) {
      return;
    }

    try {
      const result = requestFullscreen.call(anyContainer);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((error) => {
          console.warn(
            '[XRDevice] Failed to enter fullscreen for immersive session',
            error,
          );
        });
      }
    } catch (error) {
      console.warn(
        '[XRDevice] Failed to enter fullscreen for immersive session',
        error,
      );
    }
  }

  private exitFullscreenForImmersiveSession(): void {
    if (typeof document === 'undefined') {
      return;
    }
    const container = this[P_DEVICE].canvasContainer;
    if (this.getActiveFullscreenElement() !== container) {
      return;
    }

    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void>;
      mozCancelFullScreen?: () => Promise<void>;
      msExitFullscreen?: () => Promise<void>;
    };

    const exitFullscreen =
      doc.exitFullscreen ??
      doc.webkitExitFullscreen ??
      doc.mozCancelFullScreen ??
      doc.msExitFullscreen;

    if (!exitFullscreen) {
      return;
    }

    try {
      const result = exitFullscreen.call(doc);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((error) => {
          console.warn(
            '[XRDevice] Failed to exit fullscreen after immersive session',
            error,
          );
        });
      }
    } catch (error) {
      console.warn(
        '[XRDevice] Failed to exit fullscreen after immersive session',
        error,
      );
    }
  }

  private resetCanvasZoomTransform(): void {
    this.applyCanvasZoomScale(1, true);
  }

  private shouldRunFaceTrackingForSession(session: XRSession): boolean {
    return this[P_DEVICE].faceTrackingEnabled && this.isImmersiveSession(session);
  }

  private isImmersiveSession(session: XRSession): boolean {
    const mode = session[P_SESSION].mode;
    return mode === 'immersive-vr' || mode === 'immersive-ar';
  }

  private applyConfigSettings(config: PortalEmulatorConfig): void {
    const nextStereoEnabled = Boolean(config.settings?.stereoRenderingEnabled);
    if (nextStereoEnabled !== this[P_DEVICE].stereoEnabled) {
      this.stereoEnabled = nextStereoEnabled;
    }
    const nextFaceTrackingEnabled = config.settings?.faceTrackingEnabled !== false;
    if (nextFaceTrackingEnabled !== this[P_DEVICE].faceTrackingEnabled) {
      this.faceTrackingEnabled = nextFaceTrackingEnabled;
    }
    const nextFullscreenEnabled = config.settings?.immersiveFullscreenEnabled !== false;
    if (nextFullscreenEnabled !== this[P_DEVICE].immersiveFullscreenEnabled) {
      this[P_DEVICE].immersiveFullscreenEnabled = nextFullscreenEnabled;
      const session = this.activeSession;
      if (session && this.isImmersiveSession(session)) {
        if (nextFullscreenEnabled) {
          this.ensureFullscreenForImmersiveSession();
        } else {
          this.exitFullscreenForImmersiveSession();
        }
      }
    }
  }

  private cancelWebRTCVisibilitySuspendTimer(): void {
    if (this.webrtcVisibilitySuspendTimer) {
      clearTimeout(this.webrtcVisibilitySuspendTimer);
      this.webrtcVisibilitySuspendTimer = null;
    }
  }

  private scheduleWebRTCVisibilitySuspend(): void {
    if (this.webrtcVisibilitySuspendTimer || !this.webrtcStreamer) {
      return;
    }
    this.webrtcVisibilitySuspendTimer = setTimeout(() => {
      this.webrtcVisibilitySuspendTimer = null;
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        return;
      }
      this.suspendWebRTCStreamingForVisibility();
    }, WEBRTC_VISIBILITY_SUSPEND_DELAY_MS);
  }

  private suspendWebRTCStreamingForVisibility(): void {
    if (!this.webrtcStreamer || this.webrtcSuspendedForVisibility) {
      return;
    }
    this.webrtcSuspendedForVisibility = true;
    this.webrtcStreamer.dispose();
    this.webrtcStreamer = null;
    this.lastImmersiveSessionForWebRTC = null;
  }

  private resumeWebRTCStreamingAfterVisibility(): void {
    if (!this.webrtcSuspendedForVisibility) {
      return;
    }
    this.webrtcSuspendedForVisibility = false;
    if (this.webrtcStreamOptions) {
      this.enableWebRTCControllerStreaming(this.webrtcStreamOptions);
    } else {
      this.ensureDefaultWebRTCStreamer();
    }
    const session = this.activeSession;
    if (session) {
      this.lastImmersiveSessionForWebRTC = null;
      this.ensureDefaultWebRTCStreamerForSession(session);
    }
  }

  private ensureDefaultWebRTCStreamerForSession(session: XRSession): void {
    if (this.webrtcVisibilitySuspended) {
      return;
    }
    if (!this.isImmersiveSession(session)) {
      return;
    }
    if (this.lastImmersiveSessionForWebRTC === session) {
      return;
    }
    if (!this.webrtcStreamer) {
      this.ensureDefaultWebRTCStreamer();
    }
    if (this.webrtcStreamer) {
      this.lastImmersiveSessionForWebRTC = session;
    }
  }

  private updateFaceTrackingForSession(session: XRSession): void {
    if (!this.shouldRunFaceTrackingForSession(session)) {
      this.stopFaceTracking();
      return;
    }
    if (this.faceTrackingVisibilitySuspended) {
      this.stopFaceTracking();
      return;
    }
    this.ensureFaceTracking();
    this.updateFaceTrackingSmoothing(getNowMs());
  }

  private ensureFaceTracking(): void {
    if (this.faceTrackingVisibilitySuspended) {
      return;
    }
	if (!this[P_DEVICE].faceTrackingEnabled) {
		return;
	}
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      this.faceTrackingVisibilitySuspended = true;
      return;
    }
    if (this.faceTracker || this.faceTrackingStartPromise || this.faceTrackingPermissionRejected) {
      return;
    }
    if (typeof navigator === 'undefined' || typeof document === 'undefined') {
      this.faceTrackingPermissionRejected = true;
      return;
    }
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
      this.faceTrackingPermissionRejected = true;
      return;
    }

    this.faceTrackingStartPromise = this.startFaceTracking()
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.warn('[XRDevice] face tracking unavailable', error);
      })
      .finally(() => {
        this.faceTrackingStartPromise = null;
      });
  }

  private async requestFaceTrackingStream(): Promise<MediaStream> {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
      throw new Error('Media devices are unavailable');
    }

    let lastError: unknown = null;
    for (const preset of FACE_TRACKING_RESOLUTIONS) {
      try {
        return await mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: preset.width },
            height: { ideal: preset.height },
            frameRate: { ideal: 60, max: 120 },
          },
          audio: false,
        });
      } catch (error) {
        lastError = error;
      }
    }

    try {
      return await mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          frameRate: { ideal: 60, max: 120 },
        },
        audio: false,
      });
    } catch (error) {
      lastError = error;
    }

    throw lastError ?? new Error('Unable to acquire face-tracking camera stream');
  }

  private async startFaceTracking(): Promise<void> {
	if (!this[P_DEVICE].faceTrackingEnabled) {
		return;
	}
    if (this.faceTrackingVisibilitySuspended) {
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      this.faceTrackingVisibilitySuspended = true;
      return;
    }
    if (this.faceTracker || this.faceTrackingPermissionRejected) {
      return;
    }
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
      this.faceTrackingPermissionRejected = true;
      return;
    }

    let stream: MediaStream;
    try {
      stream = await this.requestFaceTrackingStream();
    } catch (error) {
      const name = (error as DOMException | undefined)?.name;
      if (name === 'NotAllowedError' || name === 'NotFoundError' || name === 'NotReadableError') {
        this.faceTrackingPermissionRejected = true;
      }
      throw error;
    }

    if (typeof document === 'undefined') {
      stream.getTracks().forEach((track) => track.stop());
      this.faceTrackingPermissionRejected = true;
      return;
    }

    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.style.position = 'fixed';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.transform = 'translate(-10000px, -10000px)';
    video.srcObject = stream;
    const parent = document.body ?? document.documentElement;
    parent?.appendChild(video);

    try {
      await video.play();
    } catch {
      // Some browsers require a user gesture for play; best effort only.
    }

    const tracker = new FaceTracker({
      hfovDeg: FACE_TRACKER_HFOV_DEG,
      wasmPath: FACE_TRACKER_WASM_PATH,
      modelAssetPath: FACE_TRACKER_MODEL_PATH,
      smooth: { ...FACE_TRACKER_SMOOTH_DEFAULT },
      distanceSmoothingBase: FACE_TRACKER_DISTANCE_BASE,
    });
    tracker.setFiltering({ ...FACE_TRACKER_SMOOTH_DEFAULT });
    this.faceTrackerUnsubscribe = tracker.onUpdate(this.handleFaceTrackerUpdate);

    try {
      await tracker.start(video);
    } catch (error) {
      this.faceTrackerUnsubscribe?.();
      this.faceTrackerUnsubscribe = null;
      tracker.stop();
      if (video.parentElement) {
        video.parentElement.removeChild(video);
      }
      video.srcObject = null;
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }

    if (
      this.faceTrackingVisibilitySuspended ||
      (typeof document !== 'undefined' && document.visibilityState !== 'visible')
    ) {
      this.faceTrackerUnsubscribe?.();
      this.faceTrackerUnsubscribe = null;
      tracker.stop();
      if (video.parentElement) {
        video.parentElement.removeChild(video);
      }
      video.srcObject = null;
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore track stop failures
        }
      });
      return;
    }

    this.faceTracker = tracker;
    this.faceTrackerVideoEl = video;
    this.faceTrackerStream = stream;
    this.faceTrackingReference = null;
    vec3.set(this.faceTrackingTarget, 0, 0, 0);
    vec3.set(this.faceTrackingLocalOffset, 0, 0, 0);
    this.faceTrackingLastFrameMs = 0;
  }

  private stopFaceTracking(): void {
    this.faceTracker?.stop();
    this.faceTracker = null;
    this.faceTrackerUnsubscribe?.();
    this.faceTrackerUnsubscribe = null;
    if (this.faceTrackerVideoEl) {
      try {
        this.faceTrackerVideoEl.pause();
      } catch {
        // ignore pause failures
      }
      if (this.faceTrackerVideoEl.parentElement) {
        this.faceTrackerVideoEl.parentElement.removeChild(this.faceTrackerVideoEl);
      }
      this.faceTrackerVideoEl.srcObject = null;
      this.faceTrackerVideoEl = null;
    }
    if (this.faceTrackerStream) {
      this.faceTrackerStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore track stop failures
        }
      });
      this.faceTrackerStream = null;
    }
    this.faceTrackingReference = null;
    vec3.set(this.faceTrackingTarget, 0, 0, 0);
    vec3.set(this.faceTrackingLocalOffset, 0, 0, 0);
    this.faceTrackingLastFrameMs = 0;
  }

  private updateFaceTrackingSmoothing(nowMs: number): void {
    if (!Number.isFinite(nowMs)) {
      return;
    }
    if (this.faceTrackingLastFrameMs === 0) {
      this.faceTrackingLastFrameMs = nowMs;
      vec3.copy(this.faceTrackingOffset, this.faceTrackingTarget);
      return;
    }
    const dtMs = Math.max(nowMs - this.faceTrackingLastFrameMs, 0);
    this.faceTrackingLastFrameMs = nowMs;
    const alpha =
      dtMs <= 0
        ? 1
        : Math.max(
            0,
            Math.min(1, 1 - Math.exp(-dtMs / Math.max(FACE_TRACK_SMOOTHING_TAU_MS, 1e-3))),
          );
    vec3.lerp(
      this.faceTrackingOffset,
      this.faceTrackingOffset,
      this.faceTrackingTarget,
      alpha,
    );
  }

  private handleFaceTrackerUpdate = (output: FaceTrackerOutputs): void => {
    const frameTimestampMs = Number.isFinite(output.timestampMs) ? output.timestampMs : getNowMs();

    if (!output.faceVisible || !output.eyeCenterCm) {
      this.faceTrackingReference = null;
      vec3.set(this.faceTrackingTarget, 0, 0, 0);
      vec3.set(this.faceTrackingLocalOffset, 0, 0, 0);
      return;
    }

    if (this.faceTrackingRecenterPending) {
      this.faceTrackingReference = {
        x: output.eyeCenterCm.x,
        y: output.eyeCenterCm.y,
        z: output.eyeCenterCm.z,
      };
      vec3.set(this.faceTrackingLocalOffset, 0, 0, 0);
      vec3.set(this.faceTrackingTarget, 0, 0, 0);
      vec3.set(this.faceTrackingOffset, 0, 0, 0);
      this.faceTrackingLastFrameMs = frameTimestampMs;
      this.faceTrackingRecenterPending = false;
      return;
    }

    if (!this.faceTrackingReference) {
      this.faceTrackingReference = {
        x: output.eyeCenterCm.x,
        y: output.eyeCenterCm.y,
        z: output.eyeCenterCm.z,
      };
    }

    const dxMeters =
      (output.eyeCenterCm.x - this.faceTrackingReference.x) / 100;
    const dyMeters =
      (output.eyeCenterCm.y - this.faceTrackingReference.y) / 100;

    vec3.set(
      this.faceTrackingLocalOffset,
      clampFaceOffset(dxMeters),
      clampFaceOffset(dyMeters),
      0,
    );
    vec3.transformQuat(
      this.faceTrackingTarget,
      this.faceTrackingLocalOffset,
      this[P_DEVICE].quaternion.quat,
    );
  };

  enablePortalPoseCamera(options?: PortalPoseCameraOptions) {
    const nextOptions = {
      ...(options ?? this.portalPoseCameraOptions ?? {}),
    } as PortalPoseCameraOptions;
    this.portalPoseCameraOptions = nextOptions;
    this.portalPoseCamera?.dispose();
    this.portalPoseCamera = new PortalPoseCameraController(this, nextOptions);
  }

  disablePortalPoseCamera() {
    this.portalPoseCamera?.dispose();
    this.portalPoseCamera = null;
  }

  enableWebRTCControllerStreaming(options?: WebRTCControllerStreamOptions) {
    const nextOptions = {
      ...(options ?? this.webrtcStreamOptions ?? {}),
    } as WebRTCControllerStreamOptions;
    if (!nextOptions.roomId) {
      nextOptions.roomId = this.portalDeviceId;
    }
    this.webrtcStreamOptions = nextOptions;
    this.handleControllerConnectionChange(false);
    this.webrtcStreamer?.dispose();
    const userOnState = nextOptions.onControllerState;
    const userOnConnection = nextOptions.onConnectionChange;
    const userOnOrientationReset = nextOptions.onOrientationReset;
    this.webrtcStreamer = new WebRTCControllerStreamer({
      ...nextOptions,
      onControllerState: (state) => {
        void this.handleControllerState(state);
        userOnState?.(state);
      },
      onConnectionChange: (connected) => {
        this.handleControllerConnectionChange(connected);
        userOnConnection?.(connected);
      },
      onOrientationReset: () => {
        this.handleOrientationReset();
        userOnOrientationReset?.();
      },
    });
  }

  disableWebRTCControllerStreaming() {
    this.cancelWebRTCVisibilitySuspendTimer();
    this.webrtcSuspendedForVisibility = false;
    this.webrtcStreamer?.dispose();
    this.webrtcStreamer = null;
    this.handleControllerConnectionChange(false);
  }

  private ensureDefaultWebRTCStreamer() {
    if (this.webrtcStreamer) {
      return;
    }
    const opts = resolveDefaultWebRTCStreamOptions();
    if (!opts) {
      return;
    }
    this.enableWebRTCControllerStreaming(opts);
  }
}
