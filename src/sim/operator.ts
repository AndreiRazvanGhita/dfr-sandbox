// Operator mode: a live, step-by-step simulation where the user is the DFR operator.
//
// Calls arrive at random (a Poisson process at San Francisco's real hourly rate for the
// eligible call mix), and each one is a real historical call re-timed: its type, priority,
// masked location, call-taking delay, real officer arrival time and real final disposition.
// Drones move continuously and only do what the operator tells them, apart from two safety
// behaviours: return when the battery reaches what the trip home needs, and return when the
// officer is on scene.

import { storyFor } from "./callStories";
import { profileFor, radiusFor } from "./scenario";
import { haversineM } from "./geo";
import type { AircraftProfile, AircraftType, Call, Scenario } from "./types";

export type CallStatus = "waiting" | "assigned" | "onscene" | "closed";
export type Outcome =
  | "cleared_ok" // drone look cleared the call and the real disposition agrees
  | "cleared_wrong" // cleared, but officers actually found something
  | "cleared_unknown" // cleared; disposition gives no verdict
  | "drone_then_officer" // drone first, officer still needed
  | "officer_first" // officer beat the drone
  | "not_flown" // officer handled it without a drone
  | "skipped"; // operator declined the call

export interface SceneReport {
  text: string;
  ambiguous: boolean;
  clearable: boolean | null; // ground truth from the real disposition; hidden from the operator
}

export interface OpCall {
  id: number;
  src: Call;
  t: number; // 911 call received
  visibleAt: number; // entered in CAD: when the operator can see it
  officerAt: number | null; // real first officer on scene, re-timed
  status: CallStatus;
  droneId: string | null;
  launchedAt: number | null;
  droneAt: number | null;
  officerArrived: boolean;
  report: SceneReport | null;
  reportAt: number | null;
  decision: "clear" | "officer" | null;
  outcome: Outcome | null;
  closedAt: number | null;
  /** Whether the drone's view will be blocked; drawn when the call spawns so a seed always replays the same. */
  ambiguous: boolean;
}

export type OpPhase = "docked" | "launching" | "enroute" | "onscene" | "returning" | "landing";

export interface OpDrone {
  id: string;
  dockId: string;
  dockName: string;
  type: AircraftType;
  ac: AircraftProfile;
  radiusM: number;
  home: [number, number];
  pos: [number, number];
  battery: number;
  phase: OpPhase;
  phaseT: number;
  callId: number | null;
  target: [number, number] | null;
}

export interface OpEvent {
  t: number;
  kind: "call" | "drone" | "officer" | "decision" | "warn";
  text: string;
  callId?: number;
}

/** A moment where the program visibly helped (or got it wrong), shown on the map at the call. */
export interface OpImpact {
  t: number;
  callId: number;
  kind: "sooner" | "freed" | "wrong";
  text: string;
  lon: number;
  lat: number;
}

export interface OpConfig {
  scenario: Scenario;
  pool: Call[]; // eligible real calls to sample from
  poolDays: number;
  startT: number;
  durationS: number;
  rateMultiplier: number;
  seed: number;
}

export interface OpState {
  cfg: OpConfig;
  t: number;
  endT: number;
  calls: OpCall[];
  drones: OpDrone[];
  events: OpEvent[];
  impacts: OpImpact[];
  kmFlown: number;
  capacity: number; // missions the operator team can supervise at once
  finished: boolean;
  rand: () => number;
  byHour: Call[][];
  rate: number[]; // calls per second, by hour
  nextArrival: number;
}

const FT_TO_M = 0.3048;
const OBSERVE_S = 20; // time on scene before the operator gets a scene read

// ---------- helpers ----------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hourOf = (t: number) => Math.floor(t / 3600) % 24;
const climbS = (ac: AircraftProfile) => (ac.cruiseAltitudeFt * FT_TO_M) / ac.climbRateMs;
const drainPerS = (ac: AircraftProfile) => 100 / (ac.enduranceMin * 60);

/** Battery needed to fly home from `pos` and land with the reserve intact. */
function homeNeed(d: OpDrone, pos = d.pos): number {
  const back = haversineM(pos[0], pos[1], d.home[0], d.home[1]) / d.ac.cruiseSpeedMs + d.ac.landingS;
  return d.ac.reservePct + back * drainPerS(d.ac);
}

/** Battery a docked drone needs to launch for a call: there and back plus two minutes on scene. */
export function launchNeed(d: OpDrone, target: [number, number]): number {
  const dist = haversineM(d.home[0], d.home[1], target[0], target[1]);
  const flight = d.ac.launchS + climbS(d.ac) + (2 * dist) / d.ac.cruiseSpeedMs + d.ac.landingS + 120;
  return Math.max(d.ac.minLaunchPct, d.ac.reservePct + flight * drainPerS(d.ac));
}

/** Seconds from launch order to on scene for a docked drone (still air). */
export function etaS(d: OpDrone, target: [number, number]): number {
  const dist = haversineM(d.pos[0], d.pos[1], target[0], target[1]);
  const lead = d.phase === "docked" ? d.ac.launchS + climbS(d.ac) : d.phase === "launching" ? Math.max(0, d.ac.launchS + climbS(d.ac) - d.phaseT) : 0;
  return lead + dist / d.ac.cruiseSpeedMs;
}

/** What a drone overhead would plausibly show, derived from the call's real final disposition. */
function sceneReport(dispo: string, ambiguous: boolean): SceneReport {
  const rules: [string[], string, boolean | null][] = [
    [["GOA", "UTL"], "No one matching the description in view.", true],
    [["PAS", "VAS"], "Premises / vehicle appear secure. No activity.", true],
    [["NCR", "NOM"], "People in view, nothing criminal apparent.", true],
    [["CAN", "22"], "Scene quiet. Caller has since cancelled.", true],
    [["ARR", "CIT", "REP", "CRM"], "Activity matching the call is visible.", false],
    [["HAN", "ADV", "ABA", "ADM"], "People involved are on scene; someone needs to talk to them.", false],
    [["SFD"], "Someone on the ground may need medical help.", false],
  ];
  const hit = rules.find(([codes]) => codes.includes(dispo));
  const clearable = hit ? hit[2] : null;
  if (ambiguous) return { text: "View blocked by rooftops and trees. Can't confirm what is happening.", ambiguous: true, clearable };
  return { text: hit ? hit[1] : "Hard to tell from the air.", ambiguous: !hit, clearable };
}

// ---------- setup ----------

export function createOperator(cfg: OpConfig): OpState {
  const sc = cfg.scenario;
  const drones: OpDrone[] = sc.docks
    .filter((d) => d.drones > 0)
    .flatMap((d) =>
      Array.from({ length: d.drones }, (_, k) => ({
        id: `${d.id}-${k + 1}`,
        dockId: d.id,
        dockName: d.name,
        type: d.type ?? ("multirotor" as AircraftType),
        ac: profileFor(sc, d),
        radiusM: radiusFor(sc, d),
        home: [d.lon, d.lat] as [number, number],
        pos: [d.lon, d.lat] as [number, number],
        battery: 100,
        phase: "docked" as OpPhase,
        phaseT: 0,
        callId: null,
        target: null,
      })),
    );
  const byHour: Call[][] = Array.from({ length: 24 }, () => []);
  for (const c of cfg.pool) byHour[hourOf(c.t)].push(c);
  const days = Math.max(1, cfg.poolDays);
  const rate = byHour.map((cs) => (cs.length / days / 3600) * cfg.rateMultiplier);
  const rand = mulberry32(cfg.seed);
  const s: OpState = {
    cfg,
    t: cfg.startT,
    endT: cfg.startT + cfg.durationS,
    calls: [],
    drones,
    events: [],
    impacts: [],
    kmFlown: 0,
    capacity: Math.max(1, sc.operators.count * sc.operators.maxConcurrentDrones),
    finished: false,
    rand,
    byHour,
    rate,
    nextArrival: cfg.startT,
  };
  s.nextArrival = cfg.startT + expDraw(s);
  log(s, "warn", `Shift started: ${drones.length} drones on ${sc.docks.filter((d) => d.drones > 0).length} docks, up to ${s.capacity} airborne at once.`);
  return s;
}

function expDraw(s: OpState): number {
  const r = s.rate[hourOf(s.t)] || 1e-6;
  return -Math.log(1 - s.rand()) / r;
}

function impact(s: OpState, call: OpCall, kind: OpImpact["kind"], text: string) {
  s.impacts.push({ t: s.t, callId: call.id, kind, text, lon: call.src.lon!, lat: call.src.lat! });
  if (s.impacts.length > 100) s.impacts.shift();
}

const mins = (sec: number) => (sec >= 90 ? `${Math.round(sec / 60)} min` : `${Math.round(sec)} s`);

/** Officer time a correct clearance gives back: the real travel plus time on scene for that call. */
export function officerTimeS(call: OpCall): number | null {
  const { disp, close, onscene } = call.src;
  if (close == null) return null;
  const from = disp ?? onscene;
  return from != null && close > from ? close - from : null;
}

function log(s: OpState, kind: OpEvent["kind"], text: string, callId?: number) {
  s.events.push({ t: s.t, kind, text, callId });
  if (s.events.length > 200) s.events.shift();
}

export const callLabel = (c: OpCall) => `#${c.id} ${c.src.typeODesc} (priority ${c.src.prioO})`;

function spawnCall(s: OpState) {
  const pool = s.byHour[hourOf(s.t)].length ? s.byHour[hourOf(s.t)] : s.cfg.pool;
  const src = pool[Math.floor(s.rand() * pool.length)];
  const call: OpCall = {
    id: s.calls.length + 1,
    src,
    t: s.t,
    visibleAt: s.t + (src.entry ?? 60),
    officerAt: src.onscene != null ? s.t + src.onscene : null,
    status: "waiting",
    droneId: null,
    launchedAt: null,
    droneAt: null,
    officerArrived: false,
    report: null,
    reportAt: null,
    decision: null,
    outcome: null,
    closedAt: null,
    ambiguous: s.rand() < 0.15,
  };
  s.calls.push(call);
}

// ---------- queries ----------

export const visibleCalls = (s: OpState) => s.calls.filter((c) => c.visibleAt <= s.t);
export const airborneCount = (s: OpState) => s.drones.filter((d) => d.phase !== "docked").length;
export const droneOf = (s: OpState, id: string | null) => (id ? s.drones.find((d) => d.id === id) ?? null : null);

/** Drones that could take a call right now, fastest first. */
export function candidates(s: OpState, call: OpCall) {
  const target: [number, number] = [call.src.lon!, call.src.lat!];
  return s.drones
    .map((d) => {
      const dist = haversineM(d.home[0], d.home[1], target[0], target[1]);
      let reason: string | null = null;
      if (d.callId === call.id) {
        reason = "already assigned";
      } else if (d.phase === "docked") {
        if (dist > d.radiusM) reason = `beyond ${(d.radiusM / 1000).toFixed(1)} km range`;
        else if (d.battery < launchNeed(d, target)) reason = `charging (${Math.round(d.battery)}%)`;
        else if (airborneCount(s) >= s.capacity) reason = "operators at capacity";
      } else if (d.phase === "enroute" || d.phase === "onscene") {
        if (dist > d.radiusM) reason = `beyond ${(d.radiusM / 1000).toFixed(1)} km range`;
        else if (d.battery < homeNeed(d, target) + 5) reason = "not enough battery to divert";
      } else {
        reason = d.phase === "launching" ? "launching" : "returning to dock";
      }
      return { drone: d, eta: etaS(d, target), dist, reason, divert: d.phase === "enroute" || d.phase === "onscene" };
    })
    .sort((a, b) => Number(!!a.reason) - Number(!!b.reason) || a.eta - b.eta);
}

// ---------- operator actions ----------

export function launch(s: OpState, callId: number, droneId: string): string | null {
  const call = s.calls.find((c) => c.id === callId);
  const d = droneOf(s, droneId);
  if (!call || !d || call.status === "closed") return "That call is closed.";
  const cand = candidates(s, call).find((x) => x.drone.id === droneId);
  if (cand?.reason) return `Drone ${d.id}: ${cand.reason}.`;
  if (d.callId != null && d.callId !== callId) releaseCall(s, d, `Drone ${d.id} diverted to ${callLabel(call)}.`);
  const prev = droneOf(s, call.droneId);
  if (prev && prev !== d) recall(s, prev.id, null);
  d.callId = call.id;
  d.target = [call.src.lon!, call.src.lat!];
  if (d.phase === "docked") {
    d.phase = "launching";
    d.phaseT = 0;
  } else {
    d.phase = "enroute";
  }
  call.droneId = d.id;
  call.launchedAt = s.t;
  call.status = "assigned";
  log(s, "drone", `Drone ${d.id} (${d.dockName}) → ${callLabel(call)}, ETA ${Math.round(etaS(d, d.target))} s.`, call.id);
  return null;
}

/** Take a drone off its call. With no drone overhead the call is waiting again (the officer is still coming). */
function releaseCall(s: OpState, d: OpDrone, text: string | null) {
  const call = s.calls.find((c) => c.id === d.callId);
  if (call && call.status !== "closed") {
    call.droneId = null;
    call.status = "waiting";
  }
  if (text) log(s, "drone", text, call?.id);
  d.callId = null;
}

/** Send a drone home. `text` is the log line; pass null when the caller logs its own reason. */
export function recall(s: OpState, droneId: string, text: string | null = ""): string | null {
  const d = droneOf(s, droneId);
  if (!d || d.phase === "docked" || d.phase === "returning" || d.phase === "landing") return "Drone is not on a mission.";
  if (d.callId != null) releaseCall(s, d, text === "" ? `Drone ${d.id} recalled to ${d.dockName}.` : text);
  d.phase = "returning";
  d.target = d.home;
  return null;
}

export function skip(s: OpState, callId: number): string | null {
  const call = s.calls.find((c) => c.id === callId);
  if (!call || call.status === "closed") return "That call is closed.";
  if (call.droneId) recall(s, call.droneId, null);
  close(s, call, "skipped");
  log(s, "decision", `Skipped ${callLabel(call)}: officers will handle it.`, call.id);
  return null;
}

export function decide(s: OpState, callId: number, decision: "clear" | "officer"): string | null {
  const call = s.calls.find((c) => c.id === callId);
  if (!call || call.status !== "onscene" || !call.report) return "No drone has a view of that call yet.";
  call.decision = decision;
  if (decision === "clear") {
    const truth = call.report.clearable;
    const outcome: Outcome = truth === true ? "cleared_ok" : truth === false ? "cleared_wrong" : "cleared_unknown";
    if (call.droneId) recall(s, call.droneId, null);
    close(s, call, outcome);
    if (outcome === "cleared_ok") {
      const freed = officerTimeS(call);
      impact(s, call, "freed", freed ? `Officer freed · ${mins(freed)}` : "Officer freed");
    } else if (outcome === "cleared_wrong") {
      impact(s, call, "wrong", "Needed an officer");
    }
    const verdict =
      outcome === "cleared_ok"
        ? "Officers later found nothing to act on."
        : outcome === "cleared_wrong"
          ? `Officers actually ${dispoText(call.src.dispo)}.`
          : "The record does not say whether that was right.";
    log(s, "decision", `Cleared ${callLabel(call)} without an officer. ${verdict}`, call.id);
  } else {
    log(s, "decision", `Kept the officer coming to ${callLabel(call)}; drone stays overhead until they arrive.`, call.id);
  }
  return null;
}

function dispoText(code: string): string {
  const m: Record<string, string> = {
    ARR: "made an arrest",
    CIT: "issued a citation",
    REP: "took a report",
    CRM: "found criminal activity",
    HAN: "had to handle it on scene",
    ADV: "had to advise the people involved",
    ABA: "had to abate the problem",
    ADM: "had to admonish someone",
    SFD: "needed medics",
  };
  return m[code] ?? "had work to do there";
}

function close(s: OpState, call: OpCall, outcome: Outcome) {
  call.status = "closed";
  call.outcome = outcome;
  call.closedAt = s.t;
  call.droneId = null;
}

// ---------- time step ----------

function moveToward(s: OpState, d: OpDrone, target: [number, number], meters: number): boolean {
  const dist = haversineM(d.pos[0], d.pos[1], target[0], target[1]);
  s.kmFlown += Math.min(dist, meters) / 1000;
  if (dist <= meters || dist < 1) {
    d.pos = [target[0], target[1]];
    return true;
  }
  const f = meters / dist;
  d.pos = [d.pos[0] + (target[0] - d.pos[0]) * f, d.pos[1] + (target[1] - d.pos[1]) * f];
  return false;
}

function stepOnce(s: OpState, dt: number) {
  s.t += dt;

  // New 911 calls.
  while (s.nextArrival <= s.t && s.nextArrival < s.endT) {
    const now = s.t;
    s.t = s.nextArrival;
    spawnCall(s);
    s.nextArrival = s.t + expDraw(s);
    s.t = now;
  }
  for (const c of s.calls) {
    if (c.visibleAt > s.t - dt && c.visibleAt <= s.t && c.status !== "closed") log(s, "call", `New in CAD: ${callLabel(c)}, ${c.src.district ?? "?"}.`, c.id);
  }

  // Drones.
  for (const d of s.drones) {
    const call = s.calls.find((c) => c.id === d.callId) ?? null;
    if (d.phase === "docked") {
      d.battery = Math.min(100, d.battery + (d.ac.chargeRatePctPerMin * dt) / 60);
      continue;
    }
    d.battery -= drainPerS(d.ac) * dt;
    d.phaseT += dt;
    if (d.phase === "launching" && d.phaseT >= d.ac.launchS + climbS(d.ac)) {
      d.phase = "enroute";
      d.phaseT = 0;
    } else if (d.phase === "enroute" && d.target) {
      if (moveToward(s, d, d.target, d.ac.cruiseSpeedMs * dt)) {
        d.phase = "onscene";
        d.phaseT = 0;
        if (call) {
          call.status = "onscene";
          call.droneAt ??= s.t;
          const first = !call.officerArrived;
          log(
            s,
            "drone",
            `Drone ${d.id} on scene at ${callLabel(call)}, ${Math.round(s.t - call.visibleAt)} s after it hit CAD${first ? ", ahead of the officer" : ", officer already there"}.`,
            call.id,
          );
        }
      }
    } else if (d.phase === "onscene") {
      if (call && !call.report && d.phaseT >= OBSERVE_S) {
        call.report = sceneReport(call.src.dispo, call.ambiguous);
        call.reportAt = s.t;
        log(s, "drone", `Scene read for ${callLabel(call)}: ${call.report.text}`, call.id);
      }
      if (d.battery <= homeNeed(d) + 1) {
        log(s, "warn", `Drone ${d.id} battery low (${Math.round(d.battery)}%): returning to ${d.dockName}.`, call?.id);
        recall(s, d.id, null);
      }
    } else if (d.phase === "returning") {
      if (moveToward(s, d, d.home, d.ac.cruiseSpeedMs * dt)) {
        d.phase = "landing";
        d.phaseT = 0;
      }
    } else if (d.phase === "landing" && d.phaseT >= d.ac.landingS) {
      d.phase = "docked";
      d.phaseT = 0;
      d.target = null;
    }
  }

  // Officers arrive at their real times (unless the operator cleared the call first).
  for (const c of s.calls) {
    if (c.status === "closed" || c.officerArrived || c.officerAt == null || c.officerAt > s.t) continue;
    c.officerArrived = true;
    const d = droneOf(s, c.droneId);
    if (c.droneAt != null && c.droneAt < c.officerAt) {
      if (d) recall(s, d.id, null);
      close(s, c, "drone_then_officer");
      impact(s, c, "sooner", `Eyes on ${mins(c.officerAt - c.droneAt)} sooner`);
      log(s, "officer", `Officer on scene at ${callLabel(c)}; your drone was there ${Math.round(c.officerAt - c.droneAt)} s earlier.`, c.id);
    } else if (c.droneId) {
      if (d) recall(s, d.id, null);
      close(s, c, "officer_first");
      log(s, "officer", `Officer reached ${callLabel(c)} before the drone; drone returning.`, c.id);
    } else if (c.visibleAt <= s.t) {
      close(s, c, "not_flown");
      log(s, "officer", `Officer handled ${callLabel(c)} without a drone.`, c.id);
    } else {
      close(s, c, "not_flown");
    }
  }
  // Calls with no recorded officer arrival close after an hour.
  for (const c of s.calls) {
    if (c.status !== "closed" && c.officerAt == null && s.t - c.visibleAt > 3600) {
      if (c.droneId) recall(s, c.droneId, null);
      close(s, c, c.droneAt != null ? "drone_then_officer" : "not_flown");
    }
  }

  if (s.t >= s.endT) s.finished = true;
}

/** Advance the simulation by dt seconds of sim time (sub-stepped for smooth, accurate motion). */
export function step(s: OpState, dt: number) {
  if (s.finished) return;
  let left = Math.min(dt, s.endT - s.t);
  while (left > 0) {
    const h = Math.min(1, left);
    stepOnce(s, h);
    left -= h;
  }
}

// ---------- scoring ----------

export interface OpScore {
  received: number;
  flown: number;
  droneFirst: number;
  headStartMedianS: number | null;
  responseMedianS: number | null; // CAD entry -> drone on scene
  clearedOk: number;
  clearedWrong: number;
  clearedUnknown: number;
  missed: number; // officer handled it without a drone
  officerFirst: number;
  skipped: number;
  open: number;
  // Impact: how the program helped people, and who did the work.
  headStartTotalS: number; // summed time eyes were on scene before an officer would have been
  officerFreedS: number; // real officer time (travel + on scene) given back by correct clearances
  highRiskScouted: number; // weapon/violence calls the drone saw before officers arrived
  callTakerMedianS: number | null; // 911 received -> in CAD
  launches: number;
  decisions: number;
  kmFlown: number;
  officerVisits: number; // calls an officer still went to in person
  officerArrests: number; // of those, ended in an arrest, citation or report
}

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

export function score(s: OpState): OpScore {
  const vis = visibleCalls(s);
  const flown = vis.filter((c) => c.launchedAt != null);
  const first = vis.filter((c) => c.droneAt != null && (c.officerAt == null || c.droneAt < c.officerAt || c.decision === "clear"));
  const count = (o: Outcome) => vis.filter((c) => c.outcome === o).length;
  return {
    received: vis.length,
    flown: flown.length,
    droneFirst: first.length,
    headStartMedianS: median(first.filter((c) => c.officerAt != null).map((c) => c.officerAt! - c.droneAt!)),
    responseMedianS: median(vis.filter((c) => c.droneAt != null).map((c) => c.droneAt! - c.visibleAt)),
    clearedOk: count("cleared_ok"),
    clearedWrong: count("cleared_wrong"),
    clearedUnknown: count("cleared_unknown"),
    missed: count("not_flown"),
    officerFirst: count("officer_first"),
    skipped: count("skipped"),
    open: vis.filter((c) => c.status !== "closed").length,
    headStartTotalS: first.filter((c) => c.officerAt != null).reduce((t, c) => t + (c.officerAt! - c.droneAt!), 0),
    officerFreedS: vis.filter((c) => c.outcome === "cleared_ok").reduce((t, c) => t + (officerTimeS(c) ?? 0), 0),
    highRiskScouted: first.filter((c) => storyFor(c.src.typeO, c.src.typeODesc).highRisk).length,
    callTakerMedianS: median(vis.map((c) => c.visibleAt - c.t)),
    launches: flown.length,
    decisions: vis.filter((c) => c.decision != null || c.outcome === "skipped").length,
    kmFlown: s.kmFlown,
    officerVisits: vis.filter((c) => c.officerArrived).length,
    officerArrests: vis.filter((c) => c.officerArrived && ["ARR", "CIT", "REP"].includes(c.src.dispo)).length,
  };
}

// ---------- baseline policy ----------

const CLEARABLE_READ = /No one matching|appear secure|nothing criminal|cancelled/;

/**
 * Simple automatic operator, for comparison with the human: launch the fastest free docked drone on
 * every new call, clear a call only on an unambiguous "nothing here" read, otherwise keep the officer coming.
 */
export function autoPolicy(s: OpState) {
  for (const c of visibleCalls(s)) {
    if (c.status === "waiting" && c.launchedAt == null) {
      const best = candidates(s, c).find((x) => !x.reason && !x.divert);
      if (best) launch(s, c.id, best.drone.id);
    }
    if (c.status === "onscene" && c.report && !c.decision) {
      decide(s, c.id, !c.report.ambiguous && CLEARABLE_READ.test(c.report.text) ? "clear" : "officer");
    }
  }
}

/** Play a whole shift with the automatic policy (same seed, so the same calls as the human saw). */
export function runAuto(cfg: OpConfig): OpScore {
  const s = createOperator(cfg);
  while (!s.finished) {
    step(s, 5);
    autoPolicy(s);
  }
  return score(s);
}
