/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import './runtime/RuntimeAssetResolver.js';

// runtime helpers
export {
  getRuntimeAssetBaseUrl,
  resolveRuntimeAssetUrl,
  setRuntimeAssetBaseUrl,
} from './runtime/RuntimeAssetResolver.js';

// shared portal config storage
export {
  getOrCreateRuntimeConfig,
  persistStoredConfig,
  readStoredConfig,
} from './context/shared.js';

// model
export { XRDevice, XRDeviceConfig } from './device/XRDevice.js';
export {
  PORTAL_CONFIG_STORAGE_KEY,
  PORTAL_CONFIG_OVERRIDE_GLOBAL,
  getPortalEmulatorConfig,
  updatePortalEmulatorConfig,
} from './device/PortalEmulatorConfig.js';
export type { PortalEmulatorConfig, CameraDragHand } from './device/PortalEmulatorConfig.js';
export {
	metaQuest2,
	metaQuest3,
	metaQuestPro,
	oculusQuest1,
} from './device/configs/headset/meta.js';
export { XRTrackedInput } from './device/XRTrackedInput.js';
export { XRController } from './device/XRController.js';
export {
  PortalPoseCameraController,
  type PortalPoseCameraOptions,
} from './head/PortalPoseCameraController.js';
export {
  WebRTCControllerStreamer,
  type WebRTCControllerStreamOptions,
} from './webrtc/WebRTCControllerStreamer.js';
export type { SIGCFStatusSnapshot } from './webrtc/sigcf.js';
export type { ControllerState } from './webrtc/controllerParser.js';
export {
  AdbControllerStreamer,
  type AdbControllerStreamOptions,
} from './adb/AdbControllerStreamer.js';
export {
  AdbControllerTransport,
  type AdbTransportOptions,
  type AdbTransportStats,
} from './adb/AdbControllerTransport.js';

// Initialization
export { XRSystem } from './initialization/XRSystem.js';

// Session
export { XRRenderState } from './session/XRRenderState.js';
export { XRSession } from './session/XRSession.js';

// Frame Loop
export { XRFrame } from './frameloop/XRFrame.js';

// Spaces
export { XRSpace } from './spaces/XRSpace.js';
export { XRReferenceSpace } from './spaces/XRReferenceSpace.js';
export { XRJointSpace } from './spaces/XRJointSpace.js';

// Views
export { XRView } from './views/XRView.js';
export { XRViewport } from './views/XRViewport.js';

// Primitives
export { XRRigidTransform } from './primitives/XRRigidTransform.js';

// Pose
export { XRPose } from './pose/XRPose.js';
export { XRViewerPose } from './pose/XRViewerPose.js';
export { XRJointPose } from './pose/XRJointPose.js';

// Input
export { XRInputSource, XRInputSourceArray } from './input/XRInputSource.js';
export { XRHand } from './input/XRHand.js';

// Layers
export { XRWebGLLayer, XRLayer } from './layers/XRWebGLLayer.js';

// Planes
export { XRPlane, XRPlaneSet, NativePlane } from './planes/XRPlane.js';

// Meshes
export { XRMesh, XRMeshSet, NativeMesh } from './meshes/XRMesh.js';
export { XRSemanticLabels } from './labels/labels.js';

// Anchors
export { XRAnchor, XRAnchorSet } from './anchors/XRAnchor.js';

// Hit Test
export { XRRay } from './hittest/XRRay.js';

// Events
export { XRSessionEvent } from './events/XRSessionEvent.js';
export { XRInputSourceEvent } from './events/XRInputSourceEvent.js';
export { XRInputSourcesChangeEvent } from './events/XRInputSourcesChangeEvent.js';
export { XRReferenceSpaceEvent } from './events/XRReferenceSpaceEvent.js';

// Private Keys
export * from './private.js';

// Standalone bootstrap helpers
export {
  bootstrapStandaloneEmulator,
  ensureStandaloneSurfaceInitialized,
  getStandaloneState,
} from './standalone.js';
export type { StandaloneOptions } from './standalone.js';
export { portalConfigProvider } from './config/PortalConfigProvider.js';
