export function quatToLog(qx: number, qy: number, qz: number, qw: number): [number, number, number] {
  const w = Math.min(1, Math.max(-1, qw));
  const angle = 2 * Math.acos(w);
  const s = Math.sqrt(Math.max(1e-12, 1 - w * w));
  if (angle < 1e-6 || s < 1e-6) {
    return [0, 0, 0];
  }
  return [(qx / s) * angle, (qy / s) * angle, (qz / s) * angle];
}

export function logToQuat(rx: number, ry: number, rz: number): [number, number, number, number] {
  const angle = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (angle < 1e-6) {
    return [0, 0, 0, 1];
  }
  const axisX = rx / angle;
  const axisY = ry / angle;
  const axisZ = rz / angle;
  const half = 0.5 * angle;
  const sinHalf = Math.sin(half);
  return [axisX * sinHalf, axisY * sinHalf, axisZ * sinHalf, Math.cos(half)];
}
