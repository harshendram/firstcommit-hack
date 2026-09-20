import { config } from "../config.js";
import { sessionStore } from "../state/sessionStore.js";
import type { EscalationHop } from "../types.js";
import { normalizeE164, notifier } from "./notifications.js";

type OnUpdate = () => void;

/**
 * Escalation chain:
 * - live: a real Amazon Connect phone call (SMS via Amazon SNS) for the roles listed in
 *   ESCALATION_CALL_ROLES; remaining hops animate as simulated status so the
 *   Command Center still shows the full chain.
 * - simulated: timed status updates only (no credentials needed).
 *
 * Acknowledgement paths: keypad "press 1" during the call, a YES reply over
 * an SMS reply, or the Family PWA "I'm On My Way" button.
 */
export class EscalationService {
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private runId = 0;

  start(chain: EscalationHop[], onUpdate: OnUpdate): void {
    this.stop();
    this.running = true;
    const myRun = ++this.runId;

    const hops =
      chain.length > 0 ? chain : sessionStore.defaultEscalationChain();

    const normalized = hops.map((h) => ({
      ...h,
      phone: h.phone ?? this.phoneForRole(h.contact_role),
      channel: h.channel,
      status: "pending" as const,
      notified_at: undefined,
    }));
    sessionStore.setEscalationChain(normalized);
    onUpdate();

    const live = config.escalationMode === "live" && notifier.ready;

    if (config.escalationMode === "live" && !notifier.ready) {
      console.error(
        "[escalation] ESCALATION_MODE=live but no AWS delivery channel is configured — falling back to simulated"
      );
    }

    if (!live) {
      this.runSimulated(normalized, onUpdate, myRun);
      return;
    }

    void this.runLive(normalized, onUpdate, myRun).catch((err) => {
      console.error("[escalation] runLive crashed:", err);
    });
  }

  /**
   * Pick the hop that should absorb an inbound ack for this phone.
   * When every demo contact shares one number, prefer family / live call
   * roles that are still waiting — never the first already-acked neighbour.
   */
  resolveHopIndexForPhone(phoneRaw: string): number {
    const target = normalizeE164(phoneRaw);
    if (!target) return -1;

    const chain = sessionStore.get().escalation_chain;
    const matches = chain
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => h.phone && normalizeE164(h.phone) === target);

    if (matches.length === 0) return -1;

    const prefer =
      matches.find(
        ({ h }) =>
          h.contact_role === "family" && h.status !== "acknowledged"
      ) ??
      matches.find(
        ({ h }) =>
          config.escalationCallRoles.has(h.contact_role) &&
          (h.status === "notified" || h.status === "pending" || h.status === "timed_out")
      ) ??
      matches.find(
        ({ h }) => h.status === "notified" || h.status === "pending"
      ) ??
      matches.find(({ h }) => h.status !== "acknowledged") ??
      matches[0];

    return prefer?.i ?? -1;
  }

  /** Mark the hop matching this phone number as acknowledged. */
  acknowledgeByPhone(phoneRaw: string, via: string): boolean {
    const index = this.resolveHopIndexForPhone(phoneRaw);
    if (index < 0) {
      console.warn(
        `[escalation] ack from unknown number: ${normalizeE164(phoneRaw)}`
      );
      return false;
    }

    const hop = sessionStore.get().escalation_chain[index]!;
    if (hop.status === "acknowledged") {
      this.stop();
      return true;
    }

    if (hop.status === "pending" || hop.status === "timed_out") {
      sessionStore.updateEscalationHop(index, "notified");
    }
    sessionStore.updateEscalationHop(index, "acknowledged");
    console.log(
      `[escalation] ${hop.contact_role} acknowledged via ${via} from ${normalizeE164(phoneRaw)}`
    );
    // Someone responded — stop walking the ladder (no EMS after family confirms)
    this.stop();
    return true;
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private phoneForRole(
    role: EscalationHop["contact_role"]
  ): string | undefined {
    return config.contactPhones[role] || undefined;
  }

  private isCurrentRun(runId: number): boolean {
    return this.running && this.runId === runId;
  }

  private runSimulated(
    normalized: EscalationHop[],
    onUpdate: OnUpdate,
    runId: number
  ): void {
    console.log("[escalation] mode=simulated");
    let delay = 800;
    normalized.forEach((_, index) => {
      const notifyAt = delay;
      const ackAt = delay + 1200;
      delay += 2500;

      this.timers.push(
        setTimeout(() => {
          if (!this.isCurrentRun(runId)) return;
          sessionStore.updateEscalationHop(index, "notified");
          onUpdate();
          console.log(`[escalation] notified hop ${index}`);
        }, notifyAt)
      );

      const role = normalized[index]?.contact_role;
      if (role !== "emergency_services") {
        this.timers.push(
          setTimeout(() => {
            if (!this.isCurrentRun(runId)) return;
            // Don't keep climbing after an earlier hop already ack'd
            const earlierAcked = sessionStore
              .get()
              .escalation_chain.slice(0, index)
              .some((h) => h.status === "acknowledged");
            if (earlierAcked) {
              this.stop();
              return;
            }
            sessionStore.updateEscalationHop(index, "acknowledged");
            onUpdate();
            console.log(`[escalation] acknowledged hop ${index}`);
            this.stop();
          }, ackAt)
        );
      }
    });
  }

  private async runLive(
    normalized: EscalationHop[],
    onUpdate: OnUpdate,
    runId: number
  ): Promise<void> {
    const callRoles = [...config.escalationCallRoles].join(",");
    console.log(
      `[escalation] mode=live channel=${config.escalationChannel} realContact=[${callRoles}] hops=${normalized.length}`
    );

    for (let index = 0; index < normalized.length; index++) {
      if (!this.isCurrentRun(runId)) return;

      // Someone already confirmed — don't keep dialing
      if (
        sessionStore
          .get()
          .escalation_chain.some((h) => h.status === "acknowledged")
      ) {
        this.stop();
        return;
      }

      const hop = sessionStore.get().escalation_chain[index] ?? normalized[index]!;
      const handoff = sessionStore.get().handoff;

      await this.sleep(index === 0 ? 400 : config.escalationHopDelayMs);
      if (!this.isCurrentRun(runId)) return;

      const isRealContact = config.escalationCallRoles.has(hop.contact_role);

      if (!isRealContact) {
        // Visual-only hop. Do NOT auto-ack when this phone is also a live
        // contact — otherwise press-1 matches the neighbour and no-ops.
        const phone = hop.phone ? normalizeE164(hop.phone) : "";
        const sharesLivePhone =
          Boolean(phone) &&
          normalized.some(
            (h) =>
              config.escalationCallRoles.has(h.contact_role) &&
              h.phone &&
              normalizeE164(h.phone) === phone
          );

        sessionStore.updateEscalationHop(index, "notified");
        onUpdate();
        if (!sharesLivePhone && hop.contact_role !== "emergency_services") {
          await this.sleep(1200);
          if (!this.isCurrentRun(runId)) return;
          sessionStore.updateEscalationHop(index, "acknowledged");
          onUpdate();
        }
        continue;
      }

      const result = await notifier.notifyContact(hop, handoff);
      if (!this.isCurrentRun(runId)) return;

      if (!result.ok) {
        sessionStore.updateEscalationHop(index, "timed_out");
        onUpdate();
        console.error(
          `[escalation] ${hop.contact_role} notify failed: ${result.error}`
        );
        continue;
      }

      sessionStore.updateEscalationHop(index, "notified", {
        channel: result.channel,
      });
      onUpdate();
      console.log(
        `[escalation] ${hop.contact_role} contacted via ${result.channel} id=${result.id}`
      );

      if (hop.contact_role === "emergency_services") continue;

      const acked = await this.waitForAck(index, config.escalationAckTimeoutMs, runId);
      if (!this.isCurrentRun(runId)) return;
      if (acked) {
        console.log(
          `[escalation] ${hop.contact_role} confirmed — stopping chain`
        );
        this.stop();
        return;
      }

      const current = sessionStore.get().escalation_chain[index];
      if (current && current.status === "notified") {
        sessionStore.updateEscalationHop(index, "timed_out");
        onUpdate();
        console.warn(
          `[escalation] ${hop.contact_role} timed out waiting for confirmation — continuing chain`
        );
      }
    }
  }

  private waitForAck(
    index: number,
    timeoutMs: number,
    runId: number
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (!this.isCurrentRun(runId)) {
          resolve(false);
          return;
        }
        const hop = sessionStore.get().escalation_chain[index];
        if (hop?.status === "acknowledged") {
          resolve(true);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          resolve(false);
          return;
        }
        this.timers.push(setTimeout(tick, 500));
      };
      tick();
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.timers.push(setTimeout(resolve, ms));
    });
  }
}

export const escalationService = new EscalationService();
