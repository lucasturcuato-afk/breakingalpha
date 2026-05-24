"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

// Pre-auth public paths where the provider must NOT fetch /api/user-profile.
// Mirrors the public-path list in src/proxy.ts (kept inline to avoid a server
// import in this client hook). Update both if a new public route is added.
const PUBLIC_PATHS = new Set<string>(["/", "/auth", "/preview"]);
const PUBLIC_PATH_PREFIXES = ["/auth/callback", "/legal/"];

function isPublicPath(pathname: string | null): boolean {
  if (!pathname) return false;
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export interface UserProfile {
  id?: string;
  first_name?: string | null;
  role?: string | null;
  firm_or_school?: string | null;
  sectors?: string[] | null;
  risk_appetite?: string | null;
  strategy_type?: string | null;
  investment_horizon?: string | null;
  workflow_style?: string | null;
  watchlist_tickers?: string[] | null;
  market_cards?: string[] | null;
  onboarding_completed?: boolean;
}

interface UserProfileContext {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  updateProfile: (patch: Partial<UserProfile>) => Promise<boolean>;
}

const ProfileContext = createContext<UserProfileContext>({
  profile: null,
  loading: true,
  error: null,
  refetch: async () => {},
  updateProfile: async () => false,
});

export function UserProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/user-profile", { credentials: "include" });
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data = await res.json();
      setProfile(data as UserProfile);
      setError(null);
    } catch {
      // Soft-fail, leave current state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Skip the fetch on known public/pre-auth routes where no session exists.
    // Without this gate, the provider fires a guaranteed 401 against
    // /api/user-profile from /auth on every mount (WD124 root cause).
    if (isPublicPath(pathname)) {
      setLoading(false);
      return;
    }
    refetch();
  }, [pathname, refetch]);

  const updateProfile = useCallback(
    async (patch: Partial<UserProfile>): Promise<boolean> => {
      // Optimistic update
      const prev = profile;
      setProfile((p) => (p ? { ...p, ...patch } : patch));
      setError(null);

      try {
        const res = await fetch("/api/user-profile", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });

        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || "Failed to save profile");
        }

        const data = await res.json().catch(() => null);
        if (data?.profile) {
          setProfile(data.profile as UserProfile);
        }

        // Refetch in background to ensure consistency
        refetch();
        return true;
      } catch (err) {
        // Revert optimistic update
        setProfile(prev);
        setError(err instanceof Error ? err.message : "Something went wrong");
        return false;
      }
    },
    [profile, refetch],
  );

  return (
    <ProfileContext.Provider value={{ profile, loading, error, refetch, updateProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useUserProfile() {
  return useContext(ProfileContext);
}
