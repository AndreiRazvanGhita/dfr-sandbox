import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";
import { callsForDay, markIncomplete } from "../../sim/data";
import { eligibilityTest } from "../../sim/scenario";
import { candidates, createOperator, decide, launch, recall, runAuto, score, skip, step, type OpScore, type OpState } from "../../sim/operator";
import { PRESETS, presetById } from "../../sim/presets";
import type { Call, CallsMonthFile } from "../../sim/types";
import { loadBasemap, saveBasemap, type BasemapKind } from "../basemap";
import { BasemapToggle, CallCard, CallList, EndScreen, FleetStrip, openCalls, StartScreen, TopBar } from "./Hud";
import type { CamMode, CamTarget } from "./camera";
import { OperatorMap } from "./OperatorMap";
import { isMuted, setMuted, sfx, unlockAudio } from "./sfx";

type Manifest = { months: { month: string; days: { date: string; calls: number }[] }[] };

// Every loaded day, fetched once and shared by all shifts.
let allDaysPromise: Promise<{ calls: Call[]; days: number }> | null = null;
function loadAllDays() {
  allDaysPromise ??= (async () => {
    const manifest = (await (await fetch("/data/manifest.json")).json()) as Manifest;
    const incomplete = markIncomplete(manifest.months.flatMap((m) => m.days));
    const calls: Call[] = [];
    let days = 0;
    for (const m of manifest.months) {
      const file = (await (await fetch(`/data/calls-${m.month}.json`)).json()) as CallsMonthFile;
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

export function OperatorView({ districts }: { districts: FeatureCollection | null }) {
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
  const [toast, setToast] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{ text: string; kind: "good" | "bad" | "neutral" } | null>(null);
  const [muted, setMutedState] = useState(isMuted);
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
    if (!verdict) return;
    const id = window.setTimeout(() => setVerdict(null), 4200);
    return () => clearTimeout(id);
  }, [verdict]);
  useEffect(() => {
    if (!ticker) return;
    const id = window.setTimeout(() => setTicker(null), 4500);
    return () => clearTimeout(id);
  }, [ticker]);

  const pool = useMemo(() => (all ? all.calls.filter(eligibilityTest(scenario)) : []), [all, scenario]);

  const refresh = () => setTick((n) => n + 1);

  const start = () => {
    if (!all || pool.length === 0) return;
    unlockAudio();
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

  // Simulation loop: advance by real elapsed time x speed; React re-renders about 8 times a second.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const loop = (now: number) => {
      const s = simRef.current;
      if (!s) return;
      step(s, Math.min(0.25, (now - last) / 1000) * speed);
      last = now;

      // Surface notable events briefly with a sound; select new calls when nothing is selected.
      const fresh = s.events.slice(lastEvent.current);
      lastEvent.current = s.events.length;
      const notable = fresh.filter((e) => e.kind !== "call" && e.kind !== "decision").at(-1);
      if (notable) setTicker({ text: notable.text, target: eventTarget(notable) });
      for (const e of fresh) {
        const prio = s.calls.find((c) => c.id === e.callId)?.src.prioO;
        if (e.kind === "call") {
          sfx(prio === "A" ? "callA" : "call");
          if (e.callId) pullFocus({ kind: "call", id: e.callId }, prio === "A" ? 80 : prio === "B" ? 50 : 30, prio === "A" ? 4500 : 3200);
        } else if (e.text.startsWith("Scene read") && e.callId) {
          pullFocus({ kind: "call", id: e.callId }, 100, 7000);
        } else if (e.text.includes(" on scene at ")) {
          sfx("arrive");
          if (e.callId) pullFocus({ kind: "call", id: e.callId }, 70, 4000);
        } else if (e.kind === "warn" && !e.text.startsWith("Shift")) {
          sfx("warn");
          const t = eventTarget(e);
          if (t) pullFocus(t, 40, 3000);
        }
      }
      // Impact moments (eyes on sooner, officer freed) get a quick look too.
      for (const imp of s.impacts.slice(lastImpact.current)) pullFocus({ kind: "call", id: imp.callId }, 60, 3200);
      lastImpact.current = s.impacts.length;
      const newCall = fresh.filter((e) => e.kind === "call").at(-1);
      if (newCall?.callId) setSelected((cur) => cur ?? newCall.callId!);

      const read = fresh.find((e) => e.text.startsWith("Scene read"));
      if (pauseOnRead && read?.callId) {
        setSelected(read.callId);
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
    const before = s.events.length;
    const err = fn(s);
    if (err) setToast(err);
    // Immediate feedback for launches and clearance decisions.
    for (const e of s.events.slice(before)) {
      if (e.text.includes(" → ")) sfx("launch");
      if (e.kind === "decision" && e.text.startsWith("Cleared")) {
        const kind = e.text.includes("found nothing to act on") ? "good" : e.text.includes("Officers actually") ? "bad" : "neutral";
        const detail = e.text.replace(/^Cleared .*? without an officer\. /, "");
        setVerdict({ kind, text: kind === "good" ? "Good call: officers later found nothing to act on." : detail });
        sfx(kind === "bad" ? "bad" : "good");
      }
    }
    refresh();
  }, []);

  const call = sim?.calls.find((c) => c.id === selected) ?? null;
  const closeIfDone = () => {
    // After acting on a call, move on to the next one that needs attention.
    const s = simRef.current;
    if (!s) return;
    const next = openCalls(s).find((c) => c.id !== selected && (c.status === "waiting" || (c.report && !c.decision)));
    setSelected(next?.id ?? null);
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
        act((st) => decide(st, selected, k === "c" ? "clear" : "officer"));
        if (c?.report && !c.decision) {
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
    camTarget = (camMode === "auto" && ov?.target) || selOpen || ov?.target || { kind: "overview" };
  }
  const ended = sim?.finished && !menu;

  return (
    <div className={sim && !sim.finished && !playing && !menu ? "sim-app is-paused" : "sim-app"}>
      <OperatorMap
        sim={sim}
        districts={districts}
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
            muted={muted}
            helped={score(sim).droneFirst}
            camMode={camMode}
            onCamMode={(m) => {
              focusOverride.current = null;
              setCamMode(m);
            }}
            onMute={() => {
              setMuted(!muted);
              setMutedState(!muted);
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
          {ticker && !verdict && (
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
          {verdict && (
            <div className={`hud verdict ${verdict.kind}`} role="status">
              {verdict.kind === "good" ? "✓ " : verdict.kind === "bad" ? "✗ " : "? "}
              {verdict.text}
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
