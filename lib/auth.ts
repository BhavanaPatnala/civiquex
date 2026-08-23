import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

const SESSION_COOKIE = "civiquex_session";
const SECRET = process.env.AUTH_SECRET ?? "civiquex-local-dev-secret-change-me";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "CITIZEN" | "AUTHORITY" | "ADMIN";
  authorityId: string | null;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSession(user: SessionUser): string {
  return jwt.sign(user, SECRET, { expiresIn: SESSION_TTL_SECONDS });
}

export function verifySessionToken(token: string): SessionUser | null {
  try {
    return jwt.verify(token, SECRET) as SessionUser;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new AuthError("Authentication required");

  // A session cookie can be cryptographically valid but reference a user
  // that no longer exists in the database (e.g. after a demo reset). Every
  // mutating endpoint that goes through requireSession() writes rows with a
  // foreign key to User — trusting a stale id there fails with an opaque
  // Prisma FK error instead of a clear "sign in again." Check once, here,
  // so every caller gets the same clean behavior for free.
  const stillExists = await prisma.user.findUnique({ where: { id: session.id }, select: { id: true } });
  if (!stillExists) {
    cookies().delete(SESSION_COOKIE);
    throw new AuthError("Your session is no longer valid — please sign in again.", 401);
  }

  return session;
}

export async function requireRole(...roles: SessionUser["role"][]): Promise<SessionUser> {
  const session = await requireSession();
  if (!roles.includes(session.role)) throw new AuthError("Insufficient permissions", 403);
  return session;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role as SessionUser["role"], authorityId: user.authorityId };
}
