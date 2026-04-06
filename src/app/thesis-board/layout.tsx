import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Thesis Board — Signalera",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
