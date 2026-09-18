"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { ShieldGlyph } from "@/components/landing/BrandMark";
import { ArrowRight, Check, Cross, Eye, Lock } from "@/components/ui/Icon";
import { AppHeader, AppShell, Banner, EmptyState, PageHero, PillLink, SectionTitle } from "@/components/ui/Shell";
import { api } from "@/lib/api";
import type { SurakshaLanguage, SurakshaState, ConsentRule } from "@/lib/surakshaTypes";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface AuditEntry {
  id: string;
  at: string;
  decision: "allow" | "deny";
  action: string;
  topic: string;
  reason: string;
  who: string;
  who_type: string;
  summary?: string;
}

const TOPIC: Record<string, Record<SurakshaLanguage, string>> = {
  routine: { "hi-IN": "आपकी दिनचर्या", "en-IN": "your routine" },
  mood: { "hi-IN": "आपका मूड", "en-IN": "your mood" },
  health: { "hi-IN": "आपकी तबीयत", "en-IN": "your health" },
  safety: { "hi-IN": "आपकी सुरक्षा", "en-IN": "your safety" },
  conversation: { "hi-IN": "आपकी बातचीत", "en-IN": "your conversations" },
  location: { "hi-IN": "आप कहाँ हैं", "en-IN": "where you are" },
  self: { "hi-IN": "आपके लिए संदेश", "en-IN": "a note for you" },
};

const ACTION: Record<string, Record<SurakshaLanguage, string>> = {
  notify_member: { "hi-IN": "को बताया गया", "en-IN": "was told about" },
  share_update: { "hi-IN": "को आपका संदेश मिला", "en-IN": "received your message about" },
  read_day_log: { "hi-IN": "ने पूछा", "en-IN": "asked about" },
  read_alerts: { "hi-IN": "ने देखा", "en-IN": "looked at" },
  read_conversation: { "hi-IN": "ने देखना चाहा", "en-IN": "tried to see" },
  view_dashboard: { "hi-IN": "ने डैशबोर्ड खोला —", "en-IN": "opened the dashboard —" },
  contact_neighbour: { "hi-IN": "से मदद माँगी —", "en-IN": "was asked to check on you —" },
  send_note: { "hi-IN": "ने आपको संदेश भेजा —", "en-IN": "sent you a note —" },
};

export default function PrivacyPage() {
  return <AuthGate>{() => <Privacy />}</AuthGate>;
}

function Privacy() {
  const [lang, setLang] = useState<SurakshaLanguage>("hi-IN");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [rules, setRules] = useState<ConsentRule[]>([]);
  const [base, setBase] = useState<{ id: string; description: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [state, audit, consent] = await Promise.all([
        api<SurakshaState>("/suraksha/state"),
        api<{ entries: AuditEntry[] }>("/suraksha/parent/audit"),
        api<{ base: { id: string; description: string }[]; rules: ConsentRule[] }>("/suraksha/parent/consent"),
      ]);
      setLang(state.language ?? "hi-IN");
      setEntries(audit.entries);
      setRules(consent.rules.filter((r) => r.status === "active"));
      setBase(consent.base);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    await api(`/suraksha/parent/consent/${id}`, { method: "DELETE" }).catch(() => undefined);
    await load();
  };

  const time = (iso: string) =>
    new Date(iso).toLocaleString(lang === "hi-IN" ? "hi-IN" : "en-IN", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });

  const shared = entries.filter((e) => e.decision === "allow").length;
  const blocked = entries.length - shared;

  return (
    <AppShell width="narrow">
      <AppHeader
        label={t("privacy", lang)}
        actions={
          <>
            <PillLink onClick={() => setLang(lang === "hi-IN" ? "en-IN" : "hi-IN")}>
              {lang === "hi-IN" ? "English" : "हिन्दी"}
            </PillLink>
            <PillLink href="/parent" tone="accent">
              {t("back", lang)}
              <ArrowRight size={13} />
            </PillLink>
          </>
        }
      />

      <PageHero
        tone="alert"
        icon={<ShieldGlyph size={18} />}
        compact
        eyebrow={lang === "hi-IN" ? "आपके नियम" : "Your rules"}
        title={t("privacy", lang)}
        lede={
          lang === "hi-IN"
            ? `Suraksha ने ${shared} बार कुछ बताया और ${blocked} बार रोका।`
            : `Suraksha shared something ${shared} times and blocked it ${blocked} times.`
        }
      />

      {error && (
        <Banner tone="alert">
          <span>{error}</span>
        </Banner>
      )}

      <section className="panel p-6">
        <SectionTitle eyebrow={lang === "hi-IN" ? "आपके फैसले" : "Your decisions"} title={t("yourRules", lang)} />
        <div className="mt-4">
          {rules.length === 0 ? (
            <EmptyState icon={<Lock size={22} />}>
              {lang === "hi-IN"
                ? "आप Suraksha से कह सकती हैं: “प्रिया को मेरी तबीयत के बारे में मत बताना।”"
                : "You can tell Suraksha: “Don't tell Priya about my health.”"}
            </EmptyState>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  className="list-row items-center justify-between"
                >
                  <span className="flex items-start gap-3">
                    <span className="mt-0.5 text-ink">
                      <Lock size={17} />
                    </span>
                    <span className="text-[1.1rem] leading-snug text-ink">
                      {lang === "hi-IN" ? rule.description_hi : rule.description}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost shrink-0 py-2"
                    onClick={() => void revoke(rule.id)}
                  >
                    {t("revoke", lang)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <details className="mt-5 border-t border-line pt-4">
          <summary className="cursor-pointer text-sm text-ink-soft">{t("alwaysRules", lang)}</summary>
          <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0 text-sm text-ink-soft">
            {base.map((rule) => (
              <li key={rule.id} className="flex items-start gap-2">
                <span className="mt-0.5 text-ink-faint">
                  <ShieldGlyph size={14} />
                </span>
                {rule.description}
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className="panel p-6">
        <SectionTitle
          eyebrow={lang === "hi-IN" ? "पूरा रिकॉर्ड" : "Full record"}
          title={lang === "hi-IN" ? "Suraksha ने हर बार क्या किया" : "Every decision Suraksha made"}
        />
        <div className="mt-4">
          {entries.length === 0 ? (
            <EmptyState icon={<Eye size={22} />}>{t("nothingShared", lang)}</EmptyState>
          ) : (
            <ol className="m-0 flex list-none flex-col p-0">
              {entries.map((entry, i) => {
                const allowed = entry.decision === "allow";
                const action = ACTION[entry.action]?.[lang] ?? entry.action.replace(/_/g, " ");
                const topic = TOPIC[entry.topic]?.[lang] ?? entry.topic;
                return (
                  <li key={entry.id} className="relative flex gap-4 pb-5 last:pb-0">
                    {i < entries.length - 1 && <span className="absolute left-[15px] top-9 bottom-0 w-px bg-line" aria-hidden />}
                    <span
                      className={cn(
                        "relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                        allowed ? "border-ok/30 bg-ok-wash text-ok" : "border-alert/30 bg-alert-wash text-alert",
                      )}
                    >
                      {allowed ? <Check size={15} /> : <Cross size={15} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className={cn("eyebrow-sm", allowed ? "text-ok" : "text-alert")}>
                          {allowed ? t("allowed", lang) : t("blocked", lang)}
                        </span>
                        <span className="tnum eyebrow-sm text-ink-faint">{time(entry.at)}</span>
                      </span>
                      <p className="m-0 mt-1.5 text-[1.1rem] leading-snug text-ink">
                        <strong className="font-semibold">{entry.who}</strong> {action} {topic}
                      </p>
                      <p className="m-0 mt-1 text-sm leading-snug text-ink-soft">{entry.reason}</p>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>
    </AppShell>
  );
}
