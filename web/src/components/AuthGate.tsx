"use client";

import "@aws-amplify/ui-react/styles.css";
import { Authenticator } from "@aws-amplify/ui-react";
import { useEffect, useState, type ReactNode } from "react";
import { ShieldGlyph, BrandMark } from "@/components/landing/BrandMark";
import { authEnabled, currentViewer, devMember, ensureAmplify, setDevMember, type Viewer } from "@/lib/amplify";

function AuthHeader() {
  return (
    <div className="auth-brand">
      <BrandMark />
      <p className="eyebrow">Family sign in</p>
    </div>
  );
}

function BootScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper">
      <span className="text-alert">
        <ShieldGlyph size={36} />
      </span>
    </div>
  );
}

/**
 * Signs the viewer in with Cognito (family phones, Amma's tablet). Without a configured pool
 * (local dev) it shows a small identity switcher instead.
 */
export function AuthGate({ children }: { children: (viewer: Viewer, signOut?: () => void) => ReactNode }) {
  if (!authEnabled()) return <DevGate>{children}</DevGate>;
  ensureAmplify();
  return (
    <Authenticator
      hideSignUp
      components={{
        Header: AuthHeader,
        SignIn: { Header: () => null },
      }}
    >
      {({ signOut }) => <ViewerLoader signOut={signOut}>{children}</ViewerLoader>}
    </Authenticator>
  );
}

function ViewerLoader({
  children,
  signOut,
}: {
  children: (viewer: Viewer, signOut?: () => void) => ReactNode;
  signOut?: () => void;
}) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  useEffect(() => {
    void currentViewer().then(setViewer);
  }, []);
  if (!viewer) return <BootScreen />;
  return <>{children(viewer, signOut)}</>;
}

function DevGate({ children }: { children: (viewer: Viewer) => ReactNode }) {
  const [member, setMember] = useState<string | null>(null);
  useEffect(() => setMember(devMember()), []);
  if (!member) return <BootScreen />;
  const viewer: Viewer = { memberId: member, isParent: member === "parent", groups: [member === "parent" ? "parent" : "family"] };
  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-line bg-card/90 px-3.5 py-2 text-xs text-ink-soft shadow-[0_8px_24px_-14px_oklch(0.26_0.032_42/0.5)] backdrop-blur">
        <span className="eyebrow-sm text-ink-faint">viewing as</span>
        <select
          className="cursor-pointer bg-transparent font-semibold text-ink outline-none"
          value={member}
          onChange={(e) => {
            setDevMember(e.target.value);
            window.location.reload();
          }}
        >
          <option value="parent">Amma (tablet)</option>
          <option value="rahul">Rahul</option>
          <option value="priya">Priya</option>
          <option value="sunita">Sunita aunty</option>
        </select>
      </div>
      {children(viewer)}
    </>
  );
}
