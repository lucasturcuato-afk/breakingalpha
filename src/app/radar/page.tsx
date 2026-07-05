import { redirect } from "next/navigation";

/** /radar lands on the Following sub-tab. */
export default function RadarIndexPage() {
  redirect("/radar/following");
}
