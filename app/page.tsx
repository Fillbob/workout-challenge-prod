"use client";

import { getSupabaseClient } from "@/lib/supabaseClient";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

export default function Home() {
  const supabase = getSupabaseClient();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace("/dashboard");
      }
    });
  }, [router, supabase]);

  const ensureProfile = async (
    user: { id: string; email?: string | null },
    displayName?: string,
  ) => {
    const derivedName = (displayName || user.email?.split("@")[0] || "New athlete").trim();

    const { data: existing, error } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!existing) {
      await supabase
        .from("profiles")
        .insert({ id: user.id, display_name: derivedName, role: "user" })
        .throwOnError();
      return;
    }

    if (!existing.display_name) {
      await supabase
        .from("profiles")
        .update({ display_name: derivedName })
        .eq("id", user.id)
        .throwOnError();
    }
  };

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);

    if (!email || !password) {
      setStatus("Please provide both email and password.");
      return;
    }

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
      });
      if (error) {
        setStatus(error.message);
        return;
      }
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setStatus(error.message);
      return;
    }

    if (data.session?.user) {
      await ensureProfile(data.session.user);
      router.replace("/dashboard");
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-black p-6">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl space-y-8">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-[0.3em] text-indigo-400">Workout Challenge</p>
          <h1 className="text-3xl font-semibold text-white">Compete. Collaborate. Grow stronger.</h1>
          <p className="text-slate-400">
            Log in or create an account to join teams, tackle weekly challenges, and climb the leaderboard.
          </p>
        </div>

        <div className="flex gap-3 text-sm font-medium bg-slate-800 rounded-lg p-1">
          <button
            className={`flex-1 py-2 rounded-md transition ${
              mode === "login" ? "bg-indigo-500 text-white" : "text-slate-300"
            }`}
            onClick={() => setMode("login")}
          >
            Log in
          </button>
          <button
            className={`flex-1 py-2 rounded-md transition ${
              mode === "signup" ? "bg-indigo-500 text-white" : "text-slate-300"
            }`}
            onClick={() => setMode("signup")}
          >
            Sign up
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleAuth}>
          <div className="space-y-2">
            <label className="text-sm text-slate-300">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-slate-300">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="••••••••"
            />
          </div>
          {status && <p className="text-sm text-rose-400">{status}</p>}
          <button
            type="submit"
            className="w-full bg-indigo-500 hover:bg-indigo-600 transition text-white font-semibold rounded-lg py-3"
          >
            {mode === "login" ? "Continue" : "Create account"}
          </button>
        </form>

        <div className="text-slate-400 text-sm">
          Need to reset your password? <Link className="text-indigo-400" href="/auth/forgot-password">Reset here</Link>
        </div>
      </div>
    </main>
  );
}
