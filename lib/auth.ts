"use client";

import { getSupabaseClient } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function useRequireUser(onAuthenticated: (userId: string) => void) {
  const router = useRouter();

  useEffect(() => {
    const supabase = getSupabaseClient();

    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      if (!session) {
        router.replace("/");
        return;
      }
      onAuthenticated(session.user.id);
    });
  }, [router, onAuthenticated]);
}

export function useRequireAdmin(
  onAuthenticated: (userId: string, role: string) => void,
) {
  const router = useRouter();

  useEffect(() => {
    const supabase = getSupabaseClient();

    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      if (!session) {
        router.replace("/");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();

      if (profile?.role !== "admin") {
        router.replace("/dashboard");
        return;
      }

      onAuthenticated(session.user.id, profile.role);
    });
  }, [router, onAuthenticated]);
}
