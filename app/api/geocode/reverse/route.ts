import { z } from "zod";
import { ok, fail, withApiHandler } from "@/lib/api/respond";
import { reverseGeocode } from "@/lib/services/geocode";

const schema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export const GET = withApiHandler(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const q = schema.parse(Object.fromEntries(searchParams));

  const result = await reverseGeocode(q.lat, q.lng);
  if (!result) return fail("Reverse geocoding unavailable for this location right now", 503);

  return ok(result);
});
