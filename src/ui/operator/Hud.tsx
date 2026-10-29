// Floating controls drawn over the full-screen map. Kept to what an operator needs to act.

import { storyFor } from "../../sim/callStories";
import { candidates, droneOf, etaS, type OpCall, type OpDrone, type OpScore, type OpState } from "../../sim/operator";
import type { Preset } from "../../sim/presets";
import type { BasemapKind } from "../basemap";
import { fmtClock } from "../format";
import type { CamMode } from "./camera";
import { DroneCam } from "./DroneCam";

const PHASE: Record<string, string> = {
  docked: "Ready",
  launching: "Launching",
  enroute: "En route",
  onscene: "On scene",
  returning: "Returning",
  landing: "Landing",
};

export function PriorityBadge({ p }: { p: string }) {
  return <span className={`prio-badge p${p}`} title={`Priority ${p}`}>{p}</span>;
}

const mmss = (sec: number) => `${Math.floor(Math.max(0, sec) / 60)}:${String(Math.floor(Math.max(0, sec) % 60)).padStart(2, "0")}`;
const shortDock = (name: string) => name.replace(/ \(.*\)$/, "").replace("Fire Station ", "FS ").replace(" hub", "");

/** Open calls: the ones needing a decision first, then waiting ones by priority and age. */
export function openCalls(s: OpState): OpCall[] {
  const rank = (c: OpCall) => (c.status === "onscene" && c.report && !c.decision ? 0 : c.status === "waiting" ? 1 : 2);
  return s.calls
    .filter((c) => c.visibleAt <= s.t && c.status !== "closed")
    .sort((a, b) => rank(a) - rank(b) || a.src.prioO.localeCompare(b.src.prioO) || a.visibleAt - b.visibleAt);
}

function stage(s: OpState, c: OpCall): { text: string; cls: string } {
  const d = droneOf(s, c.droneId);
  if (c.status === "waiting") return { text: "Waiting", cls: "waiting" };
  if (c.status === "assigned" && d) return { text: `ETA ${mmss(etaS(d, d.target ?? d.pos))}`, cls: "assigned" };
  if (c.status === "onscene") return c.report && !c.decision ? { text: "Decide", cls: "decide" } : { text: c.decision ? "Overwatch" : "Looking", cls: "watching" };
  return { text: "", cls: "" };
}

// ---------- top bar ----------

interface TopBarProps {
  s: OpState;
  playing: boolean;
  speed: number;
  muted: boolean;
  helped: number;
  camMode: CamMode;
  onCamMode: (m: CamMode) => void;
  onPlay: () => void;
  onSpeed: (v: number) => void;
  onMute: () => void;
  onEnd: () => void;
  basemapToggle: React.ReactNode;
}

export function TopBar({ s, playing, speed, muted, helped, camMode, onCamMode, onPlay, onSpeed, onMute, onEnd, basemapToggle }: TopBarProps) {
  const progress = Math.min(1, (s.t - s.cfg.startT) / s.cfg.durationS);
  return (
    <div className="hud topbar">
      <button className="hud-play" onClick={onPlay} aria-label={playing ? "Pause" : "Resume"} title="Space">
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="hud-clock">
        <span className="num">{fmtClock(s.t)}</span>
        <span className="hud-progress" aria-hidden="true">
          <i style={{ width: `${progress * 100}%` }} />
        </span>
      </div>
      <div className="helped" title="People who had a drone on scene before an officer could get there">
        <span className="helped-heart">♥</span>
        <b className="num">{helped}</b>
        <span>reached sooner</span>
      </div>
      <div className="hud-seg" role="radiogroup" aria-label="Speed">
        {[5, 10, 20, 60].map((v) => (
          <button key={v} role="radio" aria-checked={speed === v} className={speed === v ? "on" : ""} onClick={() => onSpeed(v)}>
            {v}×
          </button>
        ))}
      </div>
      <div className="hud-seg cam-seg" role="radiogroup" aria-label="Camera">
        {(
          [
            ["auto", "🎥 Auto", "Follows your call and swings to new alerts"],
            ["lock", "Lock", "Stays on your selected call"],
            ["free", "Free", "You move the map (F to re-lock)"],
          ] as [CamMode, string, string][]
        ).map(([m, label, tip]) => (
          <button key={m} role="radio" aria-checked={camMode === m} className={camMode === m ? "on" : ""} onClick={() => onCamMode(m)} title={tip}>
            {label}
          </button>
        ))}
      </div>
      {basemapToggle}
      <button className="hud-icon" onClick={onMute} aria-label={muted ? "Sound off" : "Sound on"} title={muted ? "Sound off" : "Sound on"}>
        {muted ? "🔇" : "🔊"}
      </button>
      <button className="hud-btn" onClick={onEnd}>
        End shift
      </button>
    </div>
  );
}

// ---------- call list ----------

export function CallList({ s, selected, onSelect }: { s: OpState; selected: number | null; onSelect: (id: number) => void }) {
  const open = openCalls(s);
  return (
    <div className="hud calllist" aria-label="Open calls">
      <div className="calllist-head">
        <span>Calls</span>
        <span className="muted-w">{open.length} open</span>
      </div>
      {open.length === 0 && <div className="calllist-empty">All quiet. New 911 calls appear here.</div>}
      {open.map((c) => {
        const st = stage(s, c);
        const wait = s.t - c.visibleAt;
        const urgency = Math.min(1, wait / 300);
        return (
          <button key={c.id} className={c.id === selected ? "call-chip on" : "call-chip"} onClick={() => onSelect(c.id)}>
            <PriorityBadge p={c.src.prioO} />
            <span className="chip-main">
              <b>{c.src.typeODesc}</b>
              <span>
                {c.src.district ?? "?"} · {mmss(wait)}
              </span>
            </span>
            <span className={`chip-stage ${st.cls}`}>{st.text}</span>
            {c.status === "waiting" && (
              <span className="chip-wait" aria-hidden="true">
                <i style={{ width: `${urgency * 100}%`, background: urgency > 0.66 ? "#ff5a52" : urgency > 0.33 ? "#fab219" : "#3d8bff" }} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------- selected call ----------

interface CardProps {
  s: OpState;
  simRef: { current: OpState | null };
  call: OpCall;
  onLaunch: (droneId: string) => void;
  onDecide: (d: "clear" | "officer") => void;
  onSkip: () => void;
  onRecall: (droneId: string) => void;
  onClose: () => void;
}

/** Who helps, in order: the 911 call-taker, the operator and drone, then the officer. */
function ChainOfHelp({ s, call }: { s: OpState; call: OpCall }) {
  const drone = droneOf(s, call.droneId);
  const steps: { icon: string; who: string; when: string; state: "done" | "now" | "todo" }[] = [
    { icon: "📞", who: "911 call", when: fmtClock(call.t), state: "done" },
    { icon: "🖥", who: "Call-taker", when: fmtClock(call.visibleAt), state: "done" },
    {
      icon: "🚁",
      who: "Drone",
      when: call.droneAt != null ? fmtClock(call.droneAt) : drone ? `ETA ${mmss(etaS(drone, drone.target ?? drone.pos))}` : "you decide",
      state: call.droneAt != null ? "done" : drone ? "now" : "todo",
    },
    { icon: "🚓", who: "Officer", when: call.officerArrived ? fmtClock(call.officerAt!) : "en route", state: call.officerArrived ? "done" : "now" },
  ];
  return (
    <ol className="chain" aria-label="Who helps on this call">
      {steps.map((st) => (
        <li key={st.who} className={st.state}>
          <span className="chain-icon" aria-hidden="true">
            {st.icon}
          </span>
          <span className="chain-who">{st.who}</span>
          <span className="chain-when num">{st.when}</span>
        </li>
      ))}
    </ol>
  );
}

export function CallCard({ s, simRef, call, onLaunch, onDecide, onSkip, onRecall, onClose }: CardProps) {
  const drone = droneOf(s, call.droneId);
  const story = storyFor(call.src.typeO, call.src.typeODesc);
  const options = call.status === "closed" ? [] : candidates(s, call).filter((x) => x.reason !== "already assigned");
  const ready = options.filter((x) => !x.reason).slice(0, 3);
  const blocked = ready.length === 0 ? options[0]?.reason : null;
  const caption =
    call.status === "onscene"
      ? call.report
        ? call.report.text
        : "Acquiring the scene…"
      : drone
        ? `${PHASE[drone.phase]} to the call · ETA ${mmss(etaS(drone, drone.target ?? drone.pos))}`
        : null;
  return (
    <div className="hud callcard">
      <div className="card-head">
        <PriorityBadge p={call.src.prioO} />
        <div className="card-title">
          <b>{call.src.typeODesc}</b>
          <span>
            {call.src.district ?? "?"} · waiting {mmss(s.t - call.visibleAt)} · {call.officerArrived ? "officer on scene" : "officer en route"}
          </span>
        </div>
        <button className="hud-x" onClick={onClose} aria-label="Close" title="Esc">
          ×
        </button>
      </div>

      <blockquote className="caller" title="Typical caller report for this call type (illustrative)">
        “{story.quote}”
        <span>
          Waiting for help: {story.who}
          {story.highRisk ? " · high risk for officers" : ""}
        </span>
      </blockquote>

      <ChainOfHelp s={s} call={call} />

      {drone && call.status !== "closed" && (
        <DroneCam simRef={simRef} droneId={drone.id} callId={call.id} caption={caption} ambiguous={!!call.report?.ambiguous} />
      )}

      {call.status === "onscene" && call.report && !call.decision ? (
        <div className="card-actions">
          <div className="card-q">Does this call need an officer?</div>
          <div className="btn-pair">
            <button className="hud-btn good" onClick={() => onDecide("clear")}>
              No, clear it <kbd>C</kbd>
            </button>
            <button className="hud-btn" onClick={() => onDecide("officer")}>
              Yes, keep officer <kbd>O</kbd>
            </button>
          </div>
        </div>
      ) : call.status !== "closed" ? (
        <div className="card-actions">
          {drone ? (
            <div className="card-drone">
              <span>
                {shortDock(drone.dockName)} drone · {PHASE[drone.phase]} · battery {Math.round(drone.battery)}%
              </span>
              {drone.phase !== "returning" && drone.phase !== "landing" && (
                <button className="hud-link" onClick={() => onRecall(drone.id)}>
                  Recall <kbd>R</kbd>
                </button>
              )}
            </div>
          ) : (
            <div className="card-q">{ready.length ? "Send a drone?" : "No drone can take this call right now."}</div>
          )}
          {!drone &&
            ready.map((x, i) => (
              <button key={x.drone.id} className={i === 0 ? "hud-btn primary launch" : "hud-btn launch"} onClick={() => onLaunch(x.drone.id)}>
                <span>
                  {x.divert ? "Divert" : "Launch"} from {shortDock(x.drone.dockName)}
                </span>
                <span className="launch-eta">
                  {Math.round(x.eta)} s {i === 0 && <kbd>L</kbd>}
                </span>
              </button>
            ))}
          {!drone && blocked && <span className="card-note">{blocked[0].toUpperCase() + blocked.slice(1)}.</span>}
          <button className="hud-btn ghost" onClick={onSkip}>
            Leave it to officers <kbd>S</kbd>
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------- fleet ----------

export function FleetStrip({ s, onPick }: { s: OpState; onPick: (d: OpDrone) => void }) {
  return (
    <div className="hud fleet-strip" aria-label="Fleet">
      {s.drones.map((d) => {
        const timer =
          d.phase === "enroute" || d.phase === "launching" ? mmss(etaS(d, d.target ?? d.pos)) : d.phase === "onscene" ? mmss(d.phaseT) : null;
        return (
          <button key={d.id} className={`drone-chip ${d.phase}`} onClick={() => onPick(d)} title={`${d.dockName}: ${PHASE[d.phase]}, ${Math.round(d.battery)}%`}>
            <span className="dc-top">
              <span className="dc-name">{shortDock(d.dockName)}</span>
              {d.type === "fixedwing" && <span className="dc-fw">FW</span>}
            </span>
            <span className="dc-batt" aria-hidden="true">
              <i style={{ width: `${Math.max(0, Math.min(100, d.battery))}%` }} className={d.battery < d.ac.minLaunchPct ? "low" : ""} />
            </span>
            <span className="dc-state">
              {PHASE[d.phase]}
              {timer ? ` · ${timer}` : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- start / end ----------

interface StartProps {
  presets: Preset[];
  fleet: string;
  onFleet: (id: string) => void;
  startH: number;
  onStartH: (h: number) => void;
  hours: number;
  onHours: (h: number) => void;
  rate: number;
  onRate: (r: number) => void;
  pauseOnRead: boolean;
  onPauseOnRead: (v: boolean) => void;
  ready: boolean;
  onStart: () => void;
}

const FLEET_BLURB: Record<string, string> = {
  soma: "2 drones · SoMa · calm",
  citywide: "10 drones · whole city · busy",
  fixedwing: "10 drones + 2 fixed-wing · whole city",
};

export function StartScreen(p: StartProps) {
  return (
    <div className="hud-overlay">
      <div className="hud modal">
        <div className="modal-kicker">DFR Operator · San Francisco · real 911 calls</div>
        <h1>Can drones help people faster? And who actually helps?</h1>
        <p className="modal-lead">
          Run the city's drone-as-first-responder program for one shift and find out. Every call is a real San Francisco 911 call; a real
          officer is on the way to each one. Your drones can get there first.
        </p>
        <ol className="howto">
          <li>
            <b>A 911 call comes in.</b> It shows up in Calls and pulses on the map.
          </li>
          <li>
            <b>Launch the nearest drone</b> and watch its live feed as it flies there.
          </li>
          <li>
            <b>Decide from the feed:</b> clear the call, or keep the officer coming.
          </li>
        </ol>
        <div className="modal-label">Fleet</div>
        <div className="fleet-pick">
          {p.presets.map((x) => (
            <button key={x.id} className={x.id === p.fleet ? "fleet-card on" : "fleet-card"} onClick={() => p.onFleet(x.id)}>
              <b>{x.name.replace(" (Southern Station)", "").replace(", 10 docks, 2 operators", "")}</b>
              <span>{FLEET_BLURB[x.id]}</span>
            </button>
          ))}
        </div>
        <div className="modal-row">
          <div>
            <div className="modal-label">Start</div>
            <div className="hud-seg">
              {[8, 12, 15, 18, 22].map((h) => (
                <button key={h} className={p.startH === h ? "on" : ""} onClick={() => p.onStartH(h)}>
                  {fmtClock(h * 3600)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="modal-label">Length</div>
            <div className="hud-seg">
              {[1, 2, 4].map((h) => (
                <button key={h} className={p.hours === h ? "on" : ""} onClick={() => p.onHours(h)}>
                  {h} h
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="modal-label">Calls</div>
            <div className="hud-seg">
              {[1, 2, 3].map((r) => (
                <button key={r} className={p.rate === r ? "on" : ""} onClick={() => p.onRate(r)}>
                  {r === 1 ? "Real" : `×${r}`}
                </button>
              ))}
            </div>
          </div>
        </div>
        <label className="modal-check">
          <input type="checkbox" checked={p.pauseOnRead} onChange={(e) => p.onPauseOnRead(e.target.checked)} />
          Pause when a drone reaches a scene
        </label>
        <button className="hud-btn primary big" onClick={p.onStart} disabled={!p.ready}>
          {p.ready ? "Start shift" : "Loading calls…"}
        </button>
        <p className="modal-foot">
          Every call is a real San Francisco 911 call, re-timed, with its real officer arrival; what the drone sees is based on what officers
          actually found. Keys: Space pause · L launch · C clear · O keep officer · S leave to officers · R recall · ↑↓ calls · F camera · Esc.
        </p>
      </div>
    </div>
  );
}

const hm = (sec: number) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
};

export function EndScreen({ sc, auto, onAgain, onMenu }: { sc: OpScore; auto: OpScore | null; onAgain: () => void; onMenu: () => void }) {
  const cleared = sc.clearedOk + sc.clearedUnknown;
  const avgHead = sc.droneFirst ? sc.headStartTotalS / sc.droneFirst : 0;
  return (
    <div className="hud-overlay">
      <div className="hud modal end">
        <div className="modal-kicker">Shift report · how drones helped people</div>
        <h1 className="end-headline">
          {sc.droneFirst > 0 ? (
            <>
              You got eyes on <span className="hl">{sc.droneFirst}</span> {sc.droneFirst === 1 ? "emergency" : "emergencies"} before an
              officer could, about <span className="hl">{hm(avgHead)}</span> sooner each.
            </>
          ) : (
            <>No drone reached a scene before an officer this shift.</>
          )}
        </h1>
        <div className="impact-grid">
          <div className="impact-card">
            <span className="ic-icon">⏱</span>
            <b className="num">{hm(sc.headStartTotalS)}</b>
            <span>of earlier help for people waiting</span>
          </div>
          <div className="impact-card">
            <span className="ic-icon">🚓</span>
            <b className="num good">{hm(sc.officerFreedS)}</b>
            <span>
              officer time returned to patrol ({cleared} {cleared === 1 ? "call" : "calls"} cleared correctly)
            </span>
          </div>
          <div className="impact-card">
            <span className="ic-icon">🛡</span>
            <b className="num">{sc.highRiskScouted}</b>
            <span>high-risk scenes seen before officers walked in</span>
          </div>
          <div className="impact-card">
            <span className="ic-icon">⚠</span>
            <b className="num bad">{sc.clearedWrong}</b>
            <span>calls you cleared that still needed an officer</span>
          </div>
        </div>
        <div className="modal-label">Who helped</div>
        <div className="who-grid">
          <div>
            <span className="who-icon">📞</span>
            <b>911 call-takers</b>
            <span>
              took {sc.received} calls and put each into dispatch in a median {sc.callTakerMedianS != null ? mmss(sc.callTakerMedianS) : "–"}
            </span>
          </div>
          <div>
            <span className="who-icon">🎮</span>
            <b>You, the operator</b>
            <span>
              launched {sc.launches} {sc.launches === 1 ? "flight" : "flights"} and made {sc.decisions}{" "}
              {sc.decisions === 1 ? "decision" : "decisions"} on whether an officer was needed
            </span>
          </div>
          <div>
            <span className="who-icon">🚁</span>
            <b>The drones</b>
            <span>flew {sc.kmFlown.toFixed(0)} km and were first on scene {sc.droneFirst} times</span>
          </div>
          <div>
            <span className="who-icon">👮</span>
            <b>Officers</b>
            <span>
              still went to {sc.officerVisits} calls in person; {sc.officerArrests} ended in an arrest, citation or report
            </span>
          </div>
        </div>
        <p className="end-answer">
          Drones don't replace officers. They get there first, show what is happening, and let officers go where they are actually needed.
          {auto ? ` An auto-dispatcher on the same calls reached ${auto.droneFirst} people first and freed ${hm(auto.officerFreedS)}.` : ""}
        </p>
        <div className="card-actions row">
          <button className="hud-btn primary big" onClick={onAgain}>
            Play again
          </button>
          <button className="hud-btn big" onClick={onMenu}>
            Change fleet
          </button>
        </div>
      </div>
    </div>
  );
}

export function BasemapToggle({ value, onChange }: { value: BasemapKind; onChange: (k: BasemapKind) => void }) {
  return (
    <div className="basemap-toggle seg" role="radiogroup" aria-label="Basemap">
      {(["satellite", "streets"] as BasemapKind[]).map((k) => (
        <button key={k} role="radio" aria-checked={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>
          {k === "satellite" ? "Satellite" : "Streets"}
        </button>
      ))}
    </div>
  );
}
