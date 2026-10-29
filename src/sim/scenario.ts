// Small helpers over a Scenario: which aircraft a dock flies, how far it reaches, and which calls a drone may take.

import type { AircraftProfile, Call, Dock, Scenario } from "./types";

/** Aircraft profile flown from a dock. */
export function profileFor(sc: Scenario, dock: Dock): AircraftProfile {
  return dock.type === "fixedwing" ? sc.fixedWing : sc.aircraft;
}

/** Response radius (m) of a dock: the dispatch setting for multirotors, the hub's own radius for fixed-wing. */
export function radiusFor(sc: Scenario, dock: Dock): number {
  return (dock.type === "fixedwing" ? sc.fixedWing.responseRadiusKm ?? 48 : sc.dispatch.maxResponseRadiusKm) * 1000;
}

/** Predicate for "this call is eligible for a drone under the scenario" (type, priority, area, located, not duplicate). */
export function eligibilityTest(sc: Scenario): (call: Call) => boolean {
  const types = new Set(sc.eligibility.callTypes);
  const priorities = new Set(sc.eligibility.priorities);
  const districts = sc.eligibility.districts ? new Set(sc.eligibility.districts) : null;
  return (call) =>
    call.lon != null &&
    call.lat != null &&
    !(sc.dispatch.skipDuplicateCalls && call.dup) &&
    types.has(call.typeO) &&
    priorities.has(call.prioO) &&
    (!districts || districts.has(call.district ?? ""));
}
