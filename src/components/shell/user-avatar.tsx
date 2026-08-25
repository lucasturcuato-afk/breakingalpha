"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { createBrowserClientAsync } from "@/lib/supabase-browser";
import type { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";

/**
 * Single source of truth for rendering a user's avatar across the shell
 * (top-right user menu and bottom-left sidebar footer).
 *
 * Behaviour:
 *  - Signed-in: renders the user's photo (from `user_metadata.avatar_url`
 *    or `picture`) when available, otherwise the initials computed from
 *    `user_metadata.full_name`, `user_metadata.name`, or the local-part
 *    of the email.
 *  - Signed-out: renders the brand "S" mark. The brand mark is intentionally
 *    only used as a signed-out placeholder. It must not double as a
 *    fallback for an authenticated user (that was the W2-G bug).
 *
 * Auth state is sourced from Supabase's browser client and kept fresh via
 * `onAuthStateChange`, so both render sites stay in sync without prop
 * threading.
 *
 * Visual variants:
 *  - `topbar`: gold-muted pill with gold border, used in the topbar's user
 *    menu trigger.
 *  - `sidebar`: dark espresso square used in the sidebar footer card.
 */

export type UserAvatarVariant = "topbar" | "sidebar";

interface UserAvatarProps {
  variant?: UserAvatarVariant;
  /**
   * Optional pre-resolved user. When omitted the component fetches the
   * current auth user itself. Pass this when the parent already has the
   * user record to avoid a duplicate `getUser()` call.
   */
  user?: User | null;
  className?: string;
}

interface AvatarShape {
  imageUrl: string | null;
  initials: string;
  isSignedIn: boolean;
}

function deriveAvatar(user: User | null | undefined): AvatarShape {
  if (!user) {
    return { imageUrl: null, initials: "", isSignedIn: false };
  }

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const rawImage =
    (typeof meta.avatar_url === "string" && meta.avatar_url) ||
    (typeof meta.picture === "string" && meta.picture) ||
    null;

  const fullName =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    "";

  const source =
    fullName ||
    user.email?.split("@")[0] ||
    "";

  const initials = source
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!)
    .join("")
    .toUpperCase()
    .slice(0, 2) || (user.email?.[0]?.toUpperCase() ?? "U");

  return { imageUrl: rawImage, initials, isSignedIn: true };
}

export function UserAvatar({
  variant = "topbar",
  user: providedUser,
  className,
}: UserAvatarProps) {
  // `undefined` = loading, `null` = signed out, `User` = signed in.
  //
  // When the caller passes `providedUser` we don't run the auth subscription
  // at all. The parent owns the auth record and we just render from props.
  // When omitted, we subscribe to Supabase auth so the topbar instance stays
  // in sync without prop threading.
  const [fetchedUser, setFetchedUser] = useState<User | null | undefined>(
    undefined,
  );
  const isControlled = providedUser !== undefined;

  useEffect(() => {
    if (isControlled) return;
    // Imported on demand. `fetchedUser` starts `undefined`, which already
    // renders the brand mark, so deferring the client changes nothing
    // about what paints first.
    let active = true;
    let unsubscribe: (() => void) | undefined;
    createBrowserClientAsync().then((supabase) => {
      if (!active) return;
      supabase.auth.getUser().then(({ data }) => {
        if (active) setFetchedUser(data.user ?? null);
      });
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (active) setFetchedUser(session?.user ?? null);
      });
      unsubscribe = () => sub.subscription.unsubscribe();
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [isControlled]);

  const user = isControlled ? providedUser : fetchedUser;
  const { imageUrl, initials, isSignedIn } = deriveAvatar(user ?? null);

  const baseClass =
    variant === "topbar"
      ? cn(
          "w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden",
          "border border-gold-border brand-mark-pulse",
          "transition-[box-shadow,border-color] duration-[var(--duration-base)]",
        )
      : cn(
          "w-8 h-8 rounded-lg bg-espresso flex items-center justify-center overflow-hidden flex-shrink-0",
        );

  const baseStyle =
    variant === "topbar"
      ? { backgroundColor: "var(--gold-muted)" }
      : undefined;

  // Photo path: signed-in user with usable image URL.
  if (isSignedIn && imageUrl) {
    return (
      <span
        className={cn(baseClass, className)}
        style={baseStyle}
        aria-hidden="true"
      >
        <Image
          src={imageUrl}
          alt=""
          width={32}
          height={32}
          className="w-full h-full object-cover"
          unoptimized
        />
      </span>
    );
  }

  // Initials path: signed-in user without a photo.
  if (isSignedIn) {
    if (variant === "topbar") {
      return (
        <span
          className={cn(baseClass, className)}
          style={baseStyle}
          aria-hidden="true"
        >
          <span
            className="font-display text-[13px] font-bold leading-none"
            style={{
              backgroundImage:
                "linear-gradient(180deg, var(--gold-light) 0%, var(--gold) 55%, var(--gold-dark) 100%)",
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              color: "transparent",
              WebkitTextFillColor: "transparent",
            }}
          >
            {initials}
          </span>
        </span>
      );
    }
    return (
      <span className={cn(baseClass, className)} aria-hidden="true">
        <span className="font-display text-[11px] font-bold text-gold leading-none">
          {initials}
        </span>
      </span>
    );
  }

  // Signed-out (or still loading): render the brand "S" placeholder. We
  // intentionally render the same glyph during the loading flicker so we
  // don't briefly show a stale or empty pill.
  if (variant === "topbar") {
    return (
      <span
        className={cn(baseClass, className)}
        style={baseStyle}
        aria-hidden="true"
      >
        <span
          className="font-display text-[13px] font-bold leading-none"
          style={{
            backgroundImage:
              "linear-gradient(180deg, var(--gold-light) 0%, var(--gold) 55%, var(--gold-dark) 100%)",
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            color: "transparent",
            WebkitTextFillColor: "transparent",
          }}
        >
          S
        </span>
      </span>
    );
  }
  return (
    <span className={cn(baseClass, className)} aria-hidden="true">
      <span className="font-display text-[11px] font-bold text-gold leading-none">
        S
      </span>
    </span>
  );
}
