// Street routing for officer cars on the map: a graph of DataSF street centerlines and shortest paths over it.

import { haversineM } from "./geo";

export interface StreetsFile {
  nodes: [number, number][];
  /** [from node, to node, one-way (1 from->to, -1 to->from, 0 both), interior shape as flat lon,lat pairs] */
  edges: [number, number, number, number[]][];
}

interface Arc {
  to: number;
  edge: number;
  len: number;
  forward: boolean; // traverses the edge in its stored direction
  allowed: boolean; // legal under one-way rules
}

export interface StreetGraph {
  file: StreetsFile;
  adj: Arc[][];
}

/** A drivable polyline with cumulative distances, for placing a car along it. */
export interface Path {
  pts: [number, number][];
  cum: number[];
  len: number;
}

function shape(f: StreetsFile, e: number): [number, number][] {
  const [a, b, , mid] = f.edges[e];
  const pts: [number, number][] = [f.nodes[a]];
  for (let i = 0; i < mid.length; i += 2) pts.push([mid[i], mid[i + 1]]);
  pts.push(f.nodes[b]);
  return pts;
}

function lengthOf(pts: [number, number][]): number {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += haversineM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return m;
}

export function buildGraph(file: StreetsFile): StreetGraph {
  const adj: Arc[][] = file.nodes.map(() => []);
  file.edges.forEach(([a, b, way], e) => {
    const len = lengthOf(shape(file, e));
    adj[a].push({ to: b, edge: e, len, forward: true, allowed: way >= 0 });
    adj[b].push({ to: a, edge: e, len, forward: false, allowed: way <= 0 });
  });
  return { file, adj };
}

/** Closest intersection to a point (a quick equirectangular scan; ~9k nodes). */
export function nearestNode(g: StreetGraph, lon: number, lat: number): number {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = 0;
  let bestD = Infinity;
  g.file.nodes.forEach(([x, y], i) => {
    const d = ((x - lon) * k) ** 2 + (y - lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Shortest drivable path between two intersections (Dijkstra with a binary heap). */
function dijkstra(g: StreetGraph, from: number, to: number, oneWay: boolean): number[] | null {
  const n = g.adj.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prevArc: (Arc | null)[] = new Array(n).fill(null);
  const prevNode = new Int32Array(n).fill(-1);
  const heap: [number, number][] = [[0, from]];
  dist[from] = 0;
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    if (u === to) break;
    for (const arc of g.adj[u]) {
      if (oneWay && !arc.allowed) continue;
      const nd = d + arc.len;
      if (nd < dist[arc.to]) {
        dist[arc.to] = nd;
        prevArc[arc.to] = arc;
        prevNode[arc.to] = u;
        push([nd, arc.to]);
      }
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  // Rebuild as a list of signed edges: +e forward, -(e+1) backward.
  const edges: number[] = [];
  for (let v = to; v !== from; v = prevNode[v]) {
    const arc = prevArc[v]!;
    edges.push(arc.forward ? arc.edge : -(arc.edge + 1));
  }
  return edges.reverse();
}

export function pathOf(pts: [number, number][]): Path {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}

/** Points along a list of signed edges (+e forward, -(e+1) backward). */
function expand(g: StreetGraph, edges: number[]): [number, number][] {
  const pts: [number, number][] = [];
  for (const se of edges) pts.push(...(se >= 0 ? shape(g.file, se) : shape(g.file, -se - 1).reverse()));
  return pts;
}

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

/** A random drive along the streets from `start` covering at least minLen metres, staying within maxM of `around`
 * where it can and avoiding U-turns. Returns the signed edges and the node it ends on. */
function cruise(g: StreetGraph, start: number, minLen: number, around: [number, number], maxM: number, rand: () => number) {
  const edges: number[] = [];
  let node = start;
  let cameFrom = -1;
  let len = 0;
  for (let guard = 0; len < minLen && guard < 2000; guard++) {
    const allowed = g.adj[node].filter((a) => a.allowed);
    const legal = allowed.length ? allowed : g.adj[node]; // a one-way dead end: turn out of it anyway
    if (!legal.length) break;
    const ahead = legal.filter((a) => a.to !== cameFrom);
    const near = (ahead.length ? ahead : legal).filter((a) => {
      const [x, y] = g.file.nodes[a.to];
      return haversineM(x, y, around[0], around[1]) <= maxM;
    });
    const pool = near.length ? near : ahead.length ? ahead : legal;
    const arc = pool[Math.floor(rand() * pool.length)];
    edges.push(arc.forward ? arc.edge : -(arc.edge + 1));
    len += arc.len;
    cameFrom = node;
    node = arc.to;
  }
  return { edges, end: node };
}

/** An officer's drive to a scene that keeps the car moving at about speedMs for the whole dispatch-to-arrival time.
 * The car starts from a patrol position 0.6-2 km away (unit locations are not public; seeded per call so it replays
 * the same). If the direct route is longer than the time allows, the car starts partway along it; if shorter, it first
 * cruises nearby streets, then heads in. Returns the path, the distance along it where the car is at dispatch, and
 * where the head-in toward the scene begins (0 when there is no cruise). */
export function officerRoute(
  g: StreetGraph,
  scene: [number, number],
  spanS: number,
  seed: number,
  speedMs: number,
): { path: Path; start: number; approach: number } {
  const rand = mulberry32(seed);
  const target = nearestNode(g, scene[0], scene[1]);
  const k = Math.cos((scene[1] * Math.PI) / 180);
  const ring: number[] = [];
  g.file.nodes.forEach(([x, y], i) => {
    const d = Math.hypot((x - scene[0]) * k, y - scene[1]) * 111320;
    if (d >= 600 && d <= 2000) ring.push(i);
  });
  const from = ring.length ? ring[Math.floor(rand() * ring.length)] : target;
  const want = Math.max(1, spanS) * speedMs;

  const direct = from === target ? [] : dijkstra(g, from, target, true) ?? dijkstra(g, from, target, false) ?? [];
  let edges = direct;
  let cruiseEdges: number[] = [];
  const directLen = pathOf(expand(g, direct).concat([scene])).len;
  if (directLen < want) {
    // Cruise first, then head in. The cruise is sized from the shortfall; the final timing absorbs the difference.
    const c = cruise(g, from, want - directLen, scene, 1800, rand);
    const tail = c.end === target ? [] : dijkstra(g, c.end, target, true) ?? dijkstra(g, c.end, target, false) ?? [];
    edges = [...c.edges, ...tail];
    cruiseEdges = c.edges;
  }
  const raw = expand(g, edges);
  if (!raw.length) raw.push(g.file.nodes[from]);
  raw.push(scene);
  const path = pathOf(raw.filter((p, i) => i === 0 || p[0] !== raw[i - 1][0] || p[1] !== raw[i - 1][1]));
  const approach = cruiseEdges.length ? pathOf(expand(g, cruiseEdges)).len : 0;
  return { path, start: Math.max(0, path.len - want), approach: Math.min(approach, path.len) };
}

/** Position and heading (degrees from north) at distance d along a path. */
export function pointAt(p: Path, d: number): { pos: [number, number]; heading: number } {
  const x = Math.max(0, Math.min(p.len, d));
  let i = 1;
  let lo = 1;
  let hi = p.cum.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (p.cum[mid] < x) lo = mid + 1;
    else {
      i = mid;
      hi = mid - 1;
    }
  }
  const [a, b] = [p.pts[i - 1], p.pts[i]];
  const seg = p.cum[i] - p.cum[i - 1];
  const f = seg > 0 ? (x - p.cum[i - 1]) / seg : 0;
  const pos: [number, number] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  const k = Math.cos((a[1] * Math.PI) / 180);
  const heading = (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI;
  return { pos, heading: (heading + 360) % 360 };
}

/** The part of a path from distance d to the end. */
export function remainder(p: Path, d: number): [number, number][] {
  const start = pointAt(p, d).pos;
  const i = p.cum.findIndex((c) => c > d);
  return i < 0 ? [start, p.pts[p.pts.length - 1]] : [start, ...p.pts.slice(i)];
}
