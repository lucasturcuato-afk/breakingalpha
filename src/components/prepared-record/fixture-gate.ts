/**
 * The Prepared record's fixture gate, and nothing else.
 *
 * This constant is deliberately in its own module, apart from the entries it
 * guards. `./fixture` carries forty-one invented claims signed with an
 * invented name and is imported by the server page only, so none of that copy
 * reaches the browser. The gate itself is two environment comparisons with no
 * content in it, so it is safe to evaluate on both sides of the boundary, and
 * it has to be: the page decides which fixture to build, and `RecordScreen`
 * re-checks before it renders anything it was handed. A gate that has to be
 * remembered at each call site is one that gets missed at one of them, and
 * this screen has two call sites already.
 *
 * The fixture may not reach production. Delete this and its uses when a loader
 * lands.
 *
 * /record is a new route, but it is not an anonymous one: the proxy gates it
 * behind auth outside local dev, so the person who reaches it in production is
 * a real signed-in user and this screen is a record of THEIR calls under THEIR
 * name. An ungated fixture would show them forty-one calls they never made,
 * signed by somebody else.
 *
 * FAILS CLOSED: anything that is not development and not an explicit preview
 * deploy is treated as production. Both variables are inlined at build time,
 * so the client copy of this check is the same check, not a weaker one.
 */
export const RECORD_FIXTURE_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
