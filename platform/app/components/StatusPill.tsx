const TONE: Record<string, string> = {
  draft: "",
  approved: "pill-accent",
  sent: "pill-accent",
  viewed: "pill-warn",
  accepted: "pill-good",
  paid: "pill-good",
  declined: "pill-bad",
  expired: "pill-bad",
  overdue: "pill-bad",
  void: "",
};

/** Tinted status chip with a dot (design system). */
export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`pill ${TONE[status] ?? ""}`}>
      <span className="dot" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
