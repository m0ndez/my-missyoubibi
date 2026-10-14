// Shared look of text inputs and selects (the colour tokens are in globals.css).
export const control =
  "w-full rounded-lg border border-edge bg-raised px-3 text-base text-ink transition-colors placeholder:text-muted hover:border-ink/60";

export type Unit = { id: string; name: string; mac: string };

// Quick picks for naming a unit by where it is: easier to recognise than the model number.
export const ROOM_NAMES = [
  "Living room",
  "Master bedroom",
  "Bedroom",
  "Kids room",
  "Guest room",
  "Office",
  "Kitchen",
  "Dining room",
];

// A request answered 401: the session ended (signed out elsewhere, or expired). Go to the login page; true if that happened.
export function signedOut(
  res: Response,
  router: { replace: (url: string) => void },
): boolean {
  if (res.status !== 401) return false;
  router.replace("/login");
  return true;
}
