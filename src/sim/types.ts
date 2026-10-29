// Shared types for the data files and the simulation.

export interface CallsMonthFile {
  month: string;
  source: string;
  days: string[];
  types: [code: string, desc: string][];
  districts: string[];
  dispositions: string[];
  cols: {
    day: number[];
    t: number[];
    entry: (number | null)[];
    disp: (number | null)[];
    onscene: (number | null)[];
    close: (number | null)[];
    lon: (number | null)[];
    lat: (number | null)[];
    type: number[];
    prio: string[];
    dist: (number | null)[];
    dispo: number[];
    dup: number[];
  };
}

/** One 911-originated police call. Offsets are seconds after `t` (received). */
export interface Call {
  id: number;
  date: string;
  t: number; // received, seconds since local midnight
  entry: number | null;
  disp: number | null;
  onscene: number | null;
  /** Last unit cleared the call, seconds after received. close - onscene ≈ officer time spent on it. */
  close: number | null;
  lon: number | null;
  lat: number | null;
  /** Call type and priority as the call taker first coded them. */
  typeO: string;
  typeODesc: string;
  prioO: string;
  district: string | null;
  dispo: string;
  dup: boolean;
}

export type AircraftType = "multirotor" | "fixedwing";

export interface Dock {
  id: string;
  name: string;
  lon: number;
  lat: number;
  drones: number;
  /** Aircraft housed here; multirotor when absent. */
  type?: AircraftType;
}

export interface AircraftProfile {
  label: string;
  launchS: number;
  cruiseAltitudeFt: number;
  climbRateMs: number;
  cruiseSpeedMs: number;
  landingS: number;
  enduranceMin: number;
  reservePct: number;
  minLaunchPct: number;
  chargeRatePctPerMin: number;
  /** Fixed-wing only: response radius of the hub (multirotor docks use dispatch.maxResponseRadiusKm). */
  responseRadiusKm?: number;
  /** Orbit radius over the scene (fixed-wing cannot hover). */
  orbitRadiusM?: number;
}

export interface Scenario {
  docks: Dock[];
  aircraft: AircraftProfile; // multirotor docks
  fixedWing: AircraftProfile; // fixed-wing hubs
  operators: { count: number; maxConcurrentDrones: number };
  dispatch: { maxResponseRadiusKm: number; skipDuplicateCalls: boolean };
  /** districts: service area by police district (Oct 2026 boundaries); null = citywide. */
  eligibility: { callTypes: string[]; priorities: string[]; districts: string[] | null };
}
