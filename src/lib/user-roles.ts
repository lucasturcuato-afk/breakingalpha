import type { UserRole } from "@/lib/user-profile";

/**
 * The display table for `user_profiles.role`. One id, one label, everywhere.
 *
 * Three files carried their own copy before this: `settings/profile/page.tsx`,
 * `settings/PreferencesForm.tsx` and `onboarding/OnboardingWizard.tsx`. They
 * disagreed on the RIA label and on every description, and no design document
 * tracked the PreferencesForm copy at all, so it drifted unobserved. The enum
 * ids are unchanged by anything here, so nothing about this reaches the
 * database.
 *
 * Two rulings live in this table:
 *
 * - Ruling 5. `buy_side` and `sell_side` display as Fund Analyst and Equity
 *   Research. The previous labels carried banned substrings inside ordinary
 *   job titles. Ids are untouched, so there is no migration and no backfill.
 * - Ruling 6. The RIA description is "Managing client capital". The previous
 *   string carried a banned word.
 *
 * `family_office`'s short description is "Multi-asset mandates" for the same
 * reason: the wizard's own short description carries a banned substring. That
 * substitution is correct and was recorded nowhere upstream.
 *
 * The RIA LABEL is the one place this table rules on something no decision
 * covers. Settings said "RIA / Advisor" and the wizard said "RIA / Wealth
 * Manager" for the same id. github.md records that the design reconciled to
 * the wizard, and the prototype draws the wizard's string, so that is the one
 * kept. Flagged in the PR body rather than buried here.
 */
export interface RoleOption {
  id: UserRole;
  label: string;
  /** The long form, as the desktop settings page renders it. */
  description: string;
  /** The short form, as the wizard and every mobile surface render it. */
  shortDescription: string;
}

export const USER_ROLES: RoleOption[] = [
  {
    id: "student_analyst",
    label: "Student Analyst",
    description: "Building investment knowledge and analytical skills",
    shortDescription: "Learning equity research",
  },
  {
    id: "buy_side",
    label: "Fund Analyst",
    description: "Investment fund research and portfolio analysis",
    shortDescription: "Fund research and portfolio",
  },
  {
    id: "sell_side",
    label: "Equity Research",
    description: "Equity research and coverage for clients",
    shortDescription: "Equity research coverage",
  },
  {
    id: "private_equity",
    label: "Private Equity",
    description: "Deal evaluation, due diligence, and portfolio ops",
    shortDescription: "Deal evaluation and ops",
  },
  {
    id: "ria",
    label: "RIA / Wealth Manager",
    description: "Managing client capital",
    shortDescription: "Managing client capital",
  },
  {
    id: "family_office",
    label: "Family Office",
    description: "Multi-asset investment management",
    shortDescription: "Multi-asset mandates",
  },
  {
    id: "other",
    label: "Other",
    description: "Finance professional with custom needs",
    shortDescription: "Custom investor profile",
  },
];
