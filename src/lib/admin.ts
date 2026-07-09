// Admin whitelist. Compares against ADMIN_EMAIL env — never trust client input.
// Multiple admins can be supported later by splitting on comma; keep single-value
// today to stay honest about the "딱 한 명" scope decision.

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const configured = process.env.ADMIN_EMAIL?.trim();
  if (!configured) return false;
  return email.toLowerCase() === configured.toLowerCase();
}
