export interface PortalPoseModuleConfig {
  locateFile?: (path: string, prefix?: string) => string;
}

export interface PortalPoseModuleInstance {
  HEAP8: Int8Array;
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  HEAPU16: Uint16Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _portal_wasm_state_size(): number;
  _portal_wasm_state_alignment(): number;
  _portal_wasm_state_init(statePtr: number): void;
  _portal_wasm_state_reset(statePtr: number): void;
  _portal_wasm_set_roll_config(
    statePtr: number,
    amplify: number,
    zeroOffsetDeg: number,
    startDeg: number,
  ): void;
  _portal_wasm_set_alt_hand_offset(
    statePtr: number,
    valid: number,
    offsetPtr: number,
  ): void;
  _portal_wasm_set_delta_target(
    statePtr: number,
    valid: number,
    deltaPtr: number,
  ): void;
  _portal_wasm_set_display_lock_calibration(
    statePtr: number,
    headPtr: number,
    ctrlPtr: number,
    anchorMeters: number,
  ): void;
  _portal_wasm_set_fov_defaults(
    statePtr: number,
    headDeg: number,
    stretchDeg: number,
    aimDeg: number,
  ): void;
  _portal_wasm_set_arm_params(
    statePtr: number,
    maxArmDistance: number,
    stretchMinDist: number,
    stretchLerpRange: number,
    armScaling: number,
    torsoProportion: number,
  ): void;
  _portal_wasm_get_camera_fov_deg(statePtr: number): number;
  _portal_wasm_update(inputsPtr: number, statePtr: number, resultPtr: number): void;
  _portal_wasm_compute_display_delta(
    statePtr: number,
    controllerPosePtr: number,
    outDeltaPtr: number,
  ): number;
  _portal_wasm_head_offset_calculate_nudge_delta(
    dx: number,
    dy: number,
    dz: number,
    smoothedQuatPtr: number,
    yawOffsetRad: number,
    pitchOffsetRad: number,
    cameraPitchRad: number,
    cameraPitchSin: number,
    fixedDisplayLocked: number,
    outDeltaPtr: number,
  ): number;
  _portal_wasm_head_compose_final_pose(
    smoothedPosPtr: number,
    smoothedQuatPtr: number,
    yawOffsetRad: number,
    pitchOffsetRad: number,
    uiOffsetPtr: number,
    outPosePtr: number,
  ): void;
  _portal_wasm_head_calculate_yaw_nudge(
    currentYawRad: number,
    currentOffsetPtr: number,
    dYawRad: number,
    smoothedPosPtr: number,
    finalPosePosPtr: number,
    yMin: number,
    yMax: number,
    outNewYawPtr: number,
    outAdjustDeltaPtr: number,
  ): number;
  _portal_wasm_head_compose_final_pose(
    smoothedPosPtr: number,
    smoothedQuatPtr: number,
    yawOffsetRad: number,
    pitchOffsetRad: number,
    uiOffsetPtr: number,
    outPosePtr: number,
  ): void;
  _portal_wasm_camera_drag_state_create(): number;
  _portal_wasm_camera_drag_state_destroy(statePtr: number): void;
  _portal_wasm_camera_drag_reset(statePtr: number): void;
  _portal_wasm_camera_drag_set_display_delta_cb(
    statePtr: number,
    callbackPtr: number,
    userDataPtr: number,
  ): void;
  _portal_wasm_camera_drag_begin(
    statePtr: number,
    baseCtrlPosPtr: number,
    baseCtrlQuatPtr: number,
    baseCamQuatPtr: number,
    baseYawRad: number,
    mode: number,
  ): void;
  _portal_wasm_camera_drag_compute(
    statePtr: number,
    curCtrlPosPtr: number,
    curCtrlQuatPtr: number,
    nowSeconds: number,
    outIncrementsPtr: number,
  ): number;
  _portal_wasm_camera_drag_end(statePtr: number): void;
}

export default function PortalPoseModule(
  config?: PortalPoseModuleConfig,
): Promise<PortalPoseModuleInstance>;
