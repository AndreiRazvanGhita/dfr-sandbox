// Camera director for the simulation: what to frame for a target, and smooth per-frame motion toward it.

import { haversineM } from "../../sim/geo";
import { droneOf, type OpState } from "../../sim/operator";
import { bearing, dronePose } from "./pose";

export type CamMode = "auto" | "lock" | "free";
export type CamTarget = { kind: "call"; id: number } | { kind: "drone"; id: string } | { kind: "overview" };

export interface Shot {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number | "orbit"; // "orbit": keep turning slowly around the center
}

export const OVERVIEW: Shot = { center: [-122.432, 37.762], zoom: 12.5, pitch: 30, bearing: 0 };

/** Zoom at which distM spans about `frac` of the viewport height. */
function zoomToFit(distM: number, lat: number, viewH: number, frac = 0.45): number {
  const mPerPx = Math.max(distM, 150) / (viewH * frac);
  const z = Math.log2((156543.03 * Math.cos((lat * Math.PI) / 180)) / mPerPx);
  return Math.max(12.5, Math.min(16.3, z));
}

/** The shot for a target: a waiting call close up, a drone in flight framed with its destination
 * (chase view, flying up the screen), or a slow orbit once the drone is on scene. */
export function shotFor(target: CamTarget, s: OpState, viewH: number): Shot | null {
  if (target.kind === "overview") return OVERVIEW;
  if (target.kind === "drone") {
    const d = s.drones.find((x) => x.id === target.id);
    if (!d) return null;
    if (d.callId != null) return shotFor({ kind: "call", id: d.callId }, s, viewH);
    const pose = dronePose(d);
    return { center: pose.pos, zoom: d.phase === "docked" ? 15.2 : 15.6, pitch: 50, bearing: d.phase === "docked" ? 0 : pose.heading };
  }
  const c = s.calls.find((x) => x.id === target.id);
  if (!c) return null;
  const scene: [number, number] = [c.src.lon!, c.src.lat!];
  const d = droneOf(s, c.droneId);
  if (d && d.phase === "onscene") return { center: scene, zoom: 16.4, pitch: 56, bearing: "orbit" };
  if (d && (d.phase === "enroute" || d.phase === "launching")) {
    const pos = dronePose(d).pos;
    const dist = haversineM(pos[0], pos[1], scene[0], scene[1]);
    return {
      center: [(pos[0] + scene[0]) / 2, (pos[1] + scene[1]) / 2],
      zoom: zoomToFit(dist, scene[1], viewH),
      pitch: 52,
      bearing: dist > 120 ? bearing(pos, scene) : "orbit",
    };
  }
  return { center: scene, zoom: 15.4, pitch: 45, bearing: "orbit" };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const angleLerp = (a: number, b: number, k: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * k;

/** Move the current camera a step toward the shot (exponential smoothing, frame-rate independent). */
export function stepCamera(
  cur: { lng: number; lat: number; zoom: number; pitch: number; bearing: number },
  shot: Shot,
  dt: number,
  speed = 2.2,
) {
  const k = 1 - Math.exp(-dt * speed);
  const bearingTarget = shot.bearing === "orbit" ? cur.bearing + 6 * dt : shot.bearing;
  return {
    center: [lerp(cur.lng, shot.center[0], k), lerp(cur.lat, shot.center[1], k)] as [number, number],
    zoom: lerp(cur.zoom, shot.zoom, k),
    pitch: lerp(cur.pitch, shot.pitch, k),
    bearing: shot.bearing === "orbit" ? bearingTarget : angleLerp(cur.bearing, bearingTarget, k * 0.8),
  };
}
