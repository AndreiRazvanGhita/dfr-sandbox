import assumptions from "../../config/assumptions.json";
import type { AircraftProfile, Scenario } from "./types";

const A = assumptions;
const mr = A.aircraft.multirotor;

export const MULTIROTOR: AircraftProfile = {
  label: mr.label.value,
  launchS: mr.launchS.value,
  cruiseAltitudeFt: mr.cruiseAltitudeFt.value,
  climbRateMs: mr.climbRateMs.value,
  cruiseSpeedMs: mr.cruiseSpeedMs.value,
  landingS: mr.landingS.value,
  enduranceMin: mr.enduranceMin.value,
  reservePct: mr.reservePct.value,
  minLaunchPct: mr.minLaunchPct.value,
  chargeRatePctPerMin: mr.chargeRatePctPerMin.value,
};

const fw = A.fixedWing;

export const FIXED_WING: AircraftProfile = {
  label: fw.label.value,
  launchS: fw.launchS.value,
  cruiseAltitudeFt: fw.cruiseAltitudeFt.value,
  climbRateMs: fw.climbRateMs.value,
  cruiseSpeedMs: fw.cruiseSpeedMs.value,
  landingS: fw.landingS.value,
  enduranceMin: fw.enduranceMin.value,
  reservePct: fw.reservePct.value,
  minLaunchPct: fw.minLaunchPct.value,
  chargeRatePctPerMin: fw.chargeRatePctPerMin.value,
  responseRadiusKm: fw.responseRadiusKm.value,
  orbitRadiusM: fw.orbitRadiusM.value,
};

/** Documented defaults; presets set the docks and staffing. */
export function defaultScenario(): Scenario {
  return {
    docks: [],
    aircraft: { ...MULTIROTOR },
    fixedWing: { ...FIXED_WING },
    operators: { count: A.operators.count.value, maxConcurrentDrones: A.operators.maxConcurrentDrones.value },
    dispatch: { maxResponseRadiusKm: A.dispatch.maxResponseRadiusKm.value, skipDuplicateCalls: A.dispatch.skipDuplicateCalls.value },
    eligibility: {
      callTypes: [...A.eligibility.defaultCallTypes.value],
      priorities: [...A.eligibility.defaultPriorities.value],
      districts: null,
    },
  };
}
