import { getServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function isElevatedRole(role: string | null | undefined) {
  return role === "admin" || role === "mod";
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
    .from("announcements")
    .select("id, title, body, created_at, created_by")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const creatorIds = Array.from(new Set((data ?? []).map((row) => row.created_by).filter(Boolean)));
  let profiles: Record<string, string> = {};

  if (creatorIds.length > 0) {
    const { data: profileRows } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", creatorIds);

    profiles = (profileRows ?? []).reduce<Record<string, string>>((map, row) => {
      if (row.id) map[row.id] = row.display_name || "Admin";
      return map;
    }, {});
  }

  const announcements = (data ?? []).map((row) => ({
    ...row,
    author_name: row.created_by ? profiles[row.created_by] ?? "Admin" : "Admin",
  }));

  return NextResponse.json({ announcements });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const title: string | undefined = body.title;
  const message: string | undefined = body.body;

  if (!title || !message) {
    return NextResponse.json({ error: "Title and message are required" }, { status: 400 });
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

  if (profileError || !isElevatedRole(profile?.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("announcements")
    .insert({ title, body: message, created_by: user.id })
    .select("id, title, body, created_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Unable to create announcement" }, { status: 500 });
  }

  return NextResponse.json({ announcement: { ...data, author_name: "You" } });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const announcementId = url.searchParams.get("id");

  if (!announcementId) {
    return NextResponse.json({ error: "Announcement id is required" }, { status: 400 });
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

  if (profileError || !isElevatedRole(profile?.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = getServiceRoleClient();
  const { error } = await admin.from("announcements").delete().eq("id", announcementId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
