// Basemaps. "satellite" is Esri World Imagery (0.3 m Vantor/Maxar imagery over San Francisco, sharp to
// zoom 19+) with OpenStreetMap street and neighbourhood labels; "streets" is OpenFreeMap's vector style.
// On high-DPI screens imagery tiles are drawn at half size, so the map fetches one zoom level deeper
// and stays crisp instead of upscaling.

import type { StyleSpecification } from "maplibre-gl";
import { MAP_STYLE, type Mode } from "./theme";

export type BasemapKind = "satellite" | "streets";

const ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const IMAGERY_ATTRIBUTION = "Imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community";

const hiDpi = () => (typeof window !== "undefined" ? window.devicePixelRatio >= 1.5 : false);

function imagerySource() {
  return {
    type: "raster" as const,
    tiles: [ESRI_IMAGERY],
    tileSize: hiDpi() ? 128 : 256,
    maxzoom: 19,
    attribution: IMAGERY_ATTRIBUTION,
  };
}

/** Imagery only, no labels: used for the drone camera feed. */
export function imageryOnlyStyle(): StyleSpecification {
  return {
    version: 8,
    sources: { imagery: imagerySource() },
    layers: [{ id: "imagery", type: "raster", source: "imagery" }],
  };
}

function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      imagery: imagerySource(),
      osm: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
    },
    layers: [
      { id: "imagery", type: "raster", source: "imagery", paint: { "raster-saturation": -0.1 } },
      {
        id: "road-names",
        type: "symbol",
        source: "osm",
        "source-layer": "transportation_name",
        minzoom: 14,
        filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary"]]],
        layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 10.5 },
        paint: { "text-color": "#f4f3f0", "text-halo-color": "rgba(0,0,0,0.75)", "text-halo-width": 1.4 },
      },
      {
        id: "place-names",
        type: "symbol",
        source: "osm",
        "source-layer": "place",
        maxzoom: 15,
        filter: ["in", ["get", "class"], ["literal", ["suburb", "neighbourhood", "quarter"]]],
        layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-letter-spacing": 0.04 },
        paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.8)", "text-halo-width": 1.6, "text-opacity": 0.85 },
      },
    ],
  };
}

export function basemapStyle(kind: BasemapKind, mode: Mode): string | StyleSpecification {
  return kind === "satellite" ? satelliteStyle() : MAP_STYLE[mode];
}

/** Overlay palette to draw on top: imagery is dark, so it always takes the dark-mode overlay colours. */

export function loadBasemap(): BasemapKind {
  try {
    return localStorage.getItem("dfr-basemap") === "streets" ? "streets" : "satellite";
  } catch {
    return "satellite";
  }
}

export function saveBasemap(kind: BasemapKind) {
  try {
    localStorage.setItem("dfr-basemap", kind);
  } catch {
    /* storage unavailable */
  }
}
