export interface ControllerNeutralDegrees {
	rollDeg: number;
	pitchDeg: number;
	yawDeg: number;
}

export const CONTROLLER_NEUTRAL_DEFAULTS: ControllerNeutralDegrees = {
	rollDeg: 0,
	pitchDeg: 0,
	yawDeg: 0,
};

export const CONTROLLER_NEUTRAL_MIN_DEG = -180;
export const CONTROLLER_NEUTRAL_MAX_DEG = 180;
export const CONTROLLER_NEUTRAL_STEP_DEG = 5;

export function clampControllerNeutralDeg(value: unknown, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(
		CONTROLLER_NEUTRAL_MAX_DEG,
		Math.max(CONTROLLER_NEUTRAL_MIN_DEG, value),
	);
}

export function normalizeControllerNeutralDegrees(
	candidate: Partial<ControllerNeutralDegrees> | null | undefined,
	fallback: ControllerNeutralDegrees = CONTROLLER_NEUTRAL_DEFAULTS,
): ControllerNeutralDegrees {
	return {
		rollDeg: clampControllerNeutralDeg(candidate?.rollDeg, fallback.rollDeg),
		pitchDeg: clampControllerNeutralDeg(candidate?.pitchDeg, fallback.pitchDeg),
		yawDeg: clampControllerNeutralDeg(candidate?.yawDeg, fallback.yawDeg),
	};
}
