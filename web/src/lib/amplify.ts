"use client";

import { Amplify } from "aws-amplify";
import { fetchAuthSession } from "aws-amplify/auth";

const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? "";
const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "";

let configured = false;

/** Cognito sign-in is on when the pool is configured. Local dev without Cognito uses a dev identity. */
export function authEnabled(): boolean {
  return Boolean(userPoolId && userPoolClientId);
}

export function ensureAmplify(): void {
  if (configured || !authEnabled()) return;
  Amplify.configure({ Auth: { Cognito: { userPoolId, userPoolClientId } } });
  configured = true;
}

export async function idToken(): Promise<string | null> {
  if (!authEnabled()) return null;
  ensureAmplify();
  const session = await fetchAuthSession();
  return session.tokens?.idToken?.toString() ?? null;
}

export interface Viewer {
  memberId: string;
  isParent: boolean;
  groups: string[];
}

export async function currentViewer(): Promise<Viewer> {
  if (!authEnabled()) {
    const dev = devMember();
    return { memberId: dev, isParent: dev === "parent", groups: [dev === "parent" ? "parent" : "family"] };
  }
  ensureAmplify();
  const session = await fetchAuthSession();
  const payload = session.tokens?.idToken?.payload ?? {};
  const groups = (payload["cognito:groups"] as string[] | undefined) ?? [];
  const isParent = groups.includes("parent");
  return { memberId: isParent ? "parent" : String(payload["custom:member_id"] ?? ""), isParent, groups };
}

export function devMember(): string {
  if (typeof window === "undefined") return "parent";
  try {
    return window.localStorage.getItem("ally.devMember") || "parent";
  } catch {
    return "parent";
  }
}

export function setDevMember(member: string): void {
  try {
    window.localStorage.setItem("ally.devMember", member);
  } catch {
    /* storage unavailable */
  }
}
