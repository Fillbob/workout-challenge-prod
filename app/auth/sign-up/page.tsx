import { SignUpForm } from "@/components/sign-up-form";
import { fetchAuthPageMessage } from "@/lib/auth-page-message";

export default async function Page() {
  const authMessage = await fetchAuthPageMessage();

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-black px-6 py-12 text-white">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-3 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-300">Workout Challenge</p>
          <h1 className="text-3xl font-semibold text-white">Create your account</h1>
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100 shadow-inner">
            {authMessage}
          </div>
        </div>

        <div className="rounded-2xl bg-white/5 p-6 shadow-2xl shadow-amber-950/30 backdrop-blur">
          <SignUpForm />
        </div>
      </div>
    </div>
  );
}
