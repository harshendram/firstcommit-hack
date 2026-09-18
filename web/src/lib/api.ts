"use client";

import { surakshaApiUrl } from "./surakshaTypes";
import { authEnabled, devMember, idToken } from "./amplify";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public say?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  if (authEnabled()) {
    const token = await idToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
  } else {
    headers.set("x-dev-member", devMember());
  }
  let res: Response;
  try {
    res = await fetch(`${surakshaApiUrl()}${path}`, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
  } catch {
    throw new ApiError(0, "network", "Can't reach Suraksha. Check your connection.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? "error", body.message ?? "Something went wrong.", body.say);
  }
  return body as T;
}
