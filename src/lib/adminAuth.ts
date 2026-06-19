import "server-only";

import { cookies } from "next/headers";
import { createSignedAdminSession, timingSafeEqual, verifySignedAdminSession } from "./adminSession";

const ADMIN_COOKIE = "learnbyai_admin";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export function getAdminCredentialsConfigured() {
  return Boolean(process.env.LEARNBYAI_ADMIN_USERNAME && process.env.LEARNBYAI_ADMIN_PASSWORD && getAdminSessionSecret());
}

export function verifyAdminCredentials(username: string, password: string) {
  const expectedUsername = process.env.LEARNBYAI_ADMIN_USERNAME;
  const expectedPassword = process.env.LEARNBYAI_ADMIN_PASSWORD;
  if (!expectedUsername || !expectedPassword) return false;
  return timingSafeEqual(username, expectedUsername) && timingSafeEqual(password, expectedPassword);
}

export async function createAdminSession(username: string) {
  return createSignedAdminSession(username, getAdminSessionSecret(), SESSION_TTL_SECONDS);
}

export async function setAdminSessionCookie(username: string) {
  const token = await createAdminSession(username);
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureAdminCookie(),
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
}

export async function clearAdminSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureAdminCookie(),
    maxAge: 0,
    path: "/",
  });
}

export async function getAdminSessionFromCookies() {
  const cookieStore = await cookies();
  return verifyAdminSession(cookieStore.get(ADMIN_COOKIE)?.value);
}

export async function verifyAdminSession(token: string | undefined) {
  return verifySignedAdminSession(token, getAdminSessionSecret());
}

function getAdminSessionSecret() {
  return process.env.LEARNBYAI_ADMIN_SESSION_SECRET || process.env.INTERNAL_WORKER_SECRET || "";
}

function shouldUseSecureAdminCookie() {
  const explicit = process.env.LEARNBYAI_ADMIN_COOKIE_SECURE?.toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;

  const configuredUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";

  if (configuredUrl.startsWith("https://")) return true;
  if (configuredUrl.startsWith("http://")) return false;

  return false;
}
