// Live "camera feed" from the selected call's drone: a second map locked to the drone, tilted and
// zoomed in on the imagery, with a flight-display overlay. Updated every animation frame.

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import type { OpState } from "../../sim/operator";
import { imageryOnlyStyle } from "../basemap";
import { fmtClock } from "../format";
import { dronePose } from "./pose";

interface Props {
  simRef: { current: OpState | null };
  droneId: string;
  callId: number;
  caption: string | null;
  ambiguous: boolean;
}

const PHASE: Record<string, string> = {
  launching: "LAUNCH",
  enroute: "EN ROUTE",
  onscene: "ON SCENE",
  returning: "RTB",
  landing: "LANDING",
  docked: "DOCKED",
};

export function DroneCam({ simRef, droneId, callId, caption, ambiguous }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const ids = useRef({ droneId, callId });
  ids.current = { droneId, callId };

  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!,
      style: imageryOnlyStyle(),
      center: [-122.41, 37.77],
      zoom: 17.6,
      pitch: 55,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
    });
    let raf = 0;
    let smoothBearing: number | null = null;
    const loop = () => {
      const s = simRef.current;
      const d = s?.drones.find((x) => x.id === ids.current.droneId);
      const call = s?.calls.find((c) => c.id === ids.current.callId);
      if (s && d && map.loaded()) {
        const pose = dronePose(d);
        const onScene = d.phase === "onscene" && call;
        // On scene the camera looks at the call from the orbiting drone; in transit it looks ahead.
        const center: [number, number] = onScene ? [call!.src.lon!, call!.src.lat!] : pose.pos;
        const target = onScene ? (pose.orbitAngle! + 180) % 360 : pose.heading;
        if (smoothBearing == null) smoothBearing = target;
        const diff = ((target - smoothBearing + 540) % 360) - 180;
        smoothBearing = (smoothBearing + diff * 0.12 + 360) % 360;
        const climbing = d.phase === "launching" || d.phase === "landing";
        map.jumpTo({ center, bearing: smoothBearing, zoom: onScene ? 18.4 : climbing ? 18.6 : 17.4, pitch: onScene ? 52 : 58 });
        if (hud.current) {
          const alt = climbing ? Math.round(Math.min(1, d.phaseT / (d.ac.launchS + 10)) * d.ac.cruiseAltitudeFt) : d.ac.cruiseAltitudeFt;
          const spd = d.phase === "enroute" || d.phase === "returning" ? Math.round(d.ac.cruiseSpeedMs * 2.237) : 0;
          hud.current.querySelector(".cam-phase")!.textContent = PHASE[d.phase];
          hud.current.querySelector(".cam-alt")!.textContent = `ALT ${alt} FT`;
          hud.current.querySelector(".cam-spd")!.textContent = spd ? `${spd} MPH` : "HOLD";
          hud.current.querySelector(".cam-batt")!.textContent = `BAT ${Math.round(d.battery)}%`;
          hud.current.querySelector(".cam-time")!.textContent = fmtClock(s.t);
          hud.current.querySelector(".cam-hdg")!.textContent = `HDG ${String(Math.round(smoothBearing)).padStart(3, "0")}`;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      map.remove();
    };
  }, [simRef]);

  return (
    <div className={ambiguous ? "dronecam amb" : "dronecam"}>
      <div ref={el} className="cam-map" />
      <div ref={hud} className="cam-hud" aria-hidden="true">
        <span className="cam-corner tl" />
        <span className="cam-corner tr" />
        <span className="cam-corner bl" />
        <span className="cam-corner br" />
        <div className="cam-top">
          <span className="cam-live">● LIVE</span>
          <span>{droneId}</span>
          <span className="cam-phase" />
          <span className="cam-time" />
        </div>
        <div className="cam-reticle" />
        <div className="cam-side">
          <span className="cam-alt" />
          <span className="cam-spd" />
          <span className="cam-hdg" />
          <span className="cam-batt" />
        </div>
        {caption && <div className="cam-caption">{caption}</div>}
      </div>
    </div>
  );
}
