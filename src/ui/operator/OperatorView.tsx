import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";
import { callsForDay, markIncomplete } from "../../sim/data";
import { eligibilityTest } from "../../sim/scenario";
import { candidates, createOperator, decide, launch, recall, runAuto, score, skip, step, type OpReveal, type OpScore, type OpState } from "../../sim/operator";
import { PRESETS, presetById } from "../../sim/presets";
import type { StreetGraph } from "../../sim/streets";
import type { Call, CallsMonthFile } from "../../sim/types";
import { loadBasemap, saveBasemap, type BasemapKind } from "../basemap";
import { BasemapToggle, CallCard, CallList, EndScreen, FleetStrip, needsDecision, openCalls, StartScreen, TopBar } from "./Hud";
import type { CamMode, CamTarget } from "./camera";
import { OperatorMap } from "./OperatorMap";

type Manifest = { months: { month: string; days: { date: string; calls: number }[] }[] };

// Every loaded day, fetched once and shared by all shifts.
let allDaysPromise: Promise<{ calls: Call[]; days: number }> | null = null;
function loadAllDays() {
  allDaysPromise ??= (async () => {
    const manifest = (await (await fetch(`${import.meta.env.BASE_URL}data/manifest.json`)).json()) as Manifest;
    const incomplete = markIncomplete(manifest.months.flatMap((m) => m.days));
    const calls: Call[] = [];
    let days = 0;
    for (const m of manifest.months) {
      const file = (await (await fetch(`${import.meta.env.BASE_URL}data/calls-${m.month}.json`)).json()) as CallsMonthFile;
      for (const d of file.days) {
        if (incomplete.has(d)) continue;
        days++;
        calls.push(...callsForDay(file, d));
      }
    }
    return { calls, days };
  })();
  return allDaysPromise;
}


/** What an event is about, for the camera: its call, or the drone it names. */
function eventTarget(e: { callId?: number; text: string }): CamTarget | null {
  if (e.callId) return { kind: "call", id: e.callId };
  const m = /Drone (\S+)/.exec(e.text);
  return m ? { kind: "drone", id: m[1] } : null;
}

export function OperatorView({ districts, streets }: { districts: FeatureCollection | null; streets: StreetGraph | null }) {
  const [all, setAll] = useState<{ calls: Call[]; days: number } | null>(null);
  const [fleet, setFleet] = useState(() => {
    const id = new URLSearchParams(window.location.search).get("preset");
    return PRESETS.some((p) => p.id === id) ? id! : "citywide";
  });
  const [rate, setRate] = useState(1);
  const [startH, setStartH] = useState(15);
  const [hours, setHours] = useState(2);
  const [speed, setSpeed] = useState(20);
  const [pauseOnRead, setPauseOnRead] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const selectedRef = useRef<number | null>(null); // for the simulation loop, which outlives renders
  selectedRef.current = selected;
  const [toast, setToast] = useState<string | null>(null);
  const [reveal, setReveal] = useState<(OpReveal & { label: string }) | null>(null);
  const [stamp, setStamp] = useState<{ text: string; key: number } | null>(null);
  const lastReveal = useRef(0);
  const [ticker, setTicker] = useState<{ text: string; target: CamTarget | null } | null>(null);
  const [camMode, setCamMode] = useState<CamMode>("auto");
  // Short-lived focus from the director (an alert), on top of the selected call.
  const focusOverride = useRef<{ target: CamTarget; until: number; prio: number } | null>(null);
  const lastImpact = useRef(0);
  const [auto, setAuto] = useState<OpScore | null>(null);
  const [menu, setMenu] = useState(true);
  const [basemap, setBasemap] = useState<BasemapKind>(loadBasemap);
  const [, setTick] = useState(0);
  const simRef = useRef<OpState | null>(null);
  const lastEvent = useRef(0);
  // Handle for scripted checks and the recording (read-only use).
  (window as unknown as { __op: typeof simRef }).__op = simRef;
  const sim = simRef.current;
  const scenario = useMemo(() => presetById(fleet)!.build(), [fleet]);

  useEffect(() => {
    loadAllDays().then(setAll).catch((e) => setToast(`Could not load calls: ${e}`));
  }, []);
  useEffect(() => saveBasemap(basemap), [basemap]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!reveal) return;
    const id = window.setTimeout(() => setReveal(null), 5200);
    return () => clearTimeout(id);
  }, [reveal]);
  useEffect(() => {
    if (!stamp) return;
    const id = window.setTimeout(() => setStamp(null), 2600);
    return () => clearTimeout(id);
  }, [stamp]);
  useEffect(() => {
    if (!ticker) return;
    const id = window.setTimeout(() => setTicker(null), 4500);
    return () => clearTimeout(id);
  }, [ticker]);

  const pool = useMemo(() => (all ? all.calls.filter(eligibilityTest(scenario)) : []), [all, scenario]);

  const refresh = () => setTick((n) => n + 1);

  const start = () => {
    if (!all || pool.length === 0) return;
    simRef.current = createOperator({
      scenario,
      pool,
      poolDays: all.days,
      startT: startH * 3600,
      durationS: hours * 3600,
      rateMultiplier: rate,
      seed: Math.floor(Math.random() * 2 ** 31),
    });
    lastEvent.current = simRef.current.events.length;
    lastImpact.current = 0;
    lastReveal.current = 0;
    setReveal(null);
    setStamp(null);
    focusOverride.current = null;
    setCamMode("auto");
    setSelected(null);
    setAuto(null);
    setMenu(false);
    setPlaying(true);
    refresh();
  };

  const finish = (s: OpState) => {
    setPlaying(false);
    setAuto(runAuto(s.cfg));
    refresh();
  };

  /** Let an alert pull the camera for a few seconds, unless something more important already has it. */
  const pullFocus = (target: CamTarget, prio: number, holdMs: number) => {
    const now = performance.now();
    const cur = focusOverride.current;
    if (cur && cur.until > now && cur.prio > prio) return;
    focusOverride.current = { target, prio, until: now + holdMs };
    window.setTimeout(() => setTick((n) => n + 1), holdMs + 50); // return the camera even while paused
  };

  /** Show the newest "what officers actually found" card. */
  const checkReveals = (s: OpState) => {
    const fresh = s.reveals.slice(lastReveal.current);
    lastReveal.current = s.reveals.length;
    const r = fresh.at(-1);
    if (!r) return;
    const c = s.calls.find((x) => x.id === r.callId);
    setReveal({ ...r, label: c ? `${c.src.typeODesc} · ${c.src.district ?? ""}` : "" });
  };
  const deciding = useRef(false);

  // Simulation loop: advance by real elapsed time x speed; React re-renders about 8 times a second.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const loop = (now: number) => {
      const s = simRef.current;
      if (!s) return;
      // The decision moment: time slows while a scene read waits on you.
      step(s, Math.min(0.25, (now - last) / 1000) * speed * (deciding.current ? 0.25 : 1));
      last = now;

      // Surface notable events briefly and let them pull the camera.
      const fresh = s.events.slice(lastEvent.current);
      lastEvent.current = s.events.length;
      const notable = fresh.filter((e) => e.kind !== "call" && e.kind !== "decision").at(-1);
      if (notable) setTicker({ text: notable.text, target: eventTarget(notable) });
      for (const e of fresh) {
        const prio = s.calls.find((c) => c.id === e.callId)?.src.prioO;
        if (e.kind === "call") {
          if (e.callId) pullFocus({ kind: "call", id: e.callId }, prio === "A" ? 80 : prio === "B" ? 50 : 30, prio === "A" ? 4500 : 3200);
        } else if (e.text.startsWith("Scene read") && e.callId) {
          pullFocus({ kind: "call", id: e.callId }, 100, 7000);
        } else if (e.text.includes(" on scene at ")) {
          if (e.callId) pullFocus({ kind: "call", id: e.callId }, 70, 4000);
        } else if (e.kind === "warn" && !e.text.startsWith("Shift")) {
          const t = eventTarget(e);
          if (t) pullFocus(t, 40, 3000);
        }
      }
      // Impact moments (eyes on sooner, officer freed) get a quick look too.
      for (const imp of s.impacts.filter((i) => i.t > lastImpact.current)) {
        pullFocus({ kind: "call", id: imp.callId }, 60, 3200);
        if (imp.kind === "sooner") setStamp((cur) => (cur && imp.callId !== selectedRef.current ? cur : { text: imp.text.replace(/^Eyes on /, ""), key: imp.t }));
      }
      lastImpact.current = s.impacts.at(-1)?.t ?? lastImpact.current;
      checkReveals(s);
      // Stay on the selected call while it waits on a decision. Otherwise, when it closes or a new call or
      // scene read comes in, move to the most urgent call that needs one (scene reads first, then by priority).
      const cur = s.calls.find((c) => c.id === selectedRef.current);
      const pending = cur != null && needsDecision(cur);
      const arrivals = fresh.some((e) => e.kind === "call" || e.text.startsWith("Scene read"));
      if (!pending && (arrivals || !cur || cur.status === "closed")) {
        const next = openCalls(s).find(needsDecision);
        if (next && next.id !== selectedRef.current) {
          selectedRef.current = next.id;
          focusOverride.current = null;
          setSelected(next.id);
        }
      }

      const read = fresh.find((e) => e.text.startsWith("Scene read"));
      if (pauseOnRead && read?.callId && read.callId === selectedRef.current) {
        setPlaying(false);
        setTick((n) => n + 1);
        return;
      }
      if (s.finished) {
        finish(s);
        return;
      }
      if (now - lastUi > 125) {
        lastUi = now;
        setTick((n) => n + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, pauseOnRead]);

  const act = useCallback((fn: (s: OpState) => string | null) => {
    const s = simRef.current;
    if (!s) return;
    const err = fn(s);
    if (err) setToast(err);
    checkReveals(s);
    refresh();
  }, []);

  const call = sim?.calls.find((c) => c.id === selected) ?? null;
  const isDeciding = !!call && call.status === "onscene" && !!call.report && !call.decision;
  deciding.current = isDeciding;
  const closeIfDone = () => {
    // After acting on a call, move on to the next one that needs attention.
    const s = simRef.current;
    if (!s) return;
    // With nothing else waiting, stay on this call to watch the race play out.
    const next = openCalls(s).find((c) => c.id !== selected && needsDecision(c));
    const stillOpen = s.calls.some((c) => c.id === selected && c.status !== "closed");
    focusOverride.current = null;
    setSelected(next?.id ?? (stillOpen ? selected : null));
  };

  const launchBest = () =>
    act((s) => {
      if (!call) return "Select a call first.";
      const best = candidates(s, call).find((x) => !x.reason);
      return best ? launch(s, call.id, best.drone.id) : "No drone can take this call right now.";
    });

  // Keyboard: Space play/pause, L launch fastest, C clear, O keep officer, S leave to officers, R recall, ↑/↓ calls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const s = simRef.current;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(tag) || !s || s.finished || menu) return;
      const open = openCalls(s);
      const idx = open.findIndex((c) => c.id === selected);
      const k = e.key.toLowerCase();
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (k === "l") {
        launchBest();
        closeIfDone();
      } else if ((k === "c" || k === "o") && selected) {
        const c = s.calls.find((x) => x.id === selected);
        const awaiting = !!c?.report && !c.decision; // read before deciding: decide() sets c.decision
        act((st) => decide(st, selected, k === "c" ? "clear" : "officer"));
        if (awaiting) {
          closeIfDone();
          setPlaying(true);
        }
      } else if (k === "s" && selected) {
        act((st) => skip(st, selected));
        closeIfDone();
      } else if (k === "r" && call?.droneId) act((st) => recall(st, call.droneId!));
      else if (e.key === "ArrowDown" && open.length) {
        e.preventDefault();
        setSelected(open[Math.min(open.length - 1, idx + 1)].id);
      } else if (e.key === "ArrowUp" && open.length) {
        e.preventDefault();
        setSelected(open[Math.max(0, idx - 1)].id);
      } else if (e.key === "Escape") {
        setSelected(null);
        focusOverride.current = null;
      } else if (k === "f") {
        setCamMode((m) => (m === "free" ? "auto" : "free"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const docks = scenario.docks.filter((d) => d.drones > 0);
  const onDockClick = (dockId: string) =>
    act((s) => {
      if (!call) return "Select a call first, then click a dock to launch from it.";
      const x = candidates(s, call).find((c) => c.drone.dockId === dockId && !c.reason);
      return x ? launch(s, call.id, x.drone.id) : "That dock has no drone that can take this call.";
    });
  const showMenu = menu || !sim;
  let camTarget: CamTarget | null = null;
  if (sim && !sim.finished && camMode !== "free") {
    const ov = focusOverride.current && focusOverride.current.until > performance.now() ? focusOverride.current : null;
    const selOpen = call && call.status !== "closed" ? ({ kind: "call", id: call.id } as CamTarget) : null;
    // A call waiting on your decision holds the camera: alerts only show in the ticker until you decide.
    // Things you click yourself (a drone in the fleet strip, the ticker) still take it for a moment.
    const holding = call != null && needsDecision(call) && !(ov && ov.prio >= 90);
    camTarget = holding ? selOpen : (camMode === "auto" && ov?.target) || selOpen || ov?.target || { kind: "overview" };
  }
  const ended = sim?.finished && !menu;

  return (
    <div className={["sim-app", sim && !sim.finished && !playing && !menu ? "is-paused" : "", isDeciding && !menu ? "deciding" : ""].join(" ")}>
      <OperatorMap
        sim={sim}
        districts={districts}
        streets={streets}
        docks={docks}
        selected={selected}
        basemap={basemap}
        idle={menu || !sim || !!sim.finished}
        camTarget={camTarget}
        onUserCamera={() => setCamMode("free")}
        onSelect={(id) => {
          focusOverride.current = null;
          setSelected(id);
        }}
        onDockClick={onDockClick}
      />

      {sim && !sim.finished && !showMenu && (
        <>
          <TopBar
            s={sim}
            playing={playing}
            speed={speed}
            onPlay={() => setPlaying(!playing)}
            onSpeed={setSpeed}
            onEnd={() => {
              step(sim, sim.endT - sim.t);
              finish(sim);
            }}
            basemapToggle={<BasemapToggle value={basemap} onChange={setBasemap} />}
            helped={score(sim).droneFirst}
            camMode={camMode}
            onCamMode={(m) => {
              focusOverride.current = null;
              setCamMode(m);
            }}
          />
          <CallList
            s={sim}
            selected={selected}
            onSelect={(id) => {
              // Picking a call is an explicit "show me this": re-lock the camera if it was free.
              focusOverride.current = null;
              setSelected(id);
              setCamMode((m) => (m === "free" ? "auto" : m));
            }}
          />
          {call && call.status !== "closed" && (
            <CallCard
              s={sim}
              simRef={simRef}
              call={call}
              onLaunch={(id) => {
                act((s) => launch(s, call.id, id));
                closeIfDone();
              }}
              onDecide={(d) => {
                act((s) => decide(s, call.id, d));
                closeIfDone();
                if (!playing) setPlaying(true);
              }}
              onSkip={() => {
                act((s) => skip(s, call.id));
                closeIfDone();
              }}
              onRecall={(id) => act((s) => recall(s, id))}
              onClose={() => setSelected(null)}
            />
          )}
          <FleetStrip
            s={sim}
            onPick={(d) => {
              if (d.callId != null) {
                focusOverride.current = null;
                setSelected(d.callId);
              } else {
                pullFocus({ kind: "drone", id: d.id }, 90, 3500);
                refresh();
              }
            }}
          />
          {!playing && <div className="hud paused">Paused · Space to resume</div>}
          {ticker && !reveal && !stamp && (
            <button
              className="hud ticker"
              onClick={() => {
                const t = ticker.target;
                if (t?.kind === "call") {
                  focusOverride.current = null;
                  setSelected(t.id);
                } else if (t) pullFocus(t, 90, 4000);
                if (camMode === "free") setCamMode("auto");
                refresh();
              }}
              title="Show on the map"
            >
              {ticker.target && <span className="ticker-focus">◎</span>}
              {ticker.text}
            </button>
          )}
          {stamp && !reveal && (
            <div key={stamp.key} className="stamp" role="status">
              <b>EYES ON SCENE</b>
              <span>{stamp.text}</span>
            </div>
          )}
          {reveal && (
            <div key={`${reveal.callId}-${reveal.t}`} className={`hud reveal ${reveal.verdict}`} role="status">
              <div className="reveal-inner">
                <span className="reveal-kicker">
                  {reveal.decision === "clear" ? "You cleared it" : "You kept the officer"} · {reveal.label}
                </span>
                <span className="reveal-q">What officers actually found</span>
                <b className="reveal-found">{reveal.found}</b>
                <span className="reveal-text">
                  {reveal.verdict === "right" ? "✓ " : reveal.verdict === "wrong" ? "✗ " : ""}
                  {reveal.text}
                </span>
              </div>
            </div>
          )}
        </>
      )}
      {toast && <div className="hud toast-hud">{toast}</div>}

      {showMenu && (
        <StartScreen
          presets={PRESETS}
          fleet={fleet}
          onFleet={setFleet}
          startH={startH}
          onStartH={setStartH}
          hours={hours}
          onHours={setHours}
          rate={rate}
          onRate={setRate}
          pauseOnRead={pauseOnRead}
          onPauseOnRead={setPauseOnRead}
          ready={!!all && pool.length > 0}
          onStart={start}
        />
      )}
      {ended && <EndScreen sc={score(sim!)} auto={auto} onAgain={start} onMenu={() => setMenu(true)} />}
    </div>
  );
}
