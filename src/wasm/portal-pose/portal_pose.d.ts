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
  // State lifecycle
  _portal_wasm_pose_state_size(): number;
  _portal_wasm_pose_state_alignment(): number;
  _portal_wasm_pose_state_init(statePtr: number): void;
  _portal_wasm_pose_state_reset(statePtr: number): void;

  // Controller-level toggle
  _portal_wasm_controller_set_drag_button_active(active: number): void;

  // Pose update
  _portal_wasm_pose_update(inputsPtr: number, statePtr: number, resultPtr: number): void;
  // Display-lock helpers
  _portal_wasm_pose_state_update_camera_locked_pose(
    statePtr: number,
    hand: number,
    headPosePtr: number,
    currentPosePtr: number,
    outPosePtr: number,
  ): number;
  _portal_wasm_pose_state_compute_display_delta(
    statePtr: number,
    ctrlPosePtr: number,
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
  // Camera-drag helpers
  _portal_wasm_camera_drag_state_create(): number;
  _portal_wasm_camera_drag_state_destroy(statePtr: number): void;
  _portal_wasm_camera_drag_state_reset(statePtr: number): void;
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

  // Session orchestration (multi-hand portal_controller_session)
  _portal_wasm_controller_session_create(numHands: number): number;
  _portal_wasm_controller_session_get_hand_state(sessionPtr: number, handEnum: number): number;
  _portal_wasm_controller_session_apply_tuning(sessionPtr: number, tuningPtr: number): void;
  _portal_wasm_controller_session_set_roll_config(sessionPtr: number, rollCfgPtr: number): void;
  _portal_wasm_controller_session_update_alt_hand_offsets(
    sessionPtr: number,
    cfgPtr: number,
  ): void;
  _portal_wasm_controller_session_set_aim_hand_config(sessionPtr: number, cfgPtr: number): void;
  _portal_wasm_controller_session_apply_display_lock_calibration(
    sessionPtr: number,
    calPtr: number,
  ): void;
  _portal_wasm_controller_session_clear_display_lock(sessionPtr: number): void;
  _portal_wasm_dual_mode_synthesize_secondary_pose(
    sessionPtr: number,
    dualMode: number,
    headPosePtr: number,
    primaryHandEnum: number,
    primaryPosePtr: number,
    secondaryHandEnum: number,
    outSecondaryPosePtr: number,
  ): number;
  _portal_wasm_controller_session_submit_sample(
    sessionPtr: number,
    sampleInPtr: number,
    sampleOutPtr: number,
  ): number;

  // Controller smoother control APIs (per-hand)
  _portal_wasm_controller_session_set_ctrl_smoother_mode(
    sessionPtr: number,
    handEnum: number,
    mode: number,
  ): void;
  _portal_wasm_controller_session_reset_ctrl_smoother(
    sessionPtr: number,
    handEnum: number,
  ): void;
  _portal_wasm_controller_session_translate_ctrl_smoother(
    sessionPtr: number,
    handEnum: number,
    dx: number,
    dy: number,
    dz: number,
  ): void;
  _portal_wasm_controller_session_predict_ctrl_pose(
    sessionPtr: number,
    handEnum: number,
    nowNsLow: number,
    nowNsHigh: number,
    outPosePtr: number,
  ): number;

  // Pose-state setters (parity with native portal_pose_state_*)
  _portal_wasm_pose_state_set_roll_config(statePtr: number, rollCfgPtr: number): void;
  _portal_wasm_pose_state_set_delta_target(
    statePtr: number,
    valid: number,
    deltaPosePtr: number,
  ): void;
  _portal_wasm_pose_state_set_camera_lock(
    statePtr: number,
    handEnum: number,
    valid: number,
    offsetPosePtr: number,
  ): void;
  _portal_wasm_pose_state_set_fov_defaults(
    statePtr: number,
    headDeg: number,
    stretchDeg: number,
    aimDeg: number,
  ): void;
  _portal_wasm_pose_state_set_arm_params(
    statePtr: number,
    maxArmDistanceM: number,
    stretchMinDistM: number,
    stretchLerpRangeM: number,
    armScaling: number,
    torsoProportion: number,
  ): void;
  _portal_wasm_pose_state_capture_camera_lock_from_world(
    statePtr: number,
    handEnum: number,
    headPoseWorldPtr: number,
    ctrlPoseWorldPtr: number,
  ): void;
  _portal_wasm_pose_state_set_rel_offset(
    statePtr: number,
    handEnum: number,
    valid: number,
    offsetHeadPtr: number,
  ): void;

  // Alt-hand spawn helper
  _portal_wasm_compute_alt_hand_spawn_offset(
    headPosePtr: number,
    baselineMeters: number,
    outOffsetPtr: number,
  ): void;

  // Camera-drag stretch tuning (parity with Android)
  _portal_wasm_camera_drag_apply_stretch_params(
    dragStatePtr: number,
    stretchMinDistM: number,
    stretchLerpRangeM: number,
    armScaling: number,
  ): void;
}

export default function PortalPoseModule(
  config?: PortalPoseModuleConfig,
): Promise<PortalPoseModuleInstance>;
