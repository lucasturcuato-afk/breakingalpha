import { redirect } from "next/navigation";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { AppShell } from "@/components/shell";
import { IntelligenceChat } from "./IntelligenceChat";

export const dynamic = "force-dynamic";

export default async function IntelligencePage() {
  const { user } = await getSupabaseWithUser();
  if (!user) redirect("/auth");
  return (
    /* `mobileFullBleed` gates the desk chrome below `md`. Without it
       `AppShell` sets `chrome = "contents"`, so MoodBar, Topbar and Footer
       all render at phone width and stack onto `main`: measured 390x844
       signed in, `main` was 634px of the viewport, the composer sat at
       705..752, and the Footer ran 722..844 over the top of it.
       `elementFromPoint` at the composer's centre returned FOOTER, so the
       only control on the page could not be tapped. This is the route the
       Radar-era tab bar's Ask pole points at. */
    <AppShell pageTitle="Intelligence" mobileFullBleed>
      <IntelligenceChat userId={user.id} />
    </AppShell>
  );
}
