import { z } from "zod";
import { cookies } from "next/headers";
import { authenticate, signSession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { ok, fail, withApiHandler } from "@/lib/api/respond";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const POST = withApiHandler(async (req: Request) => {
  const body = schema.parse(await req.json());
  const user = await authenticate(body.email, body.password);
  if (!user) return fail("Invalid email or password", 401);

  const token = signSession(user);
  cookies().set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return ok(user);
});
