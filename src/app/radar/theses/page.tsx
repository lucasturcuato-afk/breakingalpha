/**
 * /radar/theses — retired as a standalone destination. The thesis
 * workspace now lives inline in Calls as the demoted "Tracked views"
 * section (src/components/thesis/TrackedViews.tsx). This route only
 * forwards old deep links: ?thesis=<id> opens that tracked view in
 * place; a bare visit opens the section.
 */

import { redirect } from "next/navigation";

export default async function ThesesRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const thesis = typeof params.thesis === "string" ? params.thesis : null;
  redirect(
    thesis
      ? `/radar/calls?thesis=${encodeURIComponent(thesis)}`
      : "/radar/calls?views=open",
  );
}
