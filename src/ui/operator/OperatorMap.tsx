import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MlMap, type Marker } from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { candidates, type OpCall, type OpState } from "../../sim/operator";
import { basemapStyle, type BasemapKind } from "../basemap";
import { currentMode } from "../theme";
import { OVERVIEW, shotFor, stepCamera, type CamTarget } from "./camera";
import { officerIcon, planeIcon, quadIcon } from "./icons";
import { dronePose } from "./pose";

interface Props {
  sim: OpState | null;
  districts: FeatureCollection | null;
  docks: { id: string; name: string; lon: number; lat: number }[];
  selected: number | null;
  basemap: BasemapKind;
  /** Start/end screens are up: slowly orbit the city behind them. */
  idle: boolean;
  /** What the camera should lock onto; null leaves the camera to the user. */
  camTarget: CamTarget | null;
  /** Called when the user drags, scrolls or pinches the map (takes the camera back). */
  onUserCamera: () => void;
  onSelect: (id: number | null) => void;
  onDockClick: (dockId: string) => void;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const PRIORITY = { A: "#ff5a52", B: "#ff9d47", C: "#d6d5cd" } as Record<string, string>;
const BLUE = "#3d8bff";

/** Call state as drawn: open calls by stage, closed calls by outcome (fading out over 10 sim-minutes). */
function callState(c: OpCall, t: number): string | null {
  if (c.visibleAt > t) return null;
  if (c.status === "waiting") return "waiting";
  if (c.status === "assigned") return "assigned";
  if (c.status === "onscene") return c.report && !c.decision ? "decide" : "watching";
  if (c.closedAt != null && t - c.closedAt > 600) return null;
  if (c.outcome === "cleared_ok" || c.outcome === "cleared_unknown") return "cleared";
  if (c.outcome === "cleared_wrong") return "wrong";
  return "officer";
}

function addLayers(map: MlMap) {
  for (const id of ["districts", "eta", "calls", "drones", "trails", "paths"]) if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: EMPTY });
  if (!map.hasImage("quad")) map.addImage("quad", quadIcon(), { pixelRatio: 2 });
  if (!map.hasImage("plane")) map.addImage("plane", planeIcon(), { pixelRatio: 2 });
  if (!map.hasImage("officer")) map.addImage("officer", officerIcon(), { pixelRatio: 2 });

  map.addLayer({ id: "district-lines", type: "line", source: "districts", paint: { "line-color": "#ffffff", "line-width": 1, "line-opacity": 0.22 } });
  map.addLayer({
    id: "eta-lines",
    type: "line",
    source: "eta",
    paint: {
      "line-color": ["case", ["get", "best"], "#ffffff", "rgba(255,255,255,0.55)"],
      "line-width": ["case", ["get", "best"], 2.5, 1.2],
      "line-dasharray": [2, 2],
    },
  });
  map.addLayer({
    id: "eta-labels",
    type: "symbol",
    source: "eta",
    layout: { "symbol-placement": "line-center", "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 12 },
    paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.9)", "text-halo-width": 2 },
  });
  map.addLayer({ id: "paths", type: "line", source: "paths", paint: { "line-color": BLUE, "line-width": 1.5, "line-opacity": 0.8, "line-dasharray": [1, 2] } });
  map.addLayer({
    id: "trails",
    type: "line",
    source: "trails",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": 2.5, "line-opacity": 0.55, "line-blur": 1 },
  });
  // Closed calls: small outcome dots that fade.
  map.addLayer({
    id: "calls-closed",
    type: "circle",
    source: "calls",
    filter: ["in", ["get", "state"], ["literal", ["cleared", "wrong", "officer"]]],
    paint: {
      "circle-radius": 4.5,
      "circle-color": ["match", ["get", "state"], "cleared", "#2fd05a", "wrong", "#ff5a52", "#9a9993"],
      "circle-opacity": ["get", "fade"],
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 1,
      "circle-stroke-opacity": ["*", 0.5, ["get", "fade"]],
    },
  });
  // Open calls: expanding halo, coloured ring by stage, core coloured by priority.
  map.addLayer({
    id: "calls-halo",
    type: "circle",
    source: "calls",
    filter: ["in", ["get", "state"], ["literal", ["waiting", "decide"]]],
    paint: {
      "circle-radius": ["get", "haloR"],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": ["match", ["get", "state"], "decide", BLUE, ["get", "prioColor"]],
      "circle-stroke-width": 2,
      "circle-stroke-opacity": ["get", "haloA"],
    },
  });
  map.addLayer({
    id: "calls-open",
    type: "circle",
    source: "calls",
    filter: ["in", ["get", "state"], ["literal", ["waiting", "assigned", "watching", "decide"]]],
    paint: {
      "circle-radius": 7,
      "circle-color": ["get", "prioColor"],
      "circle-stroke-color": ["match", ["get", "state"], "waiting", "rgba(0,0,0,0.75)", "assigned", "#ffffff", BLUE],
      "circle-stroke-width": ["match", ["get", "state"], "waiting", 2, 3],
    },
  });
  map.addLayer({
    id: "calls-selected",
    type: "circle",
    source: "calls",
    filter: ["==", ["get", "selected"], true],
    paint: { "circle-radius": 16, "circle-color": "rgba(255,255,255,0.08)", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
  });
  map.addLayer({
    id: "call-officer",
    type: "symbol",
    source: "calls",
    filter: ["==", ["get", "officer"], true],
    layout: { "icon-image": "officer", "icon-offset": [14, -14], "icon-allow-overlap": true, "icon-size": 0.9 },
    paint: { "icon-opacity": ["get", "fade"] },
  });
  map.addLayer({
    id: "call-labels",
    type: "symbol",
    source: "calls",
    filter: ["any", ["==", ["get", "selected"], true], ["==", ["get", "state"], "decide"]],
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 12,
      "text-offset": [0, 1.7],
      "text-anchor": "top",
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.9)", "text-halo-width": 2 },
  });
  map.addLayer({
    id: "drone-shadow",
    type: "circle",
    source: "drones",
    paint: { "circle-radius": 13, "circle-color": "#000000", "circle-opacity": 0.35, "circle-blur": 1, "circle-translate": [3, 4] },
  });
  map.addLayer({
    id: "drones",
    type: "symbol",
    source: "drones",
    layout: {
      "icon-image": ["match", ["get", "type"], "fixedwing", "plane", "quad"],
      "icon-rotate": ["get", "heading"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.75, 15, 1.1],
    },
  });
}

function dockHtml(name: string, sim: OpState | null, dockId: string): string {
  const drones = sim?.drones.filter((d) => d.dockId === dockId) ?? [];
  const pips = drones
    .map((d) => {
      const cls = d.phase === "docked" ? (d.battery >= d.ac.minLaunchPct ? "pip ready" : "pip charging") : "pip air";
      return `<i class="${cls}" style="--b:${Math.round(d.battery)}%"></i>`;
    })
    .join("");
  const fw = drones[0]?.type === "fixedwing";
  const short = name.replace(/ \(.*\)$/, "").replace("Fire Station ", "FS ").replace("Station", "Stn").replace(" hub", "");
  return `<span class="dock-pad${fw ? " fw" : ""}">${fw ? "✈" : "⌂"}</span><span class="dock-tag"><span class="dock-name">${short}</span><span class="pips">${pips}</span></span>`;
}

/** Imagery brightness by hour of day: full in daylight, dimmed and cooled at night. */
function lighting(t: number): { bright: number; sat: number; hue: number } {
  const h = (t / 3600) % 24;
  const day = h >= 7 && h < 18 ? 1 : h >= 5 && h < 7 ? (h - 5) / 2 : h >= 18 && h < 20.5 ? 1 - (h - 18) / 2.5 : 0;
  return { bright: 0.42 + 0.58 * day, sat: -0.45 + 0.35 * day, hue: (1 - day) * 12 };
}

export function OperatorMap({ sim, districts, docks, selected, basemap, idle, camTarget, onUserCamera, onSelect, onDockClick }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const trails = useRef(new Map<string, [number, number][]>());
  const latest = useRef({ sim, selected, onSelect, onDockClick, districts, docks, idle, camTarget, onUserCamera });
  latest.current = { sim, selected, onSelect, onDockClick, districts, docks, idle, camTarget, onUserCamera };
  const pops = useRef(new Map<string, Marker>());
  const lastLight = useRef(0);
  const basemapRef = useRef(basemap);
  const lastDockPaint = useRef(0);

  const draw = () => {
    const map = mapRef.current;
    const { sim, selected } = latest.current;
    if (!map || !map.getSource("calls")) return;
    if (!sim) {
      for (const id of ["calls", "drones", "eta", "trails", "paths"]) (map.getSource(id) as GeoJSONSource).setData(EMPTY);
      return;
    }
    if (sim.impacts.length === 0 && pops.current.size) pops.current.clear();
    const t = sim.t;
    const phase = (performance.now() % 1600) / 1600;
    const callFeats: Feature<Point>[] = [];
    for (const c of sim.calls) {
      const st = callState(c, t);
      if (!st) continue;
      const fade = c.closedAt != null ? Math.max(0.12, 1 - (t - c.closedAt) / 600) : 1;
      callFeats.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [c.src.lon!, c.src.lat!] },
        properties: {
          id: c.id,
          state: st,
          fade,
          selected: c.id === selected,
          prioColor: PRIORITY[c.src.prioO] ?? PRIORITY.C,
          haloR: 8 + 20 * phase,
          haloA: 0.9 * (1 - phase),
          officer: c.officerArrived && (c.status !== "closed" || c.outcome !== "skipped"),
          label: c.src.typeODesc,
        },
      });
    }
    (map.getSource("calls") as GeoJSONSource).setData({ type: "FeatureCollection", features: callFeats });

    const droneFeats: Feature<Point>[] = [];
    const trailFeats: Feature<LineString>[] = [];
    const pathFeats: Feature<LineString>[] = [];
    for (const d of sim.drones) {
      const hist = trails.current.get(d.id) ?? [];
      if (d.phase === "docked") {
        trails.current.set(d.id, []);
        continue;
      }
      const pose = dronePose(d);
      const last = hist[hist.length - 1];
      if (!last || Math.hypot(last[0] - pose.pos[0], last[1] - pose.pos[1]) > 0.00015) {
        hist.push(pose.pos);
        if (hist.length > 24) hist.shift();
        trails.current.set(d.id, hist);
      }
      droneFeats.push({ type: "Feature", geometry: { type: "Point", coordinates: pose.pos }, properties: { type: d.type, heading: pose.heading } });
      if (hist.length > 1) trailFeats.push({ type: "Feature", geometry: { type: "LineString", coordinates: [...hist, pose.pos] }, properties: {} });
      if ((d.phase === "enroute" || d.phase === "launching") && d.target) {
        pathFeats.push({ type: "Feature", geometry: { type: "LineString", coordinates: [pose.pos, d.target] }, properties: {} });
      }
    }
    (map.getSource("drones") as GeoJSONSource).setData({ type: "FeatureCollection", features: droneFeats });
    (map.getSource("trails") as GeoJSONSource).setData({ type: "FeatureCollection", features: trailFeats });
    (map.getSource("paths") as GeoJSONSource).setData({ type: "FeatureCollection", features: pathFeats });

    // ETA lines from the drones that could take the selected waiting call.
    const sel = sim.calls.find((c) => c.id === selected && c.status === "waiting");
    const eta: Feature<LineString>[] = [];
    if (sel) {
      const target: [number, number] = [sel.src.lon!, sel.src.lat!];
      const seen = new Set<string>();
      candidates(sim, sel)
        .filter((x) => !x.reason)
        .slice(0, 3)
        .forEach((x, i) => {
          const key = x.divert ? x.drone.id : x.drone.dockId;
          if (seen.has(key)) return;
          seen.add(key);
          eta.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: [x.divert ? x.drone.pos : x.drone.home, target] },
            properties: { best: i === 0, label: `${Math.round(x.eta)} s` },
          });
        });
    }
    (map.getSource("eta") as GeoJSONSource).setData({ type: "FeatureCollection", features: eta });

    // Floating impact markers at the call, one per impact, removed when their animation ends.
    for (const imp of sim.impacts) {
      const key = `${imp.callId}-${imp.kind}-${imp.t}`;
      if (pops.current.has(key) || sim.t - imp.t > 240) continue;
      // MapLibre positions the marker element with a transform, so animate an inner element instead.
      const node = document.createElement("div");
      const pill = document.createElement("span");
      pill.className = `impact-pop ${imp.kind}`;
      pill.textContent = imp.text;
      node.appendChild(pill);
      const m = new maplibregl.Marker({ element: node, anchor: "bottom", offset: [0, -14] }).setLngLat([imp.lon, imp.lat]).addTo(map);
      pops.current.set(key, m);
      window.setTimeout(() => m.remove(), 3600);
    }

    const now = performance.now();
    if (now - lastLight.current > 1000 && map.getLayer("imagery")) {
      lastLight.current = now;
      const l = lighting(t);
      map.setPaintProperty("imagery", "raster-brightness-max", l.bright);
      map.setPaintProperty("imagery", "raster-saturation", l.sat);
      map.setPaintProperty("imagery", "raster-hue-rotate", l.hue);
    }
    if (now - lastDockPaint.current > 200) {
      lastDockPaint.current = now;
      for (const [id, m] of markers.current) {
        const dock = latest.current.docks.find((d) => d.id === id);
        if (dock) m.getElement().innerHTML = dockHtml(dock.name, sim, id);
      }
    }
  };

  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!,
      style: basemapStyle(basemapRef.current, currentMode()),
      center: [-122.432, 37.764],
      zoom: 12.4,
      minZoom: 10.5,
      maxZoom: 18.5,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    (window as unknown as { __opMap: MlMap }).__opMap = map; // read-only handle for scripted checks
    map.touchZoomRotate.disableRotation();
    let styleReady = false; // isStyleLoaded() stays false while tiles stream, so track the style itself
    map.on("style.load", () => {
      styleReady = true;
      addLayers(map);
      if (latest.current.districts) (map.getSource("districts") as GeoJSONSource).setData(latest.current.districts);
      draw();
    });
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "sim-popup" });
    map.on("mousemove", "calls-open", (e) => {
      map.getCanvas().style.cursor = "pointer";
      const id = Number(e.features?.[0]?.properties?.id);
      const c = latest.current.sim?.calls.find((x) => x.id === id);
      if (!c) return;
      const wait = Math.max(0, latest.current.sim!.t - c.visibleAt);
      popup
        .setLngLat([c.src.lon!, c.src.lat!])
        .setHTML(`<b>${c.src.typeODesc}</b><span>Priority ${c.src.prioO} · ${c.src.district ?? ""} · ${Math.floor(wait / 60)}:${String(Math.floor(wait % 60)).padStart(2, "0")}</span>`)
        .addTo(map);
    });
    map.on("mouseleave", "calls-open", () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    });
    map.on("click", "calls-open", (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (id != null) latest.current.onSelect(Number(id));
    });
    const onZoom = () => el.current?.classList.toggle("zoomed-out", map.getZoom() < 12.8);
    map.on("zoom", onZoom);
    onZoom();
    // The user takes the camera back by dragging, scrolling or pinching. Raw pointer input is used because
    // the per-frame camera move would cancel MapLibre's own drag gesture before it ever reports a dragstart.
    const box = map.getCanvasContainer();
    let pressed: { x: number; y: number } | null = null;
    let userUntil = 0;
    const takeOver = () => {
      if (latest.current.idle) return;
      userUntil = performance.now() + 400;
      latest.current.onUserCamera();
    };
    const onDown = (e: PointerEvent) => {
      pressed = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 5) {
        pressed = null;
        takeOver();
      }
    };
    const onUp = () => {
      pressed = null;
    };
    box.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    box.addEventListener("wheel", takeOver, { passive: true });

    let raf = 0;
    let lastT = performance.now();
    let padded = false;
    const PLAY_PADDING = { top: 70, bottom: 110, left: 20, right: 390 };
    const loop = (now: number) => {
      const dt = Math.min(0.5, (now - lastT) / 1000);
      lastT = now;
      draw();
      const { idle, camTarget, sim } = latest.current;
      if (styleReady && !map.isEasing()) {
        if (idle) {
          // Behind the start and end screens: drift slowly around the city in 3D.
          if (padded) {
            map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
            padded = false;
          }
          map.jumpTo({ pitch: Math.min(48, map.getPitch() + 18 * dt), bearing: (map.getBearing() + 3 * dt) % 360 });
        } else {
          // Keep the focus clear of the HUD panels on the right and bottom.
          if (!padded) {
            map.setPadding(PLAY_PADDING);
            padded = true;
          }
          if (camTarget && sim && now > userUntil && !pressed) {
            const shot = shotFor(camTarget, sim, map.getContainer().clientHeight - 180) ?? OVERVIEW;
            const c = map.getCenter();
            const next = stepCamera({ lng: c.lng, lat: c.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }, shot, dt);
            map.jumpTo(next);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      markers.current.forEach((m) => m.remove());
      markers.current.clear();
      pops.current.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (basemapRef.current === basemap) return;
    basemapRef.current = basemap;
    mapRef.current?.setStyle(basemapStyle(basemap, currentMode()), { diff: false });
  }, [basemap]);

  useEffect(() => {
    const src = mapRef.current?.getSource("districts") as GeoJSONSource | undefined;
    if (src && districts) src.setData(districts);
  }, [districts]);

  // Dock markers: click one to launch its best drone to the selected call.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set(docks.map((d) => d.id));
    for (const d of docks) {
      let m = markers.current.get(d.id);
      if (!m) {
        const node = document.createElement("div");
        node.className = "dock-marker op";
        node.setAttribute("role", "button");
        node.title = `${d.name}: select a call, then click to launch from here`;
        node.addEventListener("click", (ev) => {
          ev.stopPropagation();
          latest.current.onDockClick(d.id);
        });
        m = new maplibregl.Marker({ element: node }).setLngLat([d.lon, d.lat]).addTo(map);
        markers.current.set(d.id, m);
      }
      m.setLngLat([d.lon, d.lat]);
      m.getElement().innerHTML = dockHtml(d.name, latest.current.sim, d.id);
    }
    for (const [id, m] of markers.current) {
      if (!seen.has(id)) {
        m.remove();
        markers.current.delete(id);
      }
    }
  }, [docks]);

  return <div ref={el} className="map" />;
}
