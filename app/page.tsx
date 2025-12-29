"use client";

import { getSupabaseClient } from "@/lib/supabaseClient";
import { getLoginUrl } from "@/lib/utils";
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
        router.replace("/leaderboard");
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
      .select("display_name, profile_icon")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!existing) {
      await supabase
        .from("profiles")
        .insert({ id: user.id, display_name: derivedName, role: "user", profile_icon: "flame" })
        .throwOnError();
      return;
    }

    const updates: Record<string, string> = {};

    if (!existing.display_name) {
      updates.display_name = derivedName;
    }

    if (!existing.profile_icon) {
      updates.profile_icon = "flame";
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from("profiles").update(updates).eq("id", user.id).throwOnError();
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
        options: {
          emailRedirectTo: getLoginUrl(),
        },
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
      router.replace("/leaderboard");
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-orange-50 via-white to-amber-50 px-6 py-16 text-slate-900">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute -left-10 top-10 h-64 w-64 rounded-full bg-amber-200 blur-3xl" />
        <div className="absolute bottom-10 right-0 h-72 w-72 rounded-full bg-orange-100 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto flex max-w-6xl items-center justify-between gap-12">
        <div className="hidden max-w-xl flex-1 flex-col gap-4 lg:flex">
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-800 shadow-sm shadow-amber-200">
            Workout Challenge
          </span>
          <h1 className="text-4xl font-semibold leading-tight text-slate-900">
            Compete. Collaborate. Grow stronger.
          </h1>
          <p className="text-lg text-slate-600">
            Log in or create an account to join teams, tackle weekly challenges, and climb the leaderboard with your crew.
          </p>
          <ul className="mt-4 space-y-2 text-slate-700">
            <li className="flex items-start gap-3">
              <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-sm font-semibold text-white">
                1
              </span>
              <span>Track weekly workouts and stay accountable.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-sm font-semibold text-white">
                2
              </span>
              <span>Earn points for your team and climb the leaderboard.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-sm font-semibold text-white">
                3
              </span>
              <span>Celebrate milestones together and keep the momentum going.</span>
            </li>
          </ul>
        </div>

        <div className="w-full max-w-xl flex-1 rounded-3xl border border-amber-100 bg-white/80 p-8 shadow-2xl shadow-amber-100 backdrop-blur">
          <div className="space-y-3 text-left lg:hidden">
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-amber-800">
              Workout Challenge
            </span>
            <h1 className="text-3xl font-semibold text-slate-900">Welcome back</h1>
            <p className="text-slate-600">
              Log in or create an account to join teams, tackle weekly challenges, and climb the leaderboard with your crew.
            </p>
          </div>

          <div className="mt-6 flex gap-2 rounded-2xl bg-amber-50 p-1 text-sm font-semibold text-amber-800 ring-1 ring-amber-100">
            <button
              className={`flex-1 rounded-xl px-4 py-3 transition ${
                mode === "login" ? "bg-white text-slate-900 shadow" : "text-amber-700"
              }`}
              onClick={() => setMode("login")}
              type="button"
              aria-pressed={mode === "login"}
            >
              Log in
            </button>
            <button
              className={`flex-1 rounded-xl px-4 py-3 transition ${
                mode === "signup" ? "bg-white text-slate-900 shadow" : "text-amber-700"
              }`}
              onClick={() => setMode("signup")}
              type="button"
              aria-pressed={mode === "signup"}
            >
              Sign up
            </button>
          </div>

          <form className="mt-6 space-y-5" onSubmit={handleAuth}>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none transition focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none transition focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
                placeholder="••••••••"
              />
            </div>
            {status && <p className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-600">{status}</p>}
            <button
              type="submit"
              className="w-full rounded-xl bg-amber-500 px-4 py-3 text-base font-semibold text-white shadow-lg shadow-amber-200 transition hover:bg-amber-600 focus:outline-none focus:ring-4 focus:ring-amber-200"
            >
              {mode === "login" ? "Continue" : "Create account"}
            </button>
          </form>

          <div className="mt-6 text-sm text-slate-600">
            Need to reset your password? {" "}
            <Link className="font-semibold text-amber-700 underline underline-offset-4" href="/auth/forgot-password">
              Reset here
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
