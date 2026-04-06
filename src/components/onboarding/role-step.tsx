"use client";

import { cn } from "@/lib/utils";
import { Briefcase, TrendingUp, GraduationCap, Building2 } from "lucide-react";
import type { ReactNode } from "react";

interface RoleOption {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
}

const roles: RoleOption[] = [
  { id: "analyst", label: "Analyst", description: "Research-focused, deep dives into sectors and companies", icon: <TrendingUp size={20} /> },
  { id: "investor", label: "Investor / PM", description: "Portfolio management, thesis-driven investing", icon: <Briefcase size={20} /> },
  { id: "founder", label: "Founder / Operator", description: "Market intelligence for strategy and fundraising", icon: <Building2 size={20} /> },
  { id: "student", label: "Student / Learning", description: "Building market intuition and analytical skills", icon: <GraduationCap size={20} /> },
];

interface RoleStepProps {
  selected: string | null;
  onSelect: (role: string) => void;
}

export function RoleStep({ selected, onSelect }: RoleStepProps) {
  return (
    <div>
      <h2 className="font-display text-[22px] font-extrabold text-espresso mb-1">
        What&apos;s your role?
      </h2>
      <p className="font-sans text-[13px] text-text-secondary mb-5">
        This helps us tailor your Signalera experience.
      </p>

      <div className="grid grid-cols-2 gap-2.5">
        {roles.map((role) => (
          <button
            key={role.id}
            type="button"
            onClick={() => onSelect(role.id)}
            className={cn(
              "flex flex-col items-start gap-2 p-4 rounded-xl border text-left",
              "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
              "cursor-pointer",
              selected === role.id
                ? "border-gold bg-gold-muted [&_svg]:text-gold"
                : "border-border-base bg-white hover:border-border-hover [&_svg]:text-text-faint",
            )}
          >
            {role.icon}
            <div>
              <h3 className="font-sans text-[13px] font-bold text-text-primary">
                {role.label}
              </h3>
              <p className="font-sans text-[11px] text-text-muted mt-0.5">
                {role.description}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
