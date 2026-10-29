// The three fleets. Every site is a real city-owned fire or police building
// (DataSF wt27-4jim); every other setting is the documented default unless stated.

import { defaultScenario } from "./defaults";
import type { Dock, Scenario } from "./types";

export interface Preset {
  id: string;
  name: string;
  description: string;
  date: string;
  build: () => Scenario;
}

/** Ten fire/police sites picked to cover the most historical eligible calls within 90 s of flight. */
const CITYWIDE_10: Dock[] = [
  { id: "C1", name: "Tenderloin Station", lon: -122.41291, lat: 37.78365, drones: 1 },
  { id: "C2", name: "Mission Station", lon: -122.42197, lat: 37.76268, drones: 1 },
  { id: "C3", name: "Fire Station #13", lon: -122.40135, lat: 37.79552, drones: 1 },
  { id: "C4", name: "Northern Station", lon: -122.43239, lat: 37.78016, drones: 1 },
  { id: "C5", name: "Fire Headquarters", lon: -122.39105, lat: 37.78055, drones: 1 },
  { id: "C6", name: "Fire Station #16", lon: -122.43672, lat: 37.79858, drones: 1 },
  { id: "C7", name: "Fire Station #11", lon: -122.42649, lat: 37.74878, drones: 1 },
  { id: "C8", name: "Bayview Station", lon: -122.39809, lat: 37.72964, drones: 1 },
  { id: "C9", name: "Bureau of Equipment HQ", lon: -122.40357, lat: 37.75174, drones: 1 },
  { id: "C10", name: "Fire Station #29", lon: -122.4043, lat: 37.76616, drones: 1 },
];

const citywide = (): Scenario => ({
  ...defaultScenario(),
  docks: CITYWIDE_10.map((d) => ({ ...d })),
  // Two remote operators, each supervising up to three autonomous docked drones at once.
  operators: { count: 2, maxConcurrentDrones: 3 },
});

export const PRESETS: Preset[] = [
  {
    id: "soma",
    name: "SoMa pilot (Southern Station)",
    description:
      "Two docks for the new Southern district (Oct 2026 boundaries, up to Market St): the Public Safety Building, home of Southern Station, and Fire Station #1 in central SoMa. One operator supervising both. Only Southern calls, priority B and C, the lower-priority calls SFPD's planned pilot and drone study target.",
    date: "2026-10-14",
    build: () => {
      const sc = defaultScenario();
      return {
        ...sc,
        docks: [
          { id: "P1", name: "Southern Station (Public Safety Bldg)", lon: -122.38918, lat: 37.77255, drones: 1 },
          { id: "P2", name: "Fire Station #1 (SoMa)", lon: -122.40412, lat: 37.77946, drones: 1 },
        ],
        operators: { count: 1, maxConcurrentDrones: 2 },
        eligibility: { ...sc.eligibility, priorities: ["B", "C"], districts: ["Southern"] },
      };
    },
  },
  {
    id: "citywide",
    name: "Citywide, 10 docks, 2 operators",
    description:
      "Ten docks on the fire and police buildings that cover the most past calls within 90 s; one drone each. Two operators, each supervising up to three drones at once. All districts, all priorities.",
    date: "2026-10-14",
    build: citywide,
  },
  {
    id: "fixedwing",
    name: "Citywide + fixed-wing",
    description:
      "The citywide ten plus a long-range fixed-wing hub with two aircraft at Fire Station #24 (Noe Valley, near the city's centre), able to reach the whole city. A third operator for the fixed-wing layer. Dispatch sends whichever free aircraft arrives first.",
    date: "2026-10-14",
    build: () => {
      const sc = citywide();
      return {
        ...sc,
        docks: [...sc.docks, { id: "H1", name: "Fire Station #24 hub", lon: -122.4411, lat: 37.75313, drones: 2, type: "fixedwing" }],
        operators: { count: 3, maxConcurrentDrones: 3 },
      };
    },
  },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id) ?? null;
