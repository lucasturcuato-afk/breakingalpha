/**
 * session-date - today's US market session date, in one place.
 *
 * Both record surfaces need to tell a live window from a closed one, and
 * neither should import the other's module to get it. It never influences a
 * verdict; it only says which day it is.
 */

/** Today's US-Pacific session date, "YYYY-MM-DD". */
export function todayPt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}
