import { getSession } from "@/lib/auth";
import { ok, withApiHandler } from "@/lib/api/respond";

export const GET = withApiHandler(async () => {
  const session = await getSession();
  return ok(session);
});
