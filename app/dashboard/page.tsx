"use client";

import { useRequireUser } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useCallback, useEffect, useMemo, useState } from "react";

interface Challenge {
  id: string;
  week_index: number;
  challenge_index: number;
  title: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  base_points: number;
  team_ids: string[] | null;
}

interface Submission {
  id?: string;
  challenge_id: string;
  user_id: string;
  completed: boolean;
  completed_at: string | null;
}

interface RecentSubmission {
  id: string;
  user_id: string;
  challenge_id: string;
  challenge_title: string;
  completed_at: string | null;
  name: string;
}

interface TeamRow {
  team_id: string;
  team: {
    id: string;
    name: string;
    join_code: string;
  } | null;
}

interface LocalTeam {
  id: string;
  name: string;
  join_code: string;
  owner_id: string;
  members: string[];
}

interface WeeklyPoints {
  week: number;
  points: number;
}

interface ChallengeClosingInfo {
  isEditable: boolean;
  closingLabel: string;
  lockDateLabel: string | null;
  daysUntilClose: number | null;
}

const MILLISECONDS_IN_DAY = 1000 * 60 * 60 * 24;
const EDIT_GRACE_PERIOD_DAYS = 2;

function parseDateSafe(value: string | null): Date | null {
  if (!value) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getChallengeClosingInfo(challenge: Challenge, now = new Date()): ChallengeClosingInfo {
  const endDate = parseDateSafe(challenge.end_date);

  if (!endDate) {
    return {
      isEditable: true,
      closingLabel: "Closing date not set",
      lockDateLabel: null,
      daysUntilClose: null,
    };
  }

  const lockDate = addDays(endDate, EDIT_GRACE_PERIOD_DAYS);
  const timeRemaining = lockDate.getTime() - now.getTime();
  const daysUntilClose = Math.max(0, Math.ceil(timeRemaining / MILLISECONDS_IN_DAY));

  return {
    isEditable: timeRemaining >= 0,
    closingLabel: timeRemaining >= 0 ? `Closing in ${daysUntilClose} day${daysUntilClose === 1 ? "" : "s"}` : "Closed",
    lockDateLabel: lockDate.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    daysUntilClose,
  };
}

const LOCAL_TEAM_STORAGE_KEY = "localTeams";

function readLocalTeams() {
  if (typeof window === "undefined") return [] as LocalTeam[];
  const raw = window.localStorage.getItem(LOCAL_TEAM_STORAGE_KEY);
  if (!raw) return [] as LocalTeam[];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as LocalTeam[];

    return parsed
      .map((team) => ({
        id: String(team.id ?? ""),
        name: String(team.name ?? ""),
        join_code: String(team.join_code ?? ""),
        owner_id: String(team.owner_id ?? ""),
        members: Array.isArray(team.members) ? team.members.map(String) : [],
      }))
      .filter((team) => team.id && team.name && team.join_code && team.owner_id);
  } catch (error) {
    console.error("Unable to read local teams", error);
    return [] as LocalTeam[];
  }
}

function writeLocalTeams(teams: LocalTeam[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_TEAM_STORAGE_KEY, JSON.stringify(teams));
}

function addLocalMembership(team: LocalTeam, userId: string) {
  if (team.members.includes(userId)) return team;
  return { ...team, members: [...team.members, userId] };
}

function removeLocalMembership(teamId: string, userId: string) {
  const teams = readLocalTeams();
  const updated = teams
    .map((team) =>
      team.id === teamId
        ? { ...team, members: team.members.filter((member: string) => member !== userId) }
        : team,
    )
    .filter((team) => team.members.length > 0);

  writeLocalTeams(updated);
  return updated;
}

function localTeamsForUser(userId: string | null) {
  if (!userId) return [] as TeamRow[];
  return readLocalTeams()
    .filter((team) => team.members.includes(userId))
    .map((team) => ({
      team_id: team.id,
      team: { id: team.id, name: team.name, join_code: team.join_code },
    }));
}

function mergeTeams(primary: TeamRow[], extras: TeamRow[]) {
  const seen = new Set(primary.map((team) => team.team?.id ?? team.team_id));
  const merged = [...primary];

  extras.forEach((team) => {
    const identifier = team.team?.id ?? team.team_id;
    if (!identifier || seen.has(identifier)) return;
    merged.push(team);
    seen.add(identifier);
  });

  return merged;
}

function LineChart({ data }: { data: WeeklyPoints[] }) {
  if (data.length === 0) return null;

  const width = 260;
  const height = 120;
  const padding = 12;
  const maxPoints = Math.max(...data.map((entry) => entry.points));
  const xStep = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0;

  const coordinates = data.map((entry, index) => {
    const x = padding + xStep * index;
    const y =
      height - padding - (maxPoints === 0 ? 0 : (entry.points / maxPoints) * (height - padding * 2));

    return { ...entry, x, y };
  });

  const polylinePoints = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPoints = `${padding},${height - padding} ${polylinePoints} ${
    coordinates[coordinates.length - 1].x
  },${height - padding}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Points earned by week">
      <defs>
        <linearGradient id="pointsGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#818cf8" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#818cf8" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={width} height={height} fill="transparent" rx="8" />
      <polyline fill="url(#pointsGradient)" stroke="none" points={areaPoints} />
      <polyline
        points={polylinePoints}
        fill="none"
        stroke="#818cf8"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {coordinates.map((point) => (
        <g key={point.week}>
          <circle cx={point.x} cy={point.y} r={4} fill="#c7d2fe" stroke="#4f46e5" strokeWidth={1.5} />
          <text
            x={point.x}
            y={height - 2}
            textAnchor="middle"
            className="fill-slate-400"
            fontSize={10}
          >
            W{point.week}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function DashboardPage() {
  const supabase = getSupabaseClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [userIdentifier, setUserIdentifier] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileRole, setProfileRole] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [teamStatus, setTeamStatus] = useState<string | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, Submission>>({});
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  const [saveStatus, setSaveStatus] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [recentSubmissions, setRecentSubmissions] = useState<RecentSubmission[]>([]);
  const [recentStatus, setRecentStatus] = useState<string | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentHasMore, setRecentHasMore] = useState(false);
  const [recentOffset, setRecentOffset] = useState(0);

  const RECENT_PAGE_SIZE = 8;

  const handleActiveTeamChange = useCallback((teamId: string) => {
    setActiveTeamId(teamId);
    window.localStorage.setItem("activeTeamId", teamId);
  }, []);

  const clearActiveTeam = useCallback(() => {
    setActiveTeamId(null);
    window.localStorage.removeItem("activeTeamId");
  }, []);

  const initializeProfile = useCallback(
    async (id: string) => {
      setProfileStatus(null);
      const { data: authData } = await supabase.auth.getUser();
      const emailIdentifier = authData.user?.email?.split("@")[0] || authData.user?.email || null;
      setUserIdentifier(emailIdentifier);
      const fallbackName = emailIdentifier || "New athlete";

      const { data: existing, error } = await supabase
        .from("profiles")
        .select("display_name, role")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        setProfileStatus(error.message);
        return;
      }

      if (!existing) {
        const { error: insertError } = await supabase
          .from("profiles")
          .insert({ id, display_name: fallbackName, role: "user" });

        if (insertError) {
          setProfileStatus(insertError.message);
          return;
        }

        setProfileName(fallbackName);
        setProfileRole("user");
        return;
      }

      setProfileName(existing.display_name || fallbackName);
      setProfileRole(existing.role || "user");
    },
    [supabase],
  );

  const loadTeams = useCallback(async () => {
    const local = localTeamsForUser(userId);

    try {
      const response = await fetch("/api/teams/memberships");
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load teams");
      }

      const normalizedTeams: TeamRow[] = (payload.teams ?? []).map((row: { team_id: string; teams?: TeamRow["team"] }) => ({
        team_id: String(row.team_id),
        team: Array.isArray(row.teams) ? row.teams[0] : row.teams ?? null,
      }));

      setTeams(mergeTeams(local, normalizedTeams));
      setTeamStatus(null);
    } catch (error) {
      console.warn("Falling back to local teams", error);
      setTeamStatus(error instanceof Error ? error.message : "Unable to load teams");
      setTeams(local);
    }
  }, [userId]);

  const loadChallenges = useCallback(async () => {
    const { data, error } = await supabase
      .from("challenges")
      .select("*")
      .order("week_index", { ascending: true })
      .order("challenge_index", { ascending: true });
    if (error) {
      setSaveStatus({ message: error.message, tone: "error" });
      return;
    }
    const normalized = (data ?? []).map((challenge) => {
      const parsedIndex = Number(challenge.challenge_index);

      return {
        ...challenge,
        challenge_index: Number.isFinite(parsedIndex) ? parsedIndex : 1,
        team_ids: challenge.team_ids ?? [],
      };
    });
    setChallenges(normalized as Challenge[]);
  }, [supabase]);

  const loadSubmissions = useCallback(
    async (id: string) => {
      const { data, error } = await supabase
        .from("submissions")
        .select("id, challenge_id, completed, completed_at, user_id")
        .eq("user_id", id);
      if (error) {
        setSaveStatus({ message: error.message, tone: "error" });
        return;
      }
      const map: Record<string, Submission> = {};
      (data ?? []).forEach((row) => {
        map[row.challenge_id] = row;
      });
      setSubmissions(map);
    },
    [supabase],
  );

  useRequireUser((id) => {
    setUserId(id);
  });

  useEffect(() => {
    if (!userId) return;
    initializeProfile(userId);
    loadTeams();
    loadChallenges();
    loadSubmissions(userId);
    const stored = window.localStorage.getItem("activeTeamId");
    if (stored) setActiveTeamId(stored);
  }, [userId, initializeProfile, loadTeams, loadChallenges, loadSubmissions]);

  useEffect(() => {
    if (teams.length === 0) {
      clearActiveTeam();
      return;
    }
    if (activeTeamId && teams.some((team) => team.team?.id === activeTeamId)) return;

    const firstTeamId = teams[0]?.team?.id;
    if (firstTeamId) handleActiveTeamChange(firstTeamId);
  }, [teams, activeTeamId, handleActiveTeamChange, clearActiveTeam]);

  useEffect(() => {
    if (!saveStatus) return;

    const timer = window.setTimeout(() => setSaveStatus(null), 4000);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  const handleProfileSave = async () => {
    if (!userId) return;
    const trimmedName = profileName.trim();
    if (!trimmedName) {
      setProfileStatus("Name cannot be empty");
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: trimmedName })
      .eq("id", userId);
    if (error) {
      setProfileStatus(error.message);
    } else {
      setProfileStatus("Name updated");
    }
  };

  const handleJoinTeam = async () => {
    setTeamStatus(null);
    const trimmedCode = joinCode.trim();

    if (!trimmedCode) {
      setTeamStatus("Join code is required");
      return;
    }

    try {
      const response = await fetch("/api/teams/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode: trimmedCode }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to join team");
      }

      setTeamStatus("Joined team");
      setJoinCode("");
      if (result.team?.id) handleActiveTeamChange(String(result.team.id));
      loadTeams();
      return;
    } catch (error) {
      console.warn("Falling back to local join", error);
    }

    if (!userId) {
      setTeamStatus("You must be signed in to join a team");
      return;
    }

    const local = readLocalTeams();
    const target = local.find(
      (team) => team.name.toLowerCase() === trimmedCode.toLowerCase() || team.join_code.toLowerCase() === trimmedCode.toLowerCase(),
    );

    if (!target) {
      setTeamStatus("Team not found");
      return;
    }

    const updated = addLocalMembership(target, userId);
    const nextTeams = local.map((team) => (team.id === target.id ? updated : team));
    writeLocalTeams(nextTeams);
    setTeams((prev) => mergeTeams(prev, [{ team_id: updated.id, team: updated }]));
    setTeamStatus("Joined team");
    setJoinCode("");
    handleActiveTeamChange(updated.id);
  };

  const handleLeaveTeam = async (teamId: string) => {
    setTeamStatus(null);

    if (!userId) {
      setTeamStatus("You must be signed in to leave a team");
      return;
    }

    let leftServer = false;

    try {
      const response = await fetch("/api/teams/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to leave team");
      }

      leftServer = true;
    } catch (error) {
      console.warn("Falling back to local team removal", error);
    }

    removeLocalMembership(teamId, userId);
    const localMemberships = localTeamsForUser(userId);

    setTeams((prev) => {
      const filtered = prev.filter((team) => team.team?.id !== teamId && team.team_id !== teamId);
      const merged = mergeTeams(localMemberships, filtered);

      if (activeTeamId === teamId) {
        const nextTeamId = merged[0]?.team?.id;
        if (nextTeamId) {
          handleActiveTeamChange(nextTeamId);
        } else {
          clearActiveTeam();
        }
      }

      return merged;
    });

    setTeamStatus(leftServer ? "Left team" : "Left team locally");
  };

  const userTeamIds = useMemo(() => {
    return teams
      .map((team) => team.team?.id ?? team.team_id)
      .filter((id): id is string => Boolean(id));
  }, [teams]);

  const visibleChallenges = useMemo(() => {
    return challenges.filter((challenge) => {
      const allowedTeams = challenge.team_ids ?? [];
      if (allowedTeams.length === 0) return true;
      if (activeTeamId) return allowedTeams.includes(activeTeamId);
      return allowedTeams.some((teamId) => userTeamIds.includes(teamId));
    });
  }, [activeTeamId, challenges, userTeamIds]);

  const submissionState = useMemo(() => {
    const map: Record<string, boolean> = {};
    visibleChallenges.forEach((c) => {
      map[c.id] = submissions[c.id]?.completed ?? false;
    });
    return map;
  }, [submissions, visibleChallenges]);

  const totalPoints = useMemo(() => {
    return visibleChallenges.reduce((sum, challenge) => {
      return submissionState[challenge.id] ? sum + (challenge.base_points || 0) : sum;
    }, 0);
  }, [submissionState, visibleChallenges]);

  const weeklyPoints = useMemo(() => {
    const totals: Record<number, number> = {};

    visibleChallenges.forEach((challenge) => {
      if (!submissionState[challenge.id]) return;
      totals[challenge.week_index] = (totals[challenge.week_index] || 0) + (challenge.base_points || 0);
    });

    return Object.entries(totals)
      .map<WeeklyPoints>(([week, points]) => ({ week: Number(week), points }))
      .sort((a, b) => a.week - b.week);
  }, [submissionState, visibleChallenges]);

  const toggleChallenge = (challenge: Challenge, checked: boolean) => {
    const closingInfo = getChallengeClosingInfo(challenge);

    if (!closingInfo.isEditable) {
      setSaveStatus({ message: "This challenge is locked and can no longer be edited.", tone: "error" });
      return;
    }

    const id = challenge.id;

    setSubmissions((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || { challenge_id: id, user_id: userId!, completed_at: null }),
        challenge_id: id,
        user_id: userId!,
        completed: checked,
        completed_at: checked ? new Date().toISOString() : null,
      },
    }));
    setChangedIds((prev) => new Set([...Array.from(prev), id]));
  };

  const handleSaveSubmissions = async () => {
    if (!userId || changedIds.size === 0 || isSaving) return;
    setSaveStatus(null);
    setIsSaving(true);
    console.log("Saving submissions via", process.env.NEXT_PUBLIC_SUPABASE_URL);
    const now = new Date();
    const editableChallengeIds = new Set(
      challenges.filter((challenge) => getChallengeClosingInfo(challenge, now).isEditable).map((challenge) => challenge.id),
    );
    const skippedIds = Array.from(changedIds).filter((id) => !editableChallengeIds.has(id));

    const payload = Array.from(changedIds)
      .filter((id) => editableChallengeIds.has(id))
      .map((id) => ({
        challenge_id: id,
        user_id: userId,
        completed: submissions[id]?.completed ?? false,
        completed_at: submissions[id]?.completed ? submissions[id]?.completed_at : null,
      }));

    if (payload.length === 0) {
      setSaveStatus({
        message: skippedIds.length > 0 ? "Edits are locked for these challenges." : "No changes to save.",
        tone: "error",
      });
      setIsSaving(false);
      return;
    }

    try {
      const { error } = await supabase
        .from("submissions")
        .upsert(payload, { onConflict: "challenge_id,user_id" });

      if (error) {
        setSaveStatus({ message: error.message, tone: "error" });
      } else {
        const message = skippedIds.length > 0 ? "Progress saved. Locked challenges were not updated." : "Progress saved";
        setSaveStatus({ message, tone: "success" });
        setChangedIds(new Set());
        loadSubmissions(userId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save progress";
      setSaveStatus({ message, tone: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  const activeTeamName = teams.find((t) => t.team?.id === activeTeamId)?.team?.name;
  const hasChanges = changedIds.size > 0;
  const saveDisabled = !hasChanges || isSaving;

  const loadRecentActivity = useCallback(
    async (teamId: string, reset = false) => {
      setRecentStatus(null);
      setRecentLoading(true);

      const nextOffset = reset ? 0 : recentOffset;

      try {
        const response = await fetch(
          `/api/teams/recent-submissions?teamId=${teamId}&limit=${RECENT_PAGE_SIZE}&offset=${nextOffset}`,
        );
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load recent submissions");
        }

        const submissions: RecentSubmission[] = payload.submissions ?? [];
        setRecentSubmissions((prev) => (reset ? submissions : [...prev, ...submissions]));
        setRecentHasMore(Boolean(payload.hasMore));
        setRecentOffset(nextOffset + submissions.length);
      } catch (error) {
        setRecentStatus(error instanceof Error ? error.message : "Unable to load recent submissions");
      } finally {
        setRecentLoading(false);
      }
    },
    [RECENT_PAGE_SIZE, recentOffset],
  );

  useEffect(() => {
    if (!activeTeamId) return;
    loadRecentActivity(activeTeamId, true);
  }, [activeTeamId, loadRecentActivity]);

  const formatTimestamp = (value: string | null) => {
    if (!value) return "";
    return new Date(value).toLocaleString();
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-6xl mx-auto p-8 space-y-10">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm text-indigo-400">Dashboard</p>
            <h1 className="text-3xl font-semibold">
              Welcome back{profileName ? `, ${profileName}` : ""}
            </h1>
          </div>
          <button
            className="text-sm text-slate-300 underline"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/";
            }}
          >
            Sign out
          </button>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold">Display name</h2>
                <div className="flex gap-2 text-xs text-slate-300">
                  {userIdentifier && <span className="px-2 py-1 rounded bg-slate-800">ID: {userIdentifier}</span>}
                  {profileRole && <span className="px-2 py-1 rounded bg-slate-800">Access: {profileRole}</span>}
                </div>
              </div>
              {profileStatus && <span className="text-sm text-indigo-400">{profileStatus}</span>}
            </div>
            <div className="space-y-2">
              <label className="text-sm text-slate-400">Display name</label>
              <input
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              onClick={handleProfileSave}
              className="bg-indigo-500 hover:bg-indigo-600 text-white font-medium px-4 py-2 rounded-lg"
            >
              Save name
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-3">
            <p className="text-sm text-indigo-400">Points</p>
            <h2 className="text-3xl font-semibold">{totalPoints}</h2>
            <p className="text-slate-300 text-sm">Points earned from completed challenges.</p>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Points by week</span>
                {weeklyPoints.length > 0 && <span>Max: {Math.max(...weeklyPoints.map((entry) => entry.points))}</span>}
              </div>
              <div className="h-32 w-full rounded-lg bg-slate-800/70 border border-slate-700 p-3">
                {weeklyPoints.length === 0 ? (
                  <p className="text-slate-500 text-sm">Complete challenges to see your trend.</p>
                ) : (
                  <LineChart data={weeklyPoints} />
                )}
              </div>
              {weeklyPoints.length > 0 && (
                <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                  {weeklyPoints.map((entry) => (
                    <span key={entry.week} className="px-2 py-1 rounded bg-slate-800 border border-slate-700">
                      Week {entry.week}: {entry.points} pts
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Teams</h2>
            {teamStatus && <span className="text-sm text-rose-400">{teamStatus}</span>}
          </div>
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Join code"
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={handleJoinTeam}
                className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg"
              >
                Join
              </button>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-slate-400">Your teams</p>
              <div className="space-y-2">
                {teams.length === 0 && <p className="text-slate-500">No teams yet</p>}
                {teams.map((row) => {
                  if (!row.team) return null;

                  return (
                    <div
                      key={row.team.id}
                      className={`flex items-center justify-between bg-slate-800 border border-slate-700 rounded-lg p-3 ${
                        activeTeamId === row.team.id ? "ring-2 ring-indigo-500" : ""
                      }`}
                    >
                      <div>
                        <p className="font-medium">{row.team.name}</p>
                        <p className="text-xs text-slate-400">Join code: {row.team.join_code}</p>
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleActiveTeamChange(row.team!.id)}
                          className="text-sm text-indigo-400"
                        >
                          {activeTeamId === row.team.id ? "Active" : "Set active"}
                        </button>
                        <button
                          onClick={() => handleLeaveTeam(row.team!.id)}
                          className="text-sm text-rose-400"
                        >
                          Leave
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-indigo-400">Challenges</p>
              <h2 className="text-2xl font-semibold">Weekly goals</h2>
            </div>
            <button
              onClick={handleSaveSubmissions}
              disabled={saveDisabled}
              title={!hasChanges ? "No changes to save." : undefined}
              className={`px-4 py-2 rounded-lg text-white transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-indigo-500 ${
                saveDisabled
                  ? "bg-slate-700 text-slate-300 cursor-not-allowed opacity-80"
                  : "bg-indigo-500 hover:bg-indigo-600"
              }`}
            >
              {isSaving ? "Saving..." : "Save progress"}
            </button>
          </div>
          {!hasChanges && <p className="text-xs text-slate-400">No changes to save.</p>}
          {saveStatus && (
            <div
              className={`text-sm px-3 py-2 rounded-lg border w-fit ${
                saveStatus.tone === "success"
                  ? "bg-green-500/10 text-green-200 border-green-600/50"
                  : "bg-rose-500/10 text-rose-200 border-rose-600/50"
              }`}
            >
              {saveStatus.message}
            </div>
          )}
          <div className="space-y-3">
            {visibleChallenges.length === 0 && (
              <p className="text-slate-500 text-sm">
                No challenges available for your selected team yet.
              </p>
            )}
            {visibleChallenges.map((challenge) => {
              const checked = submissionState[challenge.id] || false;
              const closingInfo = getChallengeClosingInfo(challenge);
              const toggleDisabled = !closingInfo.isEditable;

              return (
                <div
                  key={challenge.id}
                  className="flex items-start gap-3 bg-slate-800 border border-slate-700 rounded-lg p-4"
                >
                  <button
                    type="button"
                    role="switch"
                    aria-checked={checked}
                    aria-label={`Mark ${challenge.title} as completed`}
                    disabled={toggleDisabled}
                    aria-disabled={toggleDisabled}
                    onClick={() => {
                      if (toggleDisabled) return;
                      toggleChallenge(challenge, !checked);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === " " || event.key === "Enter") {
                        event.preventDefault();
                        if (toggleDisabled) return;
                        toggleChallenge(challenge, !checked);
                      }
                    }}
                    className={`mt-1 inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                      checked ? "bg-indigo-500" : "bg-slate-600"
                    } ${
                      toggleDisabled ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        checked ? "translate-x-5" : "translate-x-1"
                      }`}
                    />
                  </button>
                  <div className="space-y-1">
                    <p className="text-sm text-slate-400">
                      Week {challenge.week_index} · Challenge {challenge.challenge_index}
                    </p>
                    <h3 className="text-lg font-semibold">{challenge.title}</h3>
                    <p className="text-slate-300 text-sm">{challenge.description}</p>
                    <p className="text-xs text-slate-500">
                      {challenge.start_date && `Starts ${challenge.start_date}`} · {" "}
                      {challenge.end_date && `Ends ${challenge.end_date}`} · {challenge.base_points} pts
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span
                        className={`px-2 py-1 rounded border ${
                          closingInfo.isEditable
                            ? "bg-amber-500/10 border-amber-400/30 text-amber-100"
                            : "bg-slate-700/50 border-slate-600 text-slate-300"
                        }`}
                      >
                        {closingInfo.closingLabel}
                      </span>
                      <span className="text-slate-500">
                        {closingInfo.isEditable
                          ? closingInfo.lockDateLabel
                            ? `Edits lock ${closingInfo.lockDateLabel} (${EDIT_GRACE_PERIOD_DAYS} days after end date).`
                            : `Edits lock ${EDIT_GRACE_PERIOD_DAYS} days after the end date.`
                          : "Edits are locked for this challenge."}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-indigo-400">Team activity</p>
              <h2 className="text-2xl font-semibold">Recent submissions</h2>
              <p className="text-slate-400 text-sm">Last 7 days</p>
            </div>
            {recentStatus && <span className="text-sm text-rose-400">{recentStatus}</span>}
          </div>

          {!activeTeamId && <p className="text-slate-500 text-sm">Set an active team to see recent activity.</p>}

          {activeTeamId && (
            <div className="space-y-3">
              {recentSubmissions.length === 0 && !recentLoading && (
                <p className="text-slate-500 text-sm">No submissions yet.</p>
              )}

              <ul className="space-y-2">
                {recentSubmissions.map((submission) => (
                  <li
                    key={submission.id}
                    className="flex items-start justify-between rounded-lg border border-slate-800 bg-slate-800/70 p-3"
                  >
                    <div className="space-y-1">
                      <p className="font-medium">{submission.name}</p>
                      <p className="text-sm text-slate-300">Completed {submission.challenge_title}</p>
                    </div>
                    <p className="text-xs text-slate-500">{formatTimestamp(submission.completed_at)}</p>
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-3">
                <button
                  disabled={!recentHasMore || recentLoading}
                  onClick={() => activeTeamId && loadRecentActivity(activeTeamId)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    recentHasMore
                      ? "bg-indigo-500 text-white hover:bg-indigo-600"
                      : "cursor-not-allowed bg-slate-800 text-slate-400"
                  }`}
                >
                  {recentLoading ? "Loading..." : recentHasMore ? "Load more" : "No more results"}
                </button>
                <p className="text-xs text-slate-500">Showing {recentSubmissions.length} of {recentOffset} loaded</p>
              </div>
            </div>
          )}
        </section>

        {activeTeamId && (
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
            <p className="text-sm text-slate-400">Active team</p>
            <h3 className="text-xl font-semibold">{activeTeamName}</h3>
            <p className="text-slate-400 text-sm">
              View team stats in the <a className="text-indigo-400" href="/leaderboard">leaderboard</a>.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
