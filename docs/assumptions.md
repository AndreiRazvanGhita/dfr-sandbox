# Assumptions

Generated from `config/assumptions.json` by `npm run docs`. Every number the model uses lives in that file with its source;
the app's info tooltips show the same source text. "Assumption." marks a judgement call with no external source.

## data

| Parameter | Value | Unit | Source | Note |
|---|---|---|---|---|
| callsDataset | 2zdj-bwza | Socrata id | DataSF, Law Enforcement Dispatched Calls for Service: Closed, <https://data.sf.gov/d/2zdj-bwza> (PDDL) | Domain moved from data.sfgov.org to data.sf.gov in 2026; old host 301-redirects. |
| callFilter | agency = 'Police' AND onview_flag = 'N' | SoQL | Dataset explainer, <https://sfdigitalservices.gitbook.io/dataset-explainers/law-enforcement-dispatched-calls-for-service> | 911-originated police calls only. On-view calls (officer already present), HSOC, MTA, Sheriff and HEART are excluded because a drone cannot beat an officer who initiated the call. |
| districtsDataset | d4vc-q76h | Socrata id | DataSF, Current Police Districts, <https://data.sf.gov/d/d4vc-q76h> (PDDL) | New SFPD boundaries effective 2026-10-01. Every call is re-assigned to these boundaries by point-in-polygon so historical days can be replayed under the new districts. |
| locationMasking | nearest intersection |  | DataSF dataset description (Feb 2025 revision note: consistent geo-masked intersections applied to all history) | Error is at most about half a block (~50-100 m), small next to 1-3 km flights. Calls with no location and sensitive calls (location withheld) are excluded and counted. |

## dispatch

| Parameter | Value | Unit | Source | Note |
|---|---|---|---|---|
| maxResponseRadiusKm | 3.2 | km | Assumption (2 miles), common DFR planning radius per dock. | Calls farther than this from every dock are missed as out of range, even if battery would allow it. |
| skipDuplicateCalls | true | bool | DataSF field dup_cad_number. | Calls flagged as duplicates of another CAD event are not flown twice. |

## eligibility

| Parameter | Value | Unit | Source | Note |
|---|---|---|---|---|
| defaultCallTypes | 23 items: 917, 916, 459, 221, 222, 216, 418, 240, 245, 212, 211, 852, 851, 1030, 100A, 603, 602, 519, 519HR, 809, 807, 594, 601 | call_type codes | SFPD Drone Flight Logs (giw5-ttjs): most-flown original call types 2024-2026 are wanted/suspicious vehicle, person w/ gun, suspicious person, burglary, assault, auto boost, fight, person w/ knife, robbery, stolen vehicle. Extended with alarms, prowler, break-in, injury accidents, missing persons, vandalism, trespasser. | 917 suspicious person, 916 suspicious vehicle, 459 burglary, 221 person w/ gun, 222 person w/ knife, 216 shots fired, 418 fight no weapon, 240 assault/battery, 245 agg assault/ADW, 212 strongarm robbery, 211 robbery, 852 auto boost/strip, 851 stolen vehicle, 1030 wanted vehicle, 100A audible alarm, 603 prowler, 602 person breaking in, 519 injury vehicle accident, 519HR hit-and-run injury, 809 missing adult, 807 missing juvenile, 594 vandalism, 601 trespasser. |
| excludedByDefault | 418DV, 240DV, 800, 801, 415 | call_type codes | Assumption (privacy / policy). | Domestic violence, mental health and suicide attempts, and noise complaints are off by default: aerial video inside or near homes raises privacy questions that a pilot program would likely settle in policy first. All are toggleable. |
| defaultPriorities | A, B, C | priority codes | Trial Phoenix registration (AEA RCT 18198) targets lower-priority calls; Mission Local 2026-06 on SoMa pilot. | All priorities are eligible by default; results are always split by priority so queue-driven gains on B/C are not confused with speed. |

## aircraft

| Parameter | Value | Unit | Source | Note |
|---|---|---|---|---|
| multirotor.label | Dock multirotor |  | Generic profile. |  |
| multirotor.launchS | 20 | s | Vendor DFR claim: 'launch in under 20 seconds', <https://www.skydio.com/solutions/dfr> | From launch decision to en route: dock open, takeoff. |
| multirotor.cruiseAltitudeFt | 200 | ft AGL | Assumption. | Typical DFR transit altitude; used for climb time and (later) the FAA facility-map ceiling check. |
| multirotor.climbRateMs | 6 | m/s | Assumption, typical enterprise multirotor ascent rate. |  |
| multirotor.cruiseSpeedMs | 18 | m/s | Published class specs: 20 m/s max (16 m/s with obstacle avoidance active), <https://skydio.com/x10/technical-specs> ; 21 m/s sport / 15 m/s normal, <https://enterprise.dji.com/dock-2/specs> | 18 m/s (~40 mph) sits between obstacle-avoidance-on and max speed for transit at 200 ft AGL. |
| multirotor.landingS | 30 | s | Assumption. | Descent from cruise altitude, precision landing and dock close at the end of the return leg. |
| multirotor.enduranceMin | 40 | min | Published class specs: 40 min max flight (35 min hover), <https://skydio.com/x10/technical-specs> ; 50 min max flight (40 min hover), <https://enterprise.dji.com/dock-2/specs> | Full battery, still air. |
| multirotor.reservePct | 20 | % | Assumption, common operational reserve. | Drone leaves scene when remaining battery would drop below this after the return leg. |
| multirotor.minLaunchPct | 50 | % | Assumption, operational policy. | A drone is only offered for a response with at least this charge (and always enough for out, back, minimum on-scene time and reserve). Without it, a single drone recycles on near-empty batteries and flies far more, far shorter missions than real programs report. |
| multirotor.chargeRatePctPerMin | 2.2 | %/min | Published dock spec: 20->90% in ~32 min, <https://enterprise.dji.com/dock-2/specs> | Linear approximation (70% / 32 min). |

## fixedWing

| Parameter | Value | Unit | Source | Note |
|---|---|---|---|---|
| label | Long-range fixed-wing (VTOL) |  | Generic profile. | Vertical take-off, transitions to wing-borne flight; orbits the scene instead of hovering. |
| cruiseSpeedMs | 40 | m/s | Vendor DFR page: fixed-wing layer 'up to 100 mph' (44.7 m/s), <https://www.skydio.com/solutions/dfr> | Cruise (~90 mph) set a little under the quoted maximum. |
| launchS | 45 | s | Assumption. | Hub open, vertical take-off and transition to forward flight; slower than a multirotor dock launch. |
| cruiseAltitudeFt | 400 | ft AGL | Assumption (Part 107 ceiling). |  |
| climbRateMs | 5 | m/s | Assumption. |  |
| landingS | 60 | s | Assumption. | Transition back to hover, descent and landing in the hub. |
| enduranceMin | 120 | min | Vendor DFR page: '2 hours or more' endurance, <https://www.skydio.com/solutions/dfr> |  |
| reservePct | 20 | % | Assumption, same as multirotor. |  |
| minLaunchPct | 50 | % | Assumption, same as multirotor. |  |
| chargeRatePctPerMin | 1.2 | %/min | Assumption. | Larger pack: about 65 min from 20% to full. |
| responseRadiusKm | 48 | km | Vendor DFR page: '30-mile radius', <https://www.skydio.com/solutions/dfr> | Covers all of San Francisco from any hub in the city. |
| orbitRadiusM | 150 | m | Assumption (replay animation only). |  |

## operators

| Parameter | Value | Unit | Source | Note |
|---|---|---|---|---|
| count | 1 | people | Assumption. | Remote operators on shift. |
| maxConcurrentDrones | 1 | drones per operator | Assumption. | Active missions one operator can supervise at once (launch until the drone leaves the scene). |
