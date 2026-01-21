import { getServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EDIT_GRACE_PERIOD_DAYS = 0;

function isDateOnly(value: string | null) {
  return Boolean(value && DATE_ONLY_PATTERN.test(value));
}

function parseDateSafe(value: string | null): Date | null {
  if (!value) return null;

  if (isDateOnly(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function getLockDate(endDate: string | null) {
  const endDateValue = parseDateSafe(endDate);
  if (!endDateValue) return null;
  if (isDateOnly(endDate)) {
    return endOfDay(addDays(endDateValue, EDIT_GRACE_PERIOD_DAYS));
  }
  return addDays(endDateValue, EDIT_GRACE_PERIOD_DAYS);
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("late_completion_requests")
    .select(
      "id, challenge_id, status, requested_at, resolved_at, challenges(title, week_index, challenge_index, end_date)",
    )
    .eq("user_id", user.id)
    .order("requested_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ requests: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { challengeId?: string };
  const challengeId = body.challengeId?.trim();

  if (!challengeId) {
    return NextResponse.json({ error: "Challenge id is required" }, { status: 400 });
  }

  const admin = getServiceRoleClient();

  const { data: challenge, error: challengeError } = await admin
    .from("challenges")
    .select("id, end_date")
    .eq("id", challengeId)
    .single();

  if (challengeError || !challenge) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  }

  const lockDate = getLockDate(challenge.end_date ?? null);
  if (!lockDate || new Date() <= lockDate) {
    return NextResponse.json({ error: "Challenge is still open" }, { status: 400 });
  }

  const { data: existingSubmission, error: submissionError } = await admin
    .from("submissions")
    .select("completed")
    .eq("user_id", user.id)
    .eq("challenge_id", challengeId)
    .maybeSingle();

  if (submissionError) {
    return NextResponse.json({ error: submissionError.message }, { status: 400 });
  }

  if (existingSubmission?.completed) {
    return NextResponse.json({ error: "Challenge already completed" }, { status: 409 });
  }

  const { data: existingRequest, error: requestError } = await admin
    .from("late_completion_requests")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("challenge_id", challengeId)
    .maybeSingle();

  if (requestError) {
    return NextResponse.json({ error: requestError.message }, { status: 400 });
  }

  if (existingRequest) {
    return NextResponse.json({ error: "Request already submitted" }, { status: 409 });
  }

  const { data, error } = await admin
    .from("late_completion_requests")
    .insert({ user_id: user.id, challenge_id: challengeId, status: "pending" })
    .select("id, challenge_id, status, requested_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ request: data });
}
