# DFR Sandbox · San Francisco

**A drone-as-first-responder (DFR) simulation over San Francisco that asks one question: can drones help people faster, and who
actually helps?** You run the city's drone program for a shift: real 911 calls come in over a full-screen satellite map, and you
decide which drone to launch, when to divert or recall it, and whether what the drone sees means the call can be cleared without
sending an officer. The shift report answers the question with what you did: people reached before an officer could, minutes of
earlier help, real officer time returned to patrol, high-risk scenes seen before officers walked in, and the mistakes. It also shows
who did the work: 911 call-takers, you, the drones and the officers who still went in person.

This is a **counterfactual replay, not a prediction.** Officers arrive exactly when they really did; the simulation asks what a drone
program would have added on top of that, under stated assumptions. It ignores weather, airspace, how a drone's presence would change
officer behaviour, connectivity, privacy policy and cost (see [Limitations](#limitations)).

---

## Quick start

```bash
npm install
npm start
```

Opens the simulation at `http://localhost:5173`. Needs Node 20+ (built on Node 24). The data is pre-built in `public/data/` (2.8 MB: calls and district boundaries),
so no download or API key is needed. The map is Esri World Imagery (0.3 m over San Francisco, fetched at double resolution on
high-DPI screens) with OpenStreetMap labels; a Streets basemap is one click away in the top bar. `?preset=soma|citywide|fixedwing` pre-selects a fleet.

## The simulation

Pick a fleet (SoMa pilot, citywide, citywide + fixed-wing), a start time, a shift length and a call volume, and start the shift.
The screen is the map plus four floating controls: the clock and speed (top left), the open calls with wait-time bars and drone ETAs
(top right), the selected call with a **live drone camera feed** and its actions (bottom right), and the fleet with battery levels and
timers (bottom left). Drones fly as rotating icons with trails, calls pulse in their priority colour, officers show up as a badge when
they reach a scene, every clearance gets an instant verdict, a heart counter tracks people reached sooner, imagery dims at night with the shift clock,
the start screen orbits the city in 3D, and there are sound cues (toggle in the top bar).

**Camera.** In *Auto* the camera locks onto your selected call and swings to each new alert (decisions first, then new priority A
calls, drones arriving, impact moments), holding a few seconds before coming back. It frames a waiting call close up, a drone in
flight together with its destination as a chase shot, and orbits the scene once the drone is overhead. *Lock* stays on your call;
*Free* hands the map to you, and dragging or scrolling switches to it. F toggles Free and Auto; clicking an alert or a call
re-locks onto it.

- **Calls arrive at random but are real.** Arrivals follow a Poisson process at San Francisco's real rate for each hour of the day,
  and every call is a real drone-eligible 911 call from the 56 loaded days, re-timed: its type, priority, masked location,
  call-taking delay, real officer arrival time and real final disposition all come with it. Volume ×2 and ×3 stress the fleet.
- **You make the calls.** Select a call in the CAD queue or on the map; launch the fastest drone (the map shows dashed ETA lines from
  every dock), launch from a specific dock by clicking it, divert an airborne drone, recall one, or skip the call and leave it to officers.
- **On scene you decide.** About 20 s after arriving, the drone gives a scene read: "no one matching the description", "activity
  matching the call is visible", "premises appear secure"… You clear the call without an officer, or keep the officer coming while the
  drone gives overwatch. 15% of reads are blocked by rooftops and trees.
- **Scoring is against the record.** Clearing a call counts as right when officers really found nothing to act on (gone on arrival,
  unable to locate, premises secure, non-criminal, no merit, cancelled) and wrong when they made an arrest, wrote a report, cited
  or handled something. Officers arrive at their real times unless you cleared the call first; drones head home when the officer is
  on scene or the battery reaches what the trip home needs.
- **Who helps, on every call.** Each call shows what a caller typically reports for that call type (illustrative), who is waiting
  for help, and a chain of help: 911 call → call-taker → drone → officer, filling in as each one arrives. When a drone beats the
  officer or a clearance frees an officer, the map shows it at the call ("Eyes on 18 min sooner", "Officer freed · 12 min").
- **Officer time returned is real.** It is the actual travel and on-scene time officers spent on that call (dispatch to close in the
  record), counted only when your clearance matches what they found.
- **End of shift.** The shift report answers the question and is compared with an auto-dispatch rule playing the exact same calls
  (fastest free drone on every call, clear only on an unambiguous "nothing here" read). Over 3 hours at double volume citywide,
  that rule clears about 36 of 122 calls correctly (`npm run bot -- citywide 2`).
- **Keys**: Space pause · L launch fastest · C clear · O keep officer · S leave to officers · R recall · ↑/↓ move through calls · F camera free/auto · Esc deselect.

The scene read is a stand-in: it is derived from what officers eventually recorded, and a real camera would not always see that.
It makes the decision concrete without pretending to model video.

## Why San Francisco, why now

SFPD already flies drones (10,010 logged flights since May 2024, about 37 a day in Sept 2026) and plans a DFR pilot in SoMa for
fall 2026, alongside new police district boundaries that took effect on Oct 1, 2026 (Southern Station now runs up to Market St).
The city publishes every dispatched call with received, entry, dispatch and on-scene timestamps. That makes it possible to ask a
concrete question: *on real days, what would a given drone program have done?*

## Flight model

Drone ETAs, battery and recharging come from generic aircraft profiles in [`config/assumptions.json`](config/assumptions.json):
launch, climb to cruise altitude, straight-line cruise to the scene, orbit, fly home, land, recharge. A drone can launch once it has
the minimum charge and enough for the round trip plus reserve. Each dock serves calls within its response radius; the fixed-wing hub
reaches the whole city. Operators cap how many drones can be airborne at once.

## Data

| Data | Source | License | Use |
|---|---|---|---|
| Law Enforcement Dispatched Calls for Service: Closed | [DataSF `2zdj-bwza`](https://data.sf.gov/d/2zdj-bwza) | PDDL | 37,496 911-originated police calls, Aug + Oct 2026 |
| Current Police Districts (Oct 1, 2026 boundaries) | [DataSF `d4vc-q76h`](https://data.sf.gov/d/d4vc-q76h) | PDDL | Every call re-assigned to the new districts |
| Aerial imagery | [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) (Vantor, Earthstar Geographics) | Esri terms of use, attribution required; check them before any commercial use | Satellite basemap and drone camera feed |
| Basemap and labels | [OpenFreeMap](https://openfreemap.org) | OpenStreetMap data, ODbL | Streets basemap; street and neighbourhood labels on imagery |

Filters: agency = Police and `onview_flag = N` (on-view calls are excluded because the officer is already there). DataSF geo-masks
every location to the nearest intersection (at most about half a block). About 5.8% of calls have no location, almost all of them
flagged sensitive by DataSF; they are excluded and counted.

## Key assumptions

Every number lives in [`config/assumptions.json`](config/assumptions.json) with its source; the full table is generated in
[`docs/assumptions.md`](docs/assumptions.md) (33 parameters).

| Assumption | Value | Source |
|---|---|---|
| Multirotor launch / cruise / altitude | 20 s / 18 m/s / 200 ft | Vendor DFR claim; published class specs (16–21 m/s) |
| Endurance / reserve / min charge to launch | 40 min / 20% / 50% | Published class specs; operational assumptions |
| Charge rate | 2.2 %/min (20→90% in 32 min) | Published dock spec |
| Response radius per dock | 3.2 km (2 mi) | Common DFR planning radius (assumption) |
| Fixed-wing | 40 m/s, 45 s launch, 120 min, 48 km | Vendor DFR page ("up to 100 mph", "30-mile radius", "2+ hours"); launch time assumed |

Aircraft are generic profiles; manufacturer pages are cited only as evidence for the class.

## Limitations

- **Officer behaviour is held fixed.** In reality a drone's first look would change who gets dispatched and how fast.
- **No weather or airspace.** Drones always fly: no wind or fog grounding, no SFO Class B ceilings, no stadium TFRs.
- **Straight-line flight**, no building avoidance, no connectivity or GPS issues.
- **The scene read is derived from the final disposition**, which a real camera would not always see.
- **Calls are re-timed real calls**, not new ones; arrival rates follow the real hourly pattern.
- **On-scene officer times are self-reported** by button press, and about 9% of calls have none.
- **Locations are geo-masked** to intersections; calls flagged sensitive have no location and are excluded.
- **Data gaps**: Oct 12, 2026 has 37 calls instead of about 650 and is left out of the call pool.
- **Cost, privacy policy and community acceptance** are out of scope, and they decide real programs.

## Privacy

The app shows calls as dots at DataSF's masked intersections, with call type, priority and district only. No CAD numbers,
addresses or notes are shipped or displayed, and every call is re-timed into the simulated shift, so the clock times on screen
are not the real ones. Caller quotes are illustrative and keyed only on the call type.

## Reproduce

```bash
npm run data       # rebuild public/data from DataSF (Python 3.9+, stdlib only)
npm run bot -- citywide 2   # play a shift with the auto-dispatch rule (fleet, call volume)
npm run docs       # writes docs/assumptions.md from config/assumptions.json
npm run build      # typecheck and production build
```

## Project layout

```
config/assumptions.json   every parameter with its source
pipeline/build_data.py    DataSF → public/data (stdlib Python)
src/sim/                  operator simulation, fleets, aircraft defaults, call data (no DOM)
src/ui/operator/          the simulation: full-screen map, HUD, camera, drone feed, sound
scripts/                  auto-dispatch bot and the assumptions doc generator
docs/                     generated assumptions table
```

## Licenses

Data: DataSF datasets are PDDL; imagery © Esri, Vantor,
Earthstar Geographics and the GIS User Community; labels and streets basemap © OpenStreetMap contributors (ODbL) via OpenFreeMap. No license has been chosen for the code yet.
