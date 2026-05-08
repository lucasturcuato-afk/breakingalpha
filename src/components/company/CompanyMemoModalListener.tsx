"use client";

/**
 * CompanyMemoModalListener (PR-E0)
 *
 * Minimal client-side bridge between CompanyDetailHeader and MemoModal.
 * Header fires `memo:generate` (via window.dispatchEvent) and this listener
 * mounts the MemoModal in response. The Lucas-protected MemoModal.tsx is
 * NOT modified -- only consumed.
 */

import { useEffect, useState } from "react";
import { MemoModal } from "@/components/memo/MemoModal";

interface CompanyMemoModalListenerProps {
  companyName: string;
  memoContent: string;
  systemPrompt: string;
}

export function CompanyMemoModalListener({
  companyName,
  memoContent,
  systemPrompt,
}: CompanyMemoModalListenerProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handle() {
      setOpen(true);
    }
    window.addEventListener("memo:generate", handle);
    return () => window.removeEventListener("memo:generate", handle);
  }, []);

  if (!open) return null;

  return (
    <MemoModal
      isOpen={open}
      onClose={() => setOpen(false)}
      title={companyName}
      content={memoContent}
      type="company"
      systemPrompt={systemPrompt}
    />
  );
}
