import { redirect } from "next/navigation";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { AppShell } from "@/components/shell";
import { IntelligenceChat } from "./IntelligenceChat";

export const dynamic = "force-dynamic";

export default async function IntelligencePage() {
  const { user } = await getSupabaseWithUser();
  if (!user) redirect("/auth");
  return (
    <AppShell pageTitle="Intelligence">
      <IntelligenceChat userId={user.id} />
    </AppShell>
  );
}
