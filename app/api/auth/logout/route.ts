import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { ok, withApiHandler } from "@/lib/api/respond";

export const POST = withApiHandler(async () => {
  cookies().delete(SESSION_COOKIE_NAME);
  return ok({ loggedOut: true });
});
