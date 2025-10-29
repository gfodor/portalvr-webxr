/**
 * Simple hook implementations that log every frame.
 * Useful for verifying hook wiring before integrating real telemetry streams.
 */

import { XRDevice, XRDeviceHooks } from '../device/XRDevice.js';
import { XRFrame } from '../frameloop/XRFrame.js';
import { XRTrackedInput } from '../device/XRTrackedInput.js';

const formatVector = (values: { x: number; y: number; z: number }) =>
  `(${values.x.toFixed(3)}, ${values.y.toFixed(3)}, ${values.z.toFixed(3)})`;

const formatQuaternion = (values: {
  x: number;
  y: number;
  z: number;
  w: number;
}) =>
  `(${values.x.toFixed(3)}, ${values.y.toFixed(3)}, ${values.z.toFixed(
    3,
  )}, ${values.w.toFixed(3)})`;

const loggingHooks: XRDeviceHooks = {
  onHeadPose(device: XRDevice, frame: XRFrame) {
    console.log(
      `[IWER hooks] head pose @${frame.predictedDisplayTime.toFixed(
        2,
      )}ms | position=${formatVector(
        device.position,
      )} quaternion=${formatQuaternion(device.quaternion)}`,
    );
  },
  onControllerPose(input: XRTrackedInput, frame: XRFrame) {
    console.log(
      `[IWER hooks] controller pose ${input.inputSource.handedness} @${frame.predictedDisplayTime.toFixed(
        2,
      )}ms | position=${formatVector(input.position)}`,
    );
  },
  onControllerButtons(input: XRTrackedInput, frame: XRFrame) {
    console.log(
      `[IWER hooks] controller buttons ${input.inputSource.handedness} @${frame.predictedDisplayTime.toFixed(
        2,
      )}ms`,
    );
  },
};

export { loggingHooks };
