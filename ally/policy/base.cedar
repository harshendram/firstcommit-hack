// Ally base consent policies — shown to the parent on the first-run consent screen.
// Principal = who would RECEIVE or READ the information. Resource = the topic.
// Cedar semantics: an explicit forbid always overrides a permit.

@id("parent-owns-her-data")
@desc("Amma can see and manage everything Ally knows about her.")
permit(principal is Parent, action, resource);

@id("children-receive-updates")
@desc("Her children can get routine, mood, health and safety updates.")
permit(
  principal is Family,
  action in [
    Action::"notify_member", Action::"share_update", Action::"read_day_log",
    Action::"read_signals", Action::"read_alerts", Action::"view_dashboard",
    Action::"view_alert_detail", Action::"ask_ally"
  ],
  resource
)
when { resource in [Topic::"routine", Topic::"mood", Topic::"health", Topic::"safety"] };

@id("children-send-notes")
@desc("Her children can send her a note through Ally.")
permit(principal is Family, action == Action::"send_note", resource == Topic::"self");

@id("conversations-stay-private")
@desc("Amma's conversations with Ally are never shown to anyone else.")
forbid(principal, action, resource == Topic::"conversation")
unless { principal is Parent };

@id("neighbour-only-with-consent")
@desc("A neighbour is contacted only if Amma says yes, or in a critical emergency when no one else responds.")
permit(principal is Neighbour, action == Action::"contact_neighbour", resource == Topic::"safety")
when {
  context.parent_confirmed ||
  (context.escalation_timed_out && context.severity == "critical")
};
