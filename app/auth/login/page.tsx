import { LoginForm } from "@/components/login-form";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-black px-6 py-12 text-white">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-3 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-300">
            Workout Challenge
          </p>
          <h1 className="text-3xl font-semibold text-white">Welcome back</h1>
          <p className="text-slate-300">
            Log in to track your workouts, join your team, and climb the leaderboard.
          </p>
        </div>

        <LoginForm className="shadow-2xl" />
      </div>
    </div>
  );
}
