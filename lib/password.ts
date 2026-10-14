import { check } from "./check.ts";

// The login password protects control of real hardware on a home network, so a weak one is refused at start-up. No imports beyond
// the check helper: `npm run setup` (plain Node) uses this too.
export const MIN_PASSWORD = 10;
const COMMON = new Set(["password", "password1", "password123", "1234567890", "qwertyuiop", "adminadmin", "letmein123", "change-me", "changeme"]);

// Why a password is too weak, or null if it is fine.
export function weakPassword(p: string): string | null {
  if (p.length < MIN_PASSWORD) return `shorter than ${MIN_PASSWORD} characters`;
  if (COMMON.has(p.toLowerCase())) return "a well-known password";
  if (/^(.)\1+$/.test(p)) return "one repeated character";
  // .env and Docker Compose read these differently (comments, variable substitution, quotes): the password would not be what you typed.
  if (/[\s$#"'`\\]/.test(p)) return "containing a space, $, #, quote or backslash, which .env and Docker Compose misread";
  return null;
}

// Self-check: `npx tsx lib/password.ts`
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("lib/password.ts")) {
  check(weakPassword("admin") !== null && weakPassword("change-me") !== null && weakPassword("short") !== null, "short and placeholder passwords are weak");
  check(weakPassword("Password123") !== null && weakPassword("aaaaaaaaaaaa") !== null, "common and repeated passwords are weak");
  check(weakPassword("abc#defghijk") !== null && weakPassword("abc$defghijk") !== null && weakPassword("has a space 12345") !== null, "characters .env misreads are refused"); 
  check(weakPassword("kQ3v-9xTm2Lw") === null && weakPassword("correct-horse-battery") === null, "a decent password passes");
  console.log("password.ts checks done");
}
