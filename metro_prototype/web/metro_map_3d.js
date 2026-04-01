// metro_map_3d.js — Real-time Nagpur Metro simulation
// Exact delta-based timing, variable headway, frustum-culled 3D rendering
import * as THREE from 'three';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import {
  initSchedules, calculateMultiModalRoute, drawRoute, clearRoute,
  allStationNames, findNearestStation,
} from './metro_routing.js';

const MAPTILER_KEY = "ofctT6j7ruazu5tvqQqU";
const MTL_URL      = "train-electric-subway-a.mtl";
const OBJ_URL      = "train-electric-subway-a.obj";
const ROUTE_URL    = "assets/data/route.geojson";
const STATIONS_URL = "assets/data/stations.geojson";
const CENTER       = [79.0882, 21.1458];
const ZOOM         = 14;
const PITCH        = 60;
const BEARING_INIT = -20;

// ─── Timing Constants ───
const RAKES_PER_LINE   = 1;
const DWELL_SEC        = 30;      // 30s standard dwell
const TERMINAL_REV_SEC = 300;     // 5 min turnaround at terminals

// ─── Headway Schedule ───
// Phase definitions: [startHour, startMin, headwayMinutes]
const HEADWAY_SCHEDULE = [
  { from: 6*60,      to: 7*60,      headway: 20 }, // 06:00-07:00: 20 min
  { from: 7*60,      to: 8*60,      headway: 15 }, // 07:00-08:00: 15 min
  { from: 8*60,      to: 20*60,     headway: 10 }, // 08:00-20:00: 10 min (peak)
  { from: 20*60,     to: 21*60,     headway: 15 }, // 20:00-21:00: 15 min
  { from: 21*60,     to: 22*60+20,  headway: 20 }, // 21:00-22:20: 20 min
];

// ─── Orange Line: cumulative deltas from Automotive Sq (in seconds) ───
// These are the KEY timing nodes — trains travel between them at the implied speed
const ORANGE_NODES = [
  { name: "Automotive Square",   deltaSec: 0 },
  { name: "Nari Road",           deltaSec: 3*60+42 },    // +3:42
  { name: "Indora Square",       deltaSec: 7*60+10 },    // +7:10
  { name: "Kadvi Square",        deltaSec: 10*60+15 },   // +10:15
  { name: "Gaddi Godam Square",  deltaSec: 13*60+18 },   // interpolated
  { name: "Kasturchand Park",    deltaSec: 16*60+23 },   // +16:23
  { name: "Zero Mile",           deltaSec: 18*60+35 },   // interpolated
  { name: "Sitabuldi",           deltaSec: 20*60+50 },   // +20:50
  { name: "Congress Nagar",      deltaSec: 24*60+30 },   // interpolated
  { name: "Rahate Colony",       deltaSec: 26*60+45 },   // interpolated
  { name: "Ajni Square",         deltaSec: 31*60+13 },   // +31:13
  { name: "Chhatrapati Square",  deltaSec: 34*60+10 },   // interpolated
  { name: "Jaiprakash Nagar",    deltaSec: 36*60+30 },   // interpolated
  { name: "Ujjwal Nagar",        deltaSec: 38*60+50 },   // interpolated
  { name: "Airport",             deltaSec: 42*60+10 },   // +42:10
  { name: "Airport South",       deltaSec: 45*60+20 },   // interpolated
  { name: "New Airport",         deltaSec: 49*60+25 },   // interpolated
  { name: "Khapri",              deltaSec: 55*60+30 },   // +55:30
];

// ─── Aqua Line: cumulative deltas from Lokmanya Nagar (in seconds) ───
const AQUA_NODES = [
  { name: "Lokmanya Nagar",       deltaSec: 0 },
  { name: "Bansi Nagar",          deltaSec: 3*60+8 },    // interpolated
  { name: "Vasudev Nagar",        deltaSec: 6*60+16 },   // +6:16
  { name: "Rachna Ring Road",     deltaSec: 9*60+50 },   // interpolated
  { name: "Subhash Nagar",        deltaSec: 13*60+28 },  // +13:28
  { name: "Ambazari Lake",        deltaSec: 16*60+25 },  // interpolated
  { name: "LAD College",          deltaSec: 19*60+25 },  // +19:25
  { name: "Shankar Nagar Square", deltaSec: 22*60+0 },   // interpolated
  { name: "Institute of Engineers", deltaSec: 24*60+30 }, // interpolated
  { name: "Jhansi Rani Square",   deltaSec: 26*60+35 },  // interpolated
  { name: "Sitabuldi",            deltaSec: 28*60+44 },  // +28:44
  { name: "Cotton Market",        deltaSec: 30*60+58 },  // interpolated
  { name: "Nagpur Railway Station", deltaSec: 33*60+13 }, // +33:13
  { name: "Dosar Vaisya Square",  deltaSec: 36*60+0 },   // interpolated
  { name: "Agrasen Square",       deltaSec: 38*60+45 },  // interpolated
  { name: "Chitroli Square",      deltaSec: 40*60+30 },  // interpolated
  { name: "Telephone Exchange",   deltaSec: 42*60+33 },  // +42:33
  { name: "Ambedkar Square",      deltaSec: 45*60+10 },  // interpolated
  { name: "Vaishnodevi Square",   deltaSec: 48*60+30 },  // interpolated
  { name: "Prajapati Nagar",      deltaSec: 51*60+56 },  // +51:56
];

let map;
let followingTrainKey = null;
const lineData = {};   // { orange: { routeLine, routeLength, stationFracs }, ... }
const stationCoords = {};

/* ─── Math helpers ─── */
function makeModelMatrix(lng, lat, alt, rotZ, scale) {
  const mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], alt);
  const s = mc.meterInMercatorCoordinateUnits() * scale;
  const c = Math.cos(rotZ), si = Math.sin(rotZ);
  return [s*c,s*si,0,0, -s*si,s*c,0,0, 0,0,s,0, mc.x,mc.y,mc.z,1];
}

function geoBearing(a, b) {
  const dL = (b[0]-a[0])*Math.PI/180, la=a[1]*Math.PI/180, lb=b[1]*Math.PI/180;
  return Math.atan2(Math.sin(dL)*Math.cos(lb), Math.cos(la)*Math.sin(lb)-Math.sin(la)*Math.cos(lb)*Math.cos(dL));
}

function mat4Mul(a, b) {
  const o = new Float64Array(16);
  for (let i=0;i<4;i++) for (let j=0;j<4;j++) {
    let s=0; for (let k=0;k<4;k++) s+=a[k*4+j]*b[i*4+k]; o[i*4+j]=s;
  }
  return o;
}

/* ───────────────────────────────────────────────────
   REAL-TIME SIMULATION ENGINE (Delta-Based)
   
   One-way trip = sum of inter-station travel + dwells
   Full cycle = DOWN + turnaround + UP + turnaround
   8 rakes staggered by current headway
   ─────────────────────────────────────────────────── */

function computeOneWayTripSec(nodes) {
  const lastDelta = nodes[nodes.length - 1].deltaSec;
  // Total = travel time (last delta) + dwell at each station
  return lastDelta + nodes.length * DWELL_SEC;
}

function computeFullCycleSec(nodes) {
  const oneWay = computeOneWayTripSec(nodes);
  return oneWay + TERMINAL_REV_SEC + oneWay + TERMINAL_REV_SEC;
}

// Get current headway in seconds based on time of day
function getCurrentHeadwaySec() {
  const now = new Date();
  const minOfDay = now.getHours() * 60 + now.getMinutes();
  for (const phase of HEADWAY_SCHEDULE) {
    if (minOfDay >= phase.from && minOfDay < phase.to) return phase.headway * 60;
  }
  return 600; // default 10 min
}

// Compute seconds since service start (06:00) for today
function getServiceElapsedSec() {
  const now = new Date();
  return (now.getHours() - 6) * 3600 + now.getMinutes() * 60 + now.getSeconds();
}

// Get departure times for all rakes considering variable headway
function getRakeDepartureTimes() {
  // Simplified: use current headway for staggering
  // In real operation, rakes depart at fixed intervals from 06:00
  const headway = getCurrentHeadwaySec();
  const departures = [];
  for (let r = 0; r < RAKES_PER_LINE; r++) {
    departures.push(r * headway);
  }
  return departures;
}

// Given seconds into a cycle, return position along the line
// Returns { fraction: 0..1, direction: 'down'|'up', state: 'moving'|'dwell'|'turnaround' }
function getRakePositionInCycle(cycleTimeSec, nodes) {
  const N = nodes.length;
  const oneWay = computeOneWayTripSec(nodes);
  const fullCycle = computeFullCycleSec(nodes);
  let t = ((cycleTimeSec % fullCycle) + fullCycle) % fullCycle;

  // ── DOWN TRIP (station 0 → station N-1) ──
  if (t < oneWay) {
    return resolvePositionInTrip(t, nodes, false);
  }
  t -= oneWay;

  // ── TURNAROUND at end terminal ──
  if (t < TERMINAL_REV_SEC) {
    return { fraction: 1.0, direction: 'down', state: 'turnaround' };
  }
  t -= TERMINAL_REV_SEC;

  // ── UP TRIP (station N-1 → station 0) ──
  if (t < oneWay) {
    const pos = resolvePositionInTrip(t, nodes, true);
    return { ...pos, direction: 'up' };
  }

  // ── TURNAROUND at start terminal ──
  return { fraction: 0.0, direction: 'up', state: 'turnaround' };
}

// Resolve exact position within a one-way trip
function resolvePositionInTrip(tripTimeSec, nodes, reversed) {
  const N = nodes.length;
  const order = reversed ? [...nodes].reverse() : nodes;

  // Recompute deltas for reversed direction
  let cumTime = 0;
  for (let i = 0; i < N; i++) {
    // Dwell at this station
    if (tripTimeSec < cumTime + DWELL_SEC) {
      const stationIdx = reversed ? (N - 1 - i) : i;
      return {
        fraction: stationIdx / (N - 1),
        direction: reversed ? 'up' : 'down',
        state: 'dwell',
        stationName: order[i].name,
      };
    }
    cumTime += DWELL_SEC;

    // Travel to next station
    if (i < N - 1) {
      const fromDelta = reversed ? nodes[N-1-i].deltaSec : nodes[i].deltaSec;
      const toDelta   = reversed ? nodes[N-2-i].deltaSec : nodes[i+1].deltaSec;
      const travelTime = Math.abs(toDelta - fromDelta);

      if (tripTimeSec < cumTime + travelTime) {
        const progress = (tripTimeSec - cumTime) / travelTime;
        const fromIdx = reversed ? (N - 1 - i) : i;
        const toIdx   = reversed ? (N - 2 - i) : (i + 1);
        const frac = (fromIdx + progress * (toIdx - fromIdx)) / (N - 1);
        return {
          fraction: frac,
          direction: reversed ? 'up' : 'down',
          state: 'moving',
        };
      }
      cumTime += travelTime;
    }
  }

  return { fraction: reversed ? 0 : 1, direction: reversed ? 'up' : 'down', state: 'dwell' };
}

// Convert a station-based fraction to map lng/lat using snapped route fractions
function fractionToMapPos(lineName, fraction) {
  const ld = lineData[lineName];
  if (!ld || !ld.stationFracs || ld.stationFracs.length < 2) return null;

  const sf = ld.stationFracs;
  const N = sf.length - 1;
  const idx = fraction * N;
  const lo = Math.max(0, Math.min(Math.floor(idx), N - 1));
  const hi = Math.min(lo + 1, N);
  const t = idx - lo;

  const routeFrac = sf[lo] + t * (sf[hi] - sf[lo]);
  const dist = Math.max(0, Math.min(routeFrac * ld.routeLength, ld.routeLength));

  const pt = turf.along(ld.routeLine, dist, { units: "meters" });
  const coord = pt.geometry.coordinates;
  const aheadDist = Math.min(dist + 50, ld.routeLength);
  const ptAhead = turf.along(ld.routeLine, aheadDist, { units: "meters" });

  return { lng: coord[0], lat: coord[1], bearing: geoBearing(coord, ptAhead.geometry.coordinates) };
}

// Compute ALL visible rake positions for one line
function computeLineRakes(lineName, nodes) {
  const elapsed = getServiceElapsedSec();
  if (elapsed < 0) return []; // Before 06:00, no service

  const fullCycle = computeFullCycleSec(nodes);
  const departures = getRakeDepartureTimes();
  const results = [];

  for (let r = 0; r < RAKES_PER_LINE; r++) {
    const rakeTime = elapsed - departures[r];
    if (rakeTime < 0) { results.push(null); continue; } // Not yet departed

    const pos = getRakePositionInCycle(rakeTime, nodes);
    const mapPos = fractionToMapPos(lineName, pos.fraction);
    if (mapPos) {
      results.push({ ...mapPos, state: pos.state, direction: pos.direction, rakeIdx: r });
    } else {
      results.push(null);
    }
  }
  return results;
}

/* ─── Frustum Culling: only render if in viewport ─── */
function isInViewport(lng, lat, map) {
  const bounds = map.getBounds();
  // Add a small padding so trains near edges don't pop in/out
  const pad = 0.01;
  return lng >= bounds.getWest() - pad && lng <= bounds.getEast() + pad &&
         lat >= bounds.getSouth() - pad && lat <= bounds.getNorth() + pad;
}

/* ─── Three.js custom layer ─── */
const trainLayer = {
  id: "3d-train", type: "custom", renderingMode: "3d",
  _model: null, _camera: null, _scene: null, _renderer: null, _map: null,

  onAdd(map, gl) {
    this._map = map;
    this._camera = new THREE.Camera();
    this._scene  = new THREE.Scene();

    this._scene.add(new THREE.AmbientLight(0xffffff, 2.0));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(1, 2, 3); this._scene.add(sun);
    const fill = new THREE.DirectionalLight(0xc0c0ff, 1.0);
    fill.position.set(-2, 0.5, -1); this._scene.add(fill);

    const mtlLoader = new MTLLoader();
    mtlLoader.load(MTL_URL, (materials) => {
      materials.preload();
      const objLoader = new OBJLoader();
      objLoader.setMaterials(materials);
      objLoader.load(OBJ_URL, (object) => {
        object.rotation.x = Math.PI / 2;
        object.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.side = THREE.BackSide;
            child.material.transparent = false;
          }
        });
        this._model = object;
        this._scene.add(this._model);
        console.log("[metro3d] ✓ OBJ model loaded");
      }, undefined, (err) => console.error("[metro3d] ✗ OBJ error:", err));
    });

    this._renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this._renderer.autoClear = false;
  },

  render(gl, matrix) {
    if (!this._model) return;

    const z = this._map.getZoom();
    let scale = 60;
    if (z >= 18) scale = 3;
    else if (z > 12) scale = 60 - ((z - 12) / 6) * 57;

    // Compute all rake positions (real-time)
    const orangeRakes = lineData.orange ? computeLineRakes("orange", ORANGE_NODES) : [];
    const aquaRakes   = lineData.aqua   ? computeLineRakes("aqua", AQUA_NODES)     : [];
    const allRakes = [...orangeRakes, ...aquaRakes];

    let rendered = 0;
    for (const pos of allRakes) {
      if (!pos) continue;

      // ── Frustum culling: skip if off-screen ──
      if (!isInViewport(pos.lng, pos.lat, this._map)) continue;

      const mm  = makeModelMatrix(pos.lng, pos.lat, 0, pos.bearing, scale);
      const mvp = mat4Mul(matrix, mm);
      this._camera.projectionMatrix = new THREE.Matrix4().fromArray(mvp);
      this._renderer.resetState();
      this._renderer.render(this._scene, this._camera);
      rendered++;
    }

    this._map.triggerRepaint();
  },
};

/* ─── Animation loop ─── */
window.__metro3d_raf_id = null;
function animate() {
  window.__metro3d_raf_id = requestAnimationFrame(animate);
}

/* ─── Build route from GeoJSON ─── */
function buildRouteLine(features) {
  const ordered = [features[0]];
  const remaining = features.slice(1);
  while (remaining.length > 0) {
    const lastCoord = ordered[ordered.length - 1].geometry.coordinates;
    const lastPt = lastCoord[lastCoord.length - 1];
    let bestIdx = 0, bestDist = Infinity, flip = false;
    for (let i = 0; i < remaining.length; i++) {
      const coords = remaining[i].geometry.coordinates;
      const dS = Math.hypot(coords[0][0]-lastPt[0], coords[0][1]-lastPt[1]);
      const dE = Math.hypot(coords[coords.length-1][0]-lastPt[0], coords[coords.length-1][1]-lastPt[1]);
      if (dS < bestDist) { bestDist=dS; bestIdx=i; flip=false; }
      if (dE < bestDist) { bestDist=dE; bestIdx=i; flip=true; }
    }
    const seg = remaining.splice(bestIdx, 1)[0];
    if (flip) seg.geometry.coordinates.reverse();
    ordered.push(seg);
  }
  const allCoords = [];
  for (const f of ordered) allCoords.push(...f.geometry.coordinates);
  return { coords: allCoords, orderedFeatures: ordered };
}

/* ─── Snap station names to route, return sorted fractions ─── */
function snapStationsToRoute(routeLine, routeLength, nodes) {
  const fracs = [];
  for (const node of nodes) {
    const c = stationCoords[node.name];
    if (!c) {
      console.warn("[metro3d] Station not in GeoJSON:", node.name);
      // Use linear interpolation based on delta position
      const totalDelta = nodes[nodes.length-1].deltaSec;
      fracs.push(node.deltaSec / totalDelta);
      continue;
    }
    const pt = turf.point([c.lng, c.lat]);
    const snapped = turf.nearestPointOnLine(routeLine, pt, { units: "meters" });
    fracs.push(Math.max(0, Math.min(1, snapped.properties.location / routeLength)));
  }
  return fracs;
}

/* ─── Bootstrap ─── */
async function init() {
  if (window.__metro3d_raf_id) cancelAnimationFrame(window.__metro3d_raf_id);
  const old = document.getElementById("metro3d-map");
  if (old) old.remove();

  const container = document.createElement("div");
  container.id = "metro3d-map";
  container.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;";
  document.body.prepend(container);

  const disableFlutter = () => {
    document.querySelectorAll('flt-glass-pane, flutter-view').forEach(el => { el.style.pointerEvents='none'; });
    document.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) el.shadowRoot.querySelectorAll('*').forEach(c => {
        if (c.tagName?.toLowerCase().includes('flt')) c.style.pointerEvents='none';
      });
    });
  };
  disableFlutter(); setTimeout(disableFlutter, 1000); setTimeout(disableFlutter, 3000);

  // Init fuzzy-matched schedules
  await initSchedules();
  const { orangeSchedule, aquaSchedule } = await import('./metro_routing.js');
  for (const s of [...orangeSchedule, ...aquaSchedule]) {
    stationCoords[s.name] = { lng: s.lng, lat: s.lat };
  }
  console.log("[metro3d] Station coords loaded:", Object.keys(stationCoords).length);

  map = new maplibregl.Map({
    container, antialias: true,
    style: "https://api.maptiler.com/maps/streets-v2/style.json?key=" + MAPTILER_KEY,
    center: CENTER, zoom: ZOOM, pitch: PITCH, bearing: BEARING_INIT,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }));

  map.on("load", async () => {
    // ── Stations ──
    const stResp = await fetch(STATIONS_URL);
    const stData = await stResp.json();
    const stPoints = { type: "FeatureCollection",
      features: stData.features.filter(f => f.geometry.type === "Point" && f.properties?.name) };

    map.addSource("all-stations", { type: "geojson", data: stPoints });
    map.addLayer({ id: "station-dots", type: "circle", source: "all-stations",
      paint: { "circle-radius": 6, "circle-color": "#fff", "circle-stroke-color": "#333", "circle-stroke-width": 2 } });
    map.addLayer({ id: "station-names", type: "symbol", source: "all-stations",
      layout: { "text-field": ["get","name"], "text-size": 11, "text-offset": [0,1.5],
        "text-anchor": "top", "text-allow-overlap": false },
      paint: { "text-color": "#222", "text-halo-color": "#fff", "text-halo-width": 1.5 } });

    // Station click → Flutter
    map.on("click", "station-dots", (e) => {
      if (e.features?.length > 0) {
        const f = e.features[0];
        window.dispatchEvent(new CustomEvent("metro3d_station_click", {
          detail: { name: f.properties.name, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] } }));
      }
    });
    map.on("mouseenter", "station-dots", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "station-dots", () => { map.getCanvas().style.cursor = ""; });
    map.on('dragstart', () => { followingTrainKey = null; });

    // ── Routes ──
    const resp = await fetch(ROUTE_URL);
    const geojson = await resp.json();

    // Orange Line
    const orangeF = geojson.features.filter(f =>
      f.geometry.type === "LineString" && f.properties?.name?.includes("North South"));
    if (orangeF.length > 0) {
      const built = buildRouteLine(orangeF);
      const routeLine = turf.lineString(built.coords);
      const routeLength = turf.length(routeLine, { units: "meters" });
      const stationFracs = snapStationsToRoute(routeLine, routeLength, ORANGE_NODES);
      lineData.orange = { routeLine, routeLength, stationFracs, orderedFeatures: built.orderedFeatures };

      const oneWay = computeOneWayTripSec(ORANGE_NODES);
      const fullCycle = computeFullCycleSec(ORANGE_NODES);
      console.log(`[metro3d] Orange: ${routeLength.toFixed(0)}m, ${ORANGE_NODES.length} stn, one-way ${(oneWay/60).toFixed(1)}min, cycle ${(fullCycle/60).toFixed(1)}min`);

      map.addSource("route-orange", { type: "geojson", data: { type: "FeatureCollection", features: built.orderedFeatures } });
      map.addLayer({ id: "orange-casing", type: "line", source: "route-orange",
        paint: { "line-color": "#e65100", "line-width": 7, "line-opacity": 0.5 } });
      map.addLayer({ id: "orange-line", type: "line", source: "route-orange",
        paint: { "line-color": "#ff6d00", "line-width": 4, "line-opacity": 0.9 } });
    }

    // Aqua Line
    const aquaF = geojson.features.filter(f =>
      f.geometry.type === "LineString" && f.properties?.name?.includes("East West"));
    if (aquaF.length > 0) {
      const built = buildRouteLine(aquaF);
      const routeLine = turf.lineString(built.coords);
      const routeLength = turf.length(routeLine, { units: "meters" });
      const stationFracs = snapStationsToRoute(routeLine, routeLength, AQUA_NODES);
      lineData.aqua = { routeLine, routeLength, stationFracs, orderedFeatures: built.orderedFeatures };

      const oneWay = computeOneWayTripSec(AQUA_NODES);
      const fullCycle = computeFullCycleSec(AQUA_NODES);
      console.log(`[metro3d] Aqua: ${routeLength.toFixed(0)}m, ${AQUA_NODES.length} stn, one-way ${(oneWay/60).toFixed(1)}min, cycle ${(fullCycle/60).toFixed(1)}min`);

      map.addSource("route-aqua", { type: "geojson", data: { type: "FeatureCollection", features: built.orderedFeatures } });
      map.addLayer({ id: "aqua-casing", type: "line", source: "route-aqua",
        paint: { "line-color": "#006064", "line-width": 7, "line-opacity": 0.5 } });
      map.addLayer({ id: "aqua-line", type: "line", source: "route-aqua",
        paint: { "line-color": "#00bcd4", "line-width": 4, "line-opacity": 0.9 } });
    }

    // Background routes
    map.addSource("route-all", { type: "geojson", data: geojson });
    map.addLayer({ id: "route-all-line", type: "line", source: "route-all",
      paint: { "line-color": "#999", "line-width": 2, "line-opacity": 0.2 } });

    // 3D trains
    map.addLayer(trainLayer);
    window.__metro3d_raf_id = requestAnimationFrame(animate);

    const now = new Date();
    const headway = getCurrentHeadwaySec();
    console.log(`[metro3d] ✓ Real-time simulation @ ${now.toLocaleTimeString()}`);
    console.log(`[metro3d]   ${RAKES_PER_LINE} rakes/line, headway: ${headway/60}min`);
    console.log(`[metro3d]   Dwell: ${DWELL_SEC}s, Turnaround: ${TERMINAL_REV_SEC}s`);
    console.log(`[metro3d]   Frustum culling: ON`);
  });

  // JS bridge for Flutter
  window.__metro3d_getStationNames = () => JSON.stringify(allStationNames);
  window.__metro3d_calculateRoute = async (fromLng, fromLat, toName) => {
    const result = await calculateMultiModalRoute(map, fromLng, fromLat, toName, lineData.orange?.routeLine, lineData.aqua?.routeLine);
    if (result) {
      drawRoute(map, result);
      return JSON.stringify({ walkDistM: result.walkDistM, walkTimeMin: result.walkTimeMin,
        metroTimeMin: result.metroTimeMin, totalTimeMin: result.totalTimeMin,
        nearestStation: result.nearestStation.name, destStation: result.destStation.name, metroLine: result.metroLine });
    }
    return null;
  };
  window.__metro3d_clearRoute = () => { clearRoute(map); };
}

window.__metro3d_init = init;
