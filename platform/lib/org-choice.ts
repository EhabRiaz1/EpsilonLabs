// Which organisation the portal shows when a user belongs to several (the org switcher). Pure (unit-tested).
export const ORG_COOKIE = "eps-org";

export function pickOrg<T extends { orgId: string }>(memberships: readonly T[], wanted: string | null | undefined): T | null {
  return memberships.find((m) => m.orgId === wanted) ?? memberships[0] ?? null;
}
