import { getServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { generateJoinCode } from "@/lib/joinCodes";
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

  const admin = getServiceRoleClient();

  let teamResult: { id: string; name: string; join_code: string } | null = null;
  let teamError: PostgrestError | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const joinCode = generateJoinCode();

    const { data, error } = await admin
      .from("teams")
      .insert({ name: teamName, join_code: joinCode })
      .select("id, name, join_code")
      .single();

    if (!error && data) {
      teamResult = data;
      break;
    }

    teamError = error;

    if (error?.code !== "23505") {
      break;
    }
  }

  if (!teamResult) {
    const status = teamError?.code === "23505" ? 409 : 500;
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
