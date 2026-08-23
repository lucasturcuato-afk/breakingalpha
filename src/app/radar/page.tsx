import { redirect } from "next/navigation";

/**
 * /radar lands on Calls.
 *
 * It used to land on Following, which is empty for all but three accounts: a
 * user arriving from the sidebar saw a page with nothing on it and no object to
 * act on. Calls has the brief's recent adoptable calls, the desk's graded
 * record beside an empty personal one, and the composer. It is the only Radar
 * tab that has content for a user who holds nothing.
 */
export default function RadarIndexPage() {
  redirect("/radar/calls");
}
