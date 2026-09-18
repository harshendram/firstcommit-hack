import { rewriteLoopbackHost } from "./localUrl";

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  email: string | null;
}

export interface PatientProfileDto {
  user_id: string;
  name: string;
  age: number | null;
  location: string;
  procedure: string;
  discharged_on: string | null;
  conditions: string[];
  medications: string[];
  preferred_language: string;
  discharge_summary: string | null;
  updated_at: string;
}

const TOKEN_KEY = "rakshak_token";
const USER_KEY = "rakshak_user";

export function apiBase(): string {
  return rewriteLoopbackHost(
    (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api").replace(
      /\/$/,
      ""
    )
  );
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function storeAuth(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function authHeaders(): HeadersInit {
  const token = getStoredToken();
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

export async function registerAuth(input: {
  username: string;
  password: string;
  name: string;
  email?: string;
}): Promise<{ user: AuthUser; token: string }> {
  const res = await fetch(`${apiBase()}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as {
    user?: AuthUser;
    token?: string;
    error?: string;
  };
  if (!res.ok || !body.user || !body.token) {
    throw new Error(body.error || "Registration failed");
  }
  storeAuth(body.token, body.user);
  return { user: body.user, token: body.token };
}

export async function loginAuth(
  username: string,
  password: string
): Promise<{ user: AuthUser; token: string }> {
  const res = await fetch(`${apiBase()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    user?: AuthUser;
    token?: string;
    error?: string;
  };
  if (!res.ok || !body.user || !body.token) {
    throw new Error(body.error || "Login failed");
  }
  storeAuth(body.token, body.user);
  return { user: body.user, token: body.token };
}

export async function fetchMyProfile(): Promise<{
  profile: PatientProfileDto | null;
  ready: boolean;
}> {
  const res = await fetch(`${apiBase()}/profiles/me`, {
    headers: authHeaders(),
  });
  const body = (await res.json().catch(() => ({}))) as {
    profile?: PatientProfileDto | null;
    ready?: boolean;
    error?: string;
  };
  if (!res.ok) throw new Error(body.error || "Could not load profile");
  return { profile: body.profile ?? null, ready: Boolean(body.ready) };
}

export async function saveMyProfile(input: {
  name: string;
  age?: number | null;
  location?: string;
  procedure?: string;
  discharged_on?: string | null;
  conditions?: string;
  medications?: string;
  preferred_language?: string;
  discharge_summary?: string;
}): Promise<{ profile: PatientProfileDto; ready: boolean }> {
  const res = await fetch(`${apiBase()}/profiles/me`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as {
    profile?: PatientProfileDto;
    ready?: boolean;
    error?: string;
  };
  if (!res.ok || !body.profile) {
    throw new Error(body.error || "Could not save profile");
  }
  return { profile: body.profile, ready: Boolean(body.ready) };
}

/** Upload discharge PDF for the logged-in user (optional). */
export async function uploadMyDischargePdf(
  file: File,
  language = "en-IN"
): Promise<{
  ok: boolean;
  preview: string;
  chars: number;
  ready: boolean;
}> {
  const form = new FormData();
  form.append("file", file);
  form.append("language", language);
  const token = getStoredToken();
  const res = await fetch(`${apiBase()}/profiles/me/discharge`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    preview?: string;
    chars?: number;
    ready?: boolean;
    error?: string;
  };
  if (!res.ok) throw new Error(body.error || "Upload failed");
  return {
    ok: Boolean(body.ok),
    preview: body.preview ?? "",
    chars: body.chars ?? 0,
    ready: Boolean(body.ready),
  };
}

/** Doctor dashboard: still updates the demo Lakshmi care.json patient. */
export async function uploadDischargePdf(
  file: File,
  language = "en-IN"
): Promise<{ ok: boolean; preview: string; chars: number }> {
  const form = new FormData();
  form.append("file", file);
  form.append("language", language);
  const token = getStoredToken();
  const res = await fetch(`${apiBase()}/care/discharge/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    preview?: string;
    chars?: number;
    error?: string;
  };
  if (!res.ok) throw new Error(body.error || "Upload failed");
  return {
    ok: Boolean(body.ok),
    preview: body.preview ?? "",
    chars: body.chars ?? 0,
  };
}
