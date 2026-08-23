import { z } from "zod";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { hashPassword, signSession, SESSION_COOKIE_NAME, type SessionUser } from "@/lib/auth";
import { ok, fail, withApiHandler } from "@/lib/api/respond";

const schema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// Public self-signup only ever creates a CITIZEN account — AUTHORITY/ADMIN
// accounts are provisioned out-of-band (seeded, or created by an admin),
// never through an open signup form, since those roles carry real access to
// other citizens' evidence.
export const POST = withApiHandler(async (req: Request) => {
  const body = schema.parse(await req.json());

  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing) return fail("An account with this email already exists", 409);

  const passwordHash = await hashPassword(body.password);
  const created = await prisma.user.create({
    data: { name: body.name, email: body.email, passwordHash, role: "CITIZEN" },
  });

  const user: SessionUser = { id: created.id, email: created.email, name: created.name, role: "CITIZEN", authorityId: null };
  const token = signSession(user);
  cookies().set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return ok(user, 201);
});
