/**
 * Whether sample content may render at all.
 *
 * Its own module, and deliberately not `fixture.ts`. The gate is a boolean; the
 * fixture is prose. A client component that imports the two from the same file
 * pulls the prose into `.next/static` whether or not the gate ever lets it
 * paint, which is what `design-lint`'s `fixture-in-client-bundle` rule exists
 * to stop. Splitting them lets a client component read its gate statically and
 * reach the sample data only through a dynamic import that production never
 * requests.
 *
 * Fails closed: production renders no sample content anywhere.
 */
export const DASH_FIXTURES_ALLOWED =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
