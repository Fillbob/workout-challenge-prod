import { getServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const teamName: string | undefined = body.teamName;

  if (!teamName) {
    return NextResponse.json({ error: "Team name is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = getServiceRoleClient();

  const { data: teamResult, error: teamError } = await admin
    .from("teams")
    .insert({ name: teamName, join_code: teamName })
    .select("id, name, join_code")
    .single();

  if (teamError || !teamResult) {
    const status = (teamError as PostgrestError | null)?.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: teamError?.message || "Unable to create team" }, { status });
  }

  const { error: memberError } = await admin
    .from("team_members")
    .insert({ team_id: teamResult.id, user_id: user.id });

  if (memberError && memberError.code !== "23505") {
    return NextResponse.json({ error: memberError.message }, { status: 400 });
  }

  return NextResponse.json({ team: teamResult });
}
