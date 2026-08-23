// Lightweight geospatial helpers. In the full split-stack architecture this
// module's job is done by PostGIS (ST_Distance, ST_Contains, ST_Azimuth); here
// it's plain TypeScript so the demo runs with zero external services. Swapping
// to Postgres/PostGIS later means replacing these functions' bodies with SQL
// calls behind the same signatures — call sites do not change.

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6371000;

/** Great-circle distance in meters. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

/** Initial bearing in degrees from a to b, 0-360. */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest difference between two compass bearings, 0-180. */
export function bearingDelta(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/** Ray-casting point-in-polygon. `polygon` is [ [lng,lat], ... ] (GeoJSON order). */
export function pointInPolygon(point: LatLng, polygon: [number, number][]): boolean {
  const x = point.lng;
  const y = point.lat;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Point-to-polyline min distance in meters (approx, for road-segment matching). */
export function distanceToPolyline(point: LatLng, line: [number, number][]): number {
  let min = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a: LatLng = { lng: line[i][0], lat: line[i][1] };
    const b: LatLng = { lng: line[i + 1][0], lat: line[i + 1][1] };
    const d = distanceToSegmentMeters(point, a, b);
    if (d < min) min = d;
  }
  return min === Infinity ? distanceMeters(point, { lng: line[0][0], lat: line[0][1] }) : min;
}

function distanceToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  // Project in a local equirectangular approximation (fine at city scale).
  const toXY = (pt: LatLng) => ({
    x: pt.lng * Math.cos((a.lat * Math.PI) / 180),
    y: pt.lat,
  });
  const P = toXY(p);
  const A = toXY(a);
  const B = toXY(b);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((P.x - A.x) * dx + (P.y - A.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const closest: LatLng = { lat: A.y + t * dy, lng: (A.x + t * dx) / Math.cos((a.lat * Math.PI) / 180) };
  return distanceMeters(p, closest);
}
