import type { OpDrone } from "../../sim/operator";

const toRad = Math.PI / 180;

export function bearing(a: [number, number], b: [number, number]): number {
  const y = Math.sin((b[0] - a[0]) * toRad) * Math.cos(b[1] * toRad);
  const x = Math.cos(a[1] * toRad) * Math.sin(b[1] * toRad) - Math.sin(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.cos((b[0] - a[0]) * toRad);
  return (Math.atan2(y, x) / toRad + 360) % 360;
}

/** Where to draw a drone and which way it faces. On scene it orbits the call (display only). */
export function dronePose(d: OpDrone): { pos: [number, number]; heading: number; orbitAngle: number | null } {
  if (d.phase === "onscene") {
    const r = (d.ac.orbitRadiusM ?? 45) / 111320;
    const a = (d.phaseT / 50) * 2 * Math.PI; // one orbit every 50 sim-seconds
    const pos: [number, number] = [d.pos[0] + (r * Math.sin(a)) / Math.cos(d.pos[1] * toRad), d.pos[1] + r * Math.cos(a)];
    return { pos, heading: ((a / toRad) + 90) % 360, orbitAngle: a / toRad };
  }
  const target = d.phase === "returning" || d.phase === "landing" ? d.home : d.target ?? d.home;
  const heading = target[0] === d.pos[0] && target[1] === d.pos[1] ? 0 : bearing(d.pos, target);
  return { pos: d.pos, heading, orbitAngle: null };
}
