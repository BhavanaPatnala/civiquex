// ---------------------------------------------------------------------------
// Reverse geocoding via OpenStreetMap's Nominatim — a free, public service
// explicitly intended for this kind of lookup (not scraping). Proxied
// server-side so we can set a proper identifying User-Agent (Nominatim's
// usage policy requires one), enforce the policy's ~1 req/sec ceiling with
// an in-process queue, and cache by rounded coordinate so repeated lookups
// near the same spot don't re-hit the service.
//
// https://operations.osmfoundation.org/policies/nominatim/
// ---------------------------------------------------------------------------

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = "CiviqueX-Demo/0.1 (road-safety-evidence-platform; local demo build)";
const MIN_INTERVAL_MS = 1100; // stay under Nominatim's ~1 req/sec policy ceiling

const cache = new Map<string, { at: number; value: ReverseGeocodeResult }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_PRECISION = 4; // ~11m grid — enough to dedupe repeated lookups while patrolling one spot

let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

export interface ReverseGeocodeResult {
  displayName: string;
  road: string | null;
  suburb: string | null;
  city: string | null;
  source: "nominatim";
}

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(CACHE_PRECISION)},${lng.toFixed(CACHE_PRECISION)}`;
}

async function throttledFetch(url: string): Promise<Response> {
  const run = async () => {
    const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" } });
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

/** Reverse-geocodes a real GPS point to a real road/place name. Returns null on any failure — callers must degrade gracefully, never fabricate a name. */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
  const key = cacheKey(lat, lng);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  try {
    const url = `${NOMINATIM_URL}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1`;
    const res = await throttledFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address ?? {};
    const road: string | null = addr.road ?? addr.pedestrian ?? addr.footway ?? null;
    const result: ReverseGeocodeResult = {
      displayName: data.display_name ?? "Unknown location",
      road,
      suburb: addr.suburb ?? addr.neighbourhood ?? null,
      city: addr.city ?? addr.town ?? addr.state_district ?? null,
      source: "nominatim",
    };
    cache.set(key, { at: Date.now(), value: result });
    return result;
  } catch {
    return null;
  }
}
