// metro_routing.js — Fuzzy Timetable Matcher + Multi-Modal Routing Engine
// Loaded as an ES module alongside metro_map_3d.js

const STATIONS_URL = "assets/data/stations.geojson";
const MAPTILER_KEY = "ofctT6j7ruazu5tvqQqU";

// ─── Hardcoded Timetables ───
const ORANGE_TIMETABLE = [
  { name: "Automotive Square",   time: "06:00" },
  { name: "Nari Road",           time: "06:03" },
  { name: "Indora Square",       time: "06:07" },
  { name: "Kadvi Square",        time: "06:10" },
  { name: "Gaddi Godam Square",  time: "06:13" },
  { name: "Kasturchand Park",    time: "06:16" },
  { name: "Zero Mile",           time: "06:18" },
  { name: "Sitabuldi",           time: "06:20" },
  { name: "Congress Nagar",      time: "06:29" },
  { name: "Rahate Colony",       time: "06:30" },
  { name: "Ajni Square",         time: "06:31" },
  { name: "Chhatrapati Square",  time: "06:34" },
  { name: "Jaiprakash Nagar",    time: "06:36" },
  { name: "Ujjwal Nagar",        time: "06:38" },
  { name: "Airport",             time: "06:42" },
  { name: "Airport South",       time: "06:44" },
  { name: "New Airport",         time: "06:49" },
  { name: "Khapri",              time: "06:55" },
];

const AQUA_TIMETABLE = [
  { name: "Lokmanya Nagar",       time: "06:00" },
  { name: "Bansi Nagar",          time: "06:02" },
  { name: "Vasudev Nagar",        time: "06:04" },
  { name: "Rachna Ring Road",     time: "06:06" },
  { name: "Subhash Nagar",        time: "06:08" },
  { name: "Ambazari Lake",        time: "06:11" },
  { name: "LAD College",          time: "06:12" },
  { name: "Shankar Nagar Square", time: "06:13" },
  { name: "Institute of Engineers", time: "06:15" },
  { name: "Jhansi Rani Square",   time: "06:17" },
  { name: "Sitabuldi",            time: "06:19" },
  { name: "Cotton Market",        time: "06:21" },
  { name: "Nagpur Railway Station", time: "06:23" },
  { name: "Dosar Vaisya Square",  time: "06:25" },
  { name: "Agrasen Square",       time: "06:27" },
  { name: "Chitroli Square",      time: "06:29" },
  { name: "Telephone Exchange",   time: "06:31" },
  { name: "Ambedkar Square",      time: "06:33" },
  { name: "Vaishnodevi Square",   time: "06:35" },
  { name: "Prajapati Nagar",      time: "06:38" },
];

// ─── Fuzzy Matching ───
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function normalize(name) {
  return name.toLowerCase()
    .replace(/\bsq\b/g, "square")
    .replace(/\bchk\b/g, "square")
    .replace(/\brd\b/g, "road")
    .replace(/\bstn\b/g, "station")
    .replace(/\bjhasi\b/g, "jhansi")
    .replace(/\bdharampeth college\b/g, "lad college")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function fuzzyMatch(timetableName, stationFeatures) {
  const normTarget = normalize(timetableName);
  let bestMatch = null, bestScore = Infinity;

  for (const f of stationFeatures) {
    if (!f.properties?.name) continue;
    const normCandidate = normalize(f.properties.name);

    // Exact match
    if (normCandidate === normTarget) return f;

    // Substring match
    if (normCandidate.includes(normTarget) || normTarget.includes(normCandidate)) {
      const score = Math.abs(normCandidate.length - normTarget.length);
      if (score < bestScore) { bestScore = score; bestMatch = f; }
      continue;
    }

    // Levenshtein distance
    const dist = levenshtein(normTarget, normCandidate);
    if (dist < bestScore) { bestScore = dist; bestMatch = f; }
  }

  // Only accept if reasonably close (max 5 edits)
  return bestScore <= 5 ? bestMatch : null;
}

// ─── Get coordinates from a feature (handles Point, Polygon, LineString) ───
function getFeatureCoords(feature) {
  const geom = feature.geometry;
  if (geom.type === "Point") return geom.coordinates;
  if (geom.type === "Polygon") {
    // Centroid of polygon ring
    const ring = geom.coordinates[0];
    let lngSum = 0, latSum = 0;
    for (const c of ring) { lngSum += c[0]; latSum += c[1]; }
    return [lngSum / ring.length, latSum / ring.length];
  }
  if (geom.type === "LineString") {
    const coords = geom.coordinates;
    const mid = Math.floor(coords.length / 2);
    return coords[mid];
  }
  return null;
}

// ─── Build Schedule Objects ───
let stationsGeoJson = null;
let orangeSchedule = [];
let aquaSchedule = [];
let allStationNames = [];

async function initSchedules() {
  const resp = await fetch(STATIONS_URL);
  stationsGeoJson = await resp.json();

  // Filter to only named features
  const namedFeatures = stationsGeoJson.features.filter(f => f.properties?.name);

  // Build station name list for autocomplete
  allStationNames = [...new Set(namedFeatures.map(f => f.properties.name))].sort();

  // Fuzzy-match Orange Line
  orangeSchedule = [];
  for (const entry of ORANGE_TIMETABLE) {
    const match = fuzzyMatch(entry.name, namedFeatures);
    if (match) {
      const coords = getFeatureCoords(match);
      orangeSchedule.push({
        name: match.properties.name,
        timetableName: entry.name,
        time: entry.time,
        lng: coords[0],
        lat: coords[1],
        line: "orange",
      });
    } else {
      console.warn(`[routing] ⚠ No match for Orange "${entry.name}"`);
    }
  }

  // Fuzzy-match Aqua Line
  aquaSchedule = [];
  for (const entry of AQUA_TIMETABLE) {
    const match = fuzzyMatch(entry.name, namedFeatures);
    if (match) {
      const coords = getFeatureCoords(match);
      aquaSchedule.push({
        name: match.properties.name,
        timetableName: entry.name,
        time: entry.time,
        lng: coords[0],
        lat: coords[1],
        line: "aqua",
      });
    } else {
      console.warn(`[routing] ⚠ No match for Aqua "${entry.name}"`);
    }
  }

  console.log(`[routing] ✓ Orange: ${orangeSchedule.length}/${ORANGE_TIMETABLE.length} matched`);
  console.log(`[routing] ✓ Aqua: ${aquaSchedule.length}/${AQUA_TIMETABLE.length} matched`);

  return { orangeSchedule, aquaSchedule, allStationNames };
}

// ─── Find Nearest Station ───
function findNearestStation(lng, lat) {
  const userPt = turf.point([lng, lat]);
  const allStations = [...orangeSchedule, ...aquaSchedule];
  const stationPoints = turf.featureCollection(
    allStations.map(s => turf.point([s.lng, s.lat], { name: s.name, line: s.line }))
  );
  const nearest = turf.nearestPoint(userPt, stationPoints);
  const name = nearest.properties.name;
  return allStations.find(s => s.name === name);
}

// ─── Multi-Modal Route Calculation ───
async function calculateMultiModalRoute(map, fromLng, fromLat, toStationName, routeLineOrange, routeLineAqua) {
  // 1. Find which line & station the destination is on
  const allStations = [...orangeSchedule, ...aquaSchedule];
  const destStation = allStations.find(s => s.name === toStationName);
  if (!destStation) {
    console.error("[routing] Destination not found:", toStationName);
    return null;
  }

  // 2. Find nearest station to user's location
  const nearestStn = findNearestStation(fromLng, fromLat);
  if (!nearestStn) {
    console.error("[routing] No nearest station found");
    return null;
  }

  // Determine which route line to use
  const routeLine = destStation.line === "orange" ? routeLineOrange : routeLineAqua;
  if (!routeLine) {
    console.error("[routing] No route line for", destStation.line);
    return null;
  }

  // 3. Walking route from user to nearest station (MapTiler Directions API)
  let walkingGeoJson = null;
  try {
    const walkUrl = `https://api.maptiler.com/directions/v2/walking/${fromLng},${fromLat};${nearestStn.lng},${nearestStn.lat}?key=${MAPTILER_KEY}`;
    const walkResp = await fetch(walkUrl);
    if (walkResp.ok) {
      const walkData = await walkResp.json();
      if (walkData.routes && walkData.routes.length > 0) {
        walkingGeoJson = {
          type: "Feature",
          geometry: walkData.routes[0].geometry,
          properties: { distance: walkData.routes[0].distance, duration: walkData.routes[0].duration },
        };
      }
    }
  } catch (e) {
    console.warn("[routing] Walking API error:", e);
  }

  // Fallback: straight line if API fails
  if (!walkingGeoJson) {
    walkingGeoJson = turf.lineString([[fromLng, fromLat], [nearestStn.lng, nearestStn.lat]]);
    walkingGeoJson.properties = { distance: 0, duration: 0, fallback: true };
  }

  // 4. Metro route: slice the track between nearest station and destination
  const startPt = turf.point([nearestStn.lng, nearestStn.lat]);
  const endPt   = turf.point([destStation.lng, destStation.lat]);

  // Snap to nearest point on line
  const startOnLine = turf.nearestPointOnLine(routeLine, startPt, { units: "meters" });
  const endOnLine   = turf.nearestPointOnLine(routeLine, endPt, { units: "meters" });

  let metroSegment;
  try {
    metroSegment = turf.lineSlice(startOnLine, endOnLine, routeLine);
  } catch (e) {
    console.warn("[routing] lineSlice error, using full route:", e);
    metroSegment = routeLine;
  }

  // 5. Compute time info from timetable
  const schedule = destStation.line === "orange" ? orangeSchedule : aquaSchedule;
  const fromIdx = schedule.findIndex(s => s.name === nearestStn.name);
  const toIdx   = schedule.findIndex(s => s.name === destStation.name);
  let metroTimeMin = 0;
  if (fromIdx >= 0 && toIdx >= 0) {
    const parseTime = (t) => { const [h,m] = t.split(":").map(Number); return h * 60 + m; };
    metroTimeMin = Math.abs(parseTime(schedule[toIdx].time) - parseTime(schedule[fromIdx].time));
  }

  const walkDist = walkingGeoJson.properties.distance || turf.distance(
    turf.point([fromLng, fromLat]),
    turf.point([nearestStn.lng, nearestStn.lat]),
    { units: "meters" }
  );
  const walkTimeMin = Math.ceil(walkDist / 80); // ~80m/min walking speed

  return {
    walking: walkingGeoJson,
    metro: metroSegment,
    nearestStation: nearestStn,
    destStation,
    walkDistM: Math.round(walkDist),
    walkTimeMin,
    metroTimeMin,
    totalTimeMin: walkTimeMin + metroTimeMin,
    metroLine: destStation.line,
  };
}

// ─── Draw Route on Map ───
function drawRoute(map, routeResult) {
  // Remove old route layers
  for (const id of ["walk-route", "metro-route-segment", "route-markers"]) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }

  // Walking route: dashed blue line
  map.addSource("walk-route", { type: "geojson", data: routeResult.walking });
  map.addLayer({
    id: "walk-route", type: "line", source: "walk-route",
    paint: {
      "line-color": "#2196F3",
      "line-width": 4,
      "line-dasharray": [2, 2],
      "line-opacity": 0.8,
    },
  });

  // Metro route: thick solid line
  const metroColor = routeResult.metroLine === "orange" ? "#ff6d00" : "#00bcd4";
  map.addSource("metro-route-segment", { type: "geojson", data: routeResult.metro });
  map.addLayer({
    id: "metro-route-segment", type: "line", source: "metro-route-segment",
    paint: {
      "line-color": metroColor,
      "line-width": 6,
      "line-opacity": 0.9,
    },
  });

  // Markers: start, nearest station, destination
  const markers = turf.featureCollection([
    turf.point(routeResult.walking.geometry.coordinates[0], { label: "You", type: "start" }),
    turf.point([routeResult.nearestStation.lng, routeResult.nearestStation.lat],
      { label: routeResult.nearestStation.name, type: "station" }),
    turf.point([routeResult.destStation.lng, routeResult.destStation.lat],
      { label: routeResult.destStation.name, type: "destination" }),
  ]);
  map.addSource("route-markers", { type: "geojson", data: markers });
  map.addLayer({
    id: "route-markers", type: "circle", source: "route-markers",
    paint: {
      "circle-radius": 8,
      "circle-color": ["match", ["get", "type"],
        "start", "#4CAF50",
        "station", "#2196F3",
        "destination", "#F44336",
        "#999"],
      "circle-stroke-color": "#fff",
      "circle-stroke-width": 2,
    },
  });

  // Camera fit
  const allCoords = [
    ...routeResult.walking.geometry.coordinates,
    ...routeResult.metro.geometry.coordinates,
  ];
  const bounds = allCoords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds());
  map.fitBounds(bounds, { padding: 80, duration: 1000 });
}

function clearRoute(map) {
  for (const id of ["walk-route", "metro-route-segment", "route-markers"]) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
}

// ─── Exports ───
export {
  initSchedules,
  findNearestStation,
  calculateMultiModalRoute,
  drawRoute,
  clearRoute,
  orangeSchedule,
  aquaSchedule,
  allStationNames,
  stationsGeoJson,
};
