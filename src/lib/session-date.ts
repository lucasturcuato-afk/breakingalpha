/**
 * session-date - today's US market session date, in one place.
 *
 * Both record surfaces need to tell a live window from a closed one, and
 * neither should import the other's module to get it. It never influences a
 * verdict; it only says which day it is.
 */

/**
 * The US market session date for a given instant, "YYYY-MM-DD", anchored to
 * US-Pacific. This is the one place the product decides "which trading day is
 * it," so claim write paths, the record surfaces, and the display clamp all
 * agree. Using UTC here is the bug behind #543/#571: after ~5pm PT the UTC date
 * has already rolled forward, so a claim stamped in UTC stored a window a day
 * ahead of the session the user was acting on.
 */
export function sessionDatePt(date: Date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** Today's US-Pacific session date, "YYYY-MM-DD". */
export function todayPt(): string {
  return sessionDatePt();
}
