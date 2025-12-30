"use client";

import { useRequireUser } from "@/lib/auth";
import { getProfileIcon } from "@/lib/profileIcons";
import { ChevronDown, ChevronUp, ChevronsDown, ChevronsUp } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

interface PublicTeam {
  id: string;
  name: string;
}

interface LeaderboardRow {
  user_id: string;
  name: string;
  points: number;
  completed_count: number;
  icon?: string | null;
}

interface ContributionRow {
  challenge_id: string;
  challenge_title: string;
  completed_at: string | null;
  points: number;
}

const tierStyles = [
  "from-orange-500 via-amber-400 to-rose-400 text-white shadow-orange-200/60",
  "from-amber-500 via-orange-400 to-amber-300 text-white shadow-amber-200/70",
  "from-amber-200 via-orange-200 to-amber-100 text-amber-900 shadow-orange-100",
];

const laneGradients = [
  "from-orange-500 via-amber-400 to-rose-400",
  "from-amber-400 via-orange-400 to-amber-300",
  "from-amber-200 via-orange-200 to-rose-200",
  "from-rose-400 via-orange-400 to-amber-300",
  "from-amber-300 via-orange-300 to-rose-300",
  "from-yellow-300 via-amber-400 to-orange-500",
  "from-sky-300 via-blue-300 to-emerald-200",
  "from-amber-300 via-orange-400 to-pink-400",
];

const avatarSize = {
  sm: "h-9 w-9 text-base",
  md: "h-12 w-12 text-xl",
  lg: "h-14 w-14 text-2xl",
};

const ProfileCircle = ({ iconId, name, size = "md" }: { iconId?: string | null; name: string; size?: keyof typeof avatarSize }) => {
  const icon = useMemo(() => getProfileIcon(iconId), [iconId]);
  return (
    <div
      className={`flex items-center justify-center rounded-full bg-gradient-to-br ${icon.gradient} ${avatarSize[size]} shadow-inner shadow-orange-100`}
      role="img"
      aria-label={`${name}'s icon: ${icon.label}`}
    >
      <span className={icon.accent}>{icon.glyph}</span>
    </div>
  );
};

export default function LeaderboardPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [teams, setTeams] = useState<PublicTeam[]>([]);
  const [activeTeam, setActiveTeam] = useState<string | null>(null);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [contributions, setContributions] = useState<Record<string, ContributionRow[]>>({});
  const [activityOffset, setActivityOffset] = useState(0);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [positionChanges, setPositionChanges] = useState<Record<string, number>>({});
  const [focusedUser, setFocusedUser] = useState<string | null>(null);

  const activityOffsetRef = useRef(0);
  const previousRowsRef = useRef<LeaderboardRow[]>([]);

  const PAGE_SIZE = 15;

  const loadTeams = useCallback(async () => {
    try {
      const response = await fetch("/api/teams/public");
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load groups");
      }

      const normalizedTeams: PublicTeam[] = (payload.teams ?? []).map(
        (row: { id?: string; name?: string }) => ({
          id: String(row.id ?? ""),
          name: String(row.name ?? "Unnamed team"),
        }),
      );

      setTeams(normalizedTeams.filter((team) => Boolean(team.id)));
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load groups");
    }
  }, []);

  const appendContributions = useCallback(
    (
      current: Record<string, ContributionRow[]>,
      incoming: Record<string, ContributionRow[]>,
      reset: boolean,
    ) => {
      if (reset) return incoming;

      const merged: Record<string, ContributionRow[]> = { ...current };
      Object.entries(incoming).forEach(([userId, items]) => {
        merged[userId] = [...(merged[userId] ?? []), ...items];
      });
      return merged;
    },
    [],
  );

  const loadLeaderboard = useCallback(
    async (teamId: string, reset = true) => {
      setStatus(null);
      setActivityLoading(true);
      if (reset) {
        activityOffsetRef.current = 0;
        setActivityOffset(0);
        setContributions({});
        setExpandedUser(null);
        setFocusedUser(null);
      }

      const offset = reset ? 0 : activityOffsetRef.current;

      try {
        const params = new URLSearchParams({
          teamId,
          limit: `${PAGE_SIZE}`,
          offset: `${offset}`,
        });

        const response = await fetch(`/api/teams/leaderboard?${params.toString()}`);
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load leaderboard");
        }

        const returnedContributions: Record<string, ContributionRow[]> = payload.contributions ?? {};
        const contributionCount = Object.values(returnedContributions).reduce((count, list) => count + list.length, 0);

        const incomingLeaderboard: LeaderboardRow[] = payload.leaderboard ?? [];
        const previousRankings = reset
          ? new Map<string, number>()
          : new Map(previousRowsRef.current.map((row, index) => [row.user_id, index]));

        const movement: Record<string, number> = {};
        incomingLeaderboard.forEach((row, index) => {
          const previousIndex = previousRankings.get(row.user_id);
          if (previousIndex === undefined) return;
          const delta = previousIndex - index;
          if (delta !== 0) {
            movement[row.user_id] = delta;
          }
        });

        setPositionChanges(movement);
        setRows(incomingLeaderboard);
        previousRowsRef.current = incomingLeaderboard;
        setContributions((prev) => appendContributions(prev, returnedContributions, reset));
        setActivityHasMore(Boolean(payload.hasMore));
        const nextOffset = offset + contributionCount;
        activityOffsetRef.current = nextOffset;
        setActivityOffset(nextOffset);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to load leaderboard");
      } finally {
        setActivityLoading(false);
      }
    },
    [PAGE_SIZE, appendContributions],
  );

  useRequireUser((id) => setUserId(id));

  useEffect(() => {
    if (!userId) return;
    loadTeams();
  }, [userId, loadTeams]);

  useEffect(() => {
    const stored = window.localStorage.getItem("activeTeamId");
    if (stored) {
      setActiveTeam(stored);
      loadLeaderboard(stored);
    }
  }, [loadLeaderboard]);

  useEffect(() => {
    if (activeTeam && teams.length > 0) {
      const knownIds = teams.map((team) => team.id);
      if (!knownIds.includes(activeTeam)) {
        setActiveTeam(null);
      }
    }

    if (activeTeam || teams.length === 0) {
      if (teams.length === 0) {
        setStatus("Join or create a group to see the leaderboard.");
      }
      return;
    }

    const firstTeamId = teams[0]?.id;
    if (firstTeamId) {
      setActiveTeam(firstTeamId);
      window.localStorage.setItem("activeTeamId", firstTeamId);
      loadLeaderboard(firstTeamId);
    }
  }, [activeTeam, loadLeaderboard, teams]);

  const handleTeamChange = (id: string) => {
    setActiveTeam(id);
    window.localStorage.setItem("activeTeamId", id);
    loadLeaderboard(id);
  };

  const loadMoreActivity = () => {
    if (!activeTeam || activityLoading || !activityHasMore) return;
    loadLeaderboard(activeTeam, false);
  };

  const formatTimestamp = (value: string | null) => {
    if (!value) return "";
    return new Date(value).toLocaleString();
  };

  const maxPoints = useMemo(() => (rows.length > 0 ? Math.max(...rows.map((row) => row.points)) : 0), [rows]);
  const axisLimit = useMemo(() => Math.max(50, Math.ceil(Math.max(maxPoints, 1) / 50) * 50), [maxPoints]);
  const axisTicks = useMemo(
    () => Array.from({ length: Math.floor(axisLimit / 50) + 1 }, (_, idx) => idx * 50),
    [axisLimit],
  );

  const topPerformer = rows[0];

  return (
    <main className="min-h-screen bg-gradient-to-b from-orange-100 via-amber-50 to-rose-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
        <div className="flex flex-col gap-4 rounded-3xl bg-white/70 p-6 shadow-xl shadow-orange-100/60 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Leaderboard</p>
            <h1 className="text-3xl font-semibold text-slate-900">Group rankings</h1>
            <p className="mt-2 text-sm text-slate-600">
              Celebrate your squad and follow every contribution in a warm, card-first layout.
            </p>
          </div>
          <a
            className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-200 transition hover:translate-y-[-1px]"
            href="/dashboard"
          >
            Back to dashboard
          </a>
        </div>

        <div className="mt-8 space-y-4">
          <div className="rounded-3xl bg-white/80 p-4 shadow-lg shadow-orange-100/70 backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-amber-700">Choose a group</p>
                <p className="text-xs text-slate-500">Switch tabs to browse each leaderboard.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                {teams.map((team) => {
                  const id = team.id;
                  const name = team.name || "Unnamed team";
                  const isActive = activeTeam === id;
                  return (
                    <button
                      key={id}
                      onClick={() => handleTeamChange(id)}
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-orange-300 ${
                        isActive
                          ? "border-transparent bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-lg shadow-orange-200"
                          : "border-orange-100 bg-white/70 text-slate-700 hover:border-orange-200 hover:bg-white"
                      }`}
                      disabled={teams.length === 0}
                    >
                      {name}
                    </button>
                  );
                })}
                {teams.length === 0 && <span className="text-sm text-slate-500">No groups yet</span>}
              </div>
            </div>
            {status && <p className="mt-3 text-sm text-rose-500">{status}</p>}
          </div>

          {activeTeam ? (
            <div className="grid gap-6 lg:grid-cols-5">
              <div className="rounded-3xl bg-gradient-to-b from-orange-400 via-amber-300 to-rose-200 p-6 text-slate-900 shadow-xl shadow-orange-200/70 lg:col-span-2">
                <div className="rounded-2xl bg-white/30 p-4 shadow-inner shadow-amber-200/40 backdrop-blur">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-900/80">Current leader</p>
                  <div className="mt-3 flex items-center gap-3">
                    <ProfileCircle iconId={topPerformer?.icon} name={topPerformer?.name ?? "Current leader"} size="md" />
                    <div>
                      <p className="text-lg font-semibold">{topPerformer?.name ?? "No scores yet"}</p>
                      <p className="text-sm text-amber-900/80">
                        {topPerformer
                          ? `${topPerformer.points} pts • ${topPerformer.completed_count} completed`
                          : "Complete a challenge to appear here."}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-white/40 p-4 backdrop-blur">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-900/70">Participants</p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{rows.length}</p>
                    <p className="text-xs text-amber-900/80">Active group members logged.</p>
                  </div>
                  <div className="rounded-2xl bg-white/40 p-4 backdrop-blur">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-900/70">Submissions</p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{activityOffset}</p>
                    <p className="text-xs text-amber-900/80">Loaded contributions so far.</p>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-3 space-y-4">
                <div className="rounded-3xl border border-orange-100 bg-white/80 p-5 shadow-lg shadow-orange-100/70 backdrop-blur">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-orange-600">Race view</p>
                      <h3 className="text-xl font-semibold text-slate-900">Horse race tracker</h3>
                      <p className="text-sm text-slate-600">Follow every athlete’s pace with icons on the track.</p>
                    </div>
                    <p className="text-xs text-slate-500">Click an icon to spotlight their lane.</p>
                  </div>

                  <div className="mt-4 space-y-3">
                    {rows.map((row, idx) => {
                      const gradient = laneGradients[idx % laneGradients.length];
                      const fill = Math.min(100, (row.points / axisLimit) * 100);
                      const isFocused = focusedUser === row.user_id;
                      return (
                        <div
                          key={row.user_id}
                          className={`rounded-2xl border border-orange-100/70 bg-white/80 p-3 transition ${
                            isFocused ? "ring-2 ring-orange-300 shadow-lg shadow-orange-100" : "shadow-sm shadow-orange-50"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => setFocusedUser(isFocused ? null : row.user_id)}
                              className="transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-orange-300"
                            >
                              <ProfileCircle iconId={row.icon} name={row.name} size="md" />
                            </button>
                            <div className="flex-1 space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold text-slate-900">{row.name}</p>
                                  {isFocused && (
                                    <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700">
                                      Spotlighted
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm font-semibold text-orange-700">{row.points} pts</p>
                              </div>
                              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className={`h-full rounded-full bg-gradient-to-r ${gradient}`}
                                  style={{ width: `${fill}%` }}
                                />
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-slate-500">
                                <span>{row.completed_count} completions</span>
                                <span>{Math.round(fill)}% of {axisLimit} pt lane</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {rows.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-orange-200 bg-white/70 p-6 text-center text-sm text-slate-500">
                        No racers yet. Complete a challenge to join the track.
                      </div>
                    )}
                  </div>

                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                      <span>Start</span>
                      <span>{axisLimit} pts</span>
                    </div>
                    <div className="relative h-10 rounded-xl bg-gradient-to-r from-white via-orange-50 to-white">
                      <div className="absolute inset-x-4 top-1/2 flex -translate-y-1/2 justify-between">
                        {axisTicks.map((tick) => (
                          <div key={tick} className="flex flex-col items-center gap-1 text-[11px] text-slate-500">
                            <span className="h-4 w-px bg-orange-200" />
                            <span>{tick}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {rows.map((row, idx) => {
                    const isExpanded = expandedUser === row.user_id;
                    const memberContributions = contributions[row.user_id] ?? [];
                    const rankStyle = tierStyles[idx] ?? "from-white via-amber-50 to-orange-50 text-slate-900";
                    const change = positionChanges[row.user_id];

                    return (
                      <Fragment key={row.user_id}>
                        <div
                          className={`relative overflow-hidden rounded-2xl border border-orange-100 bg-white/80 p-4 shadow-sm shadow-orange-100 transition hover:-translate-y-0.5 hover:shadow-lg ${
                            isExpanded ? "ring-2 ring-orange-200" : ""
                          }`}
                        >
                          <div className="flex items-center gap-4">
                            <div className={`flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br ${rankStyle} text-base font-bold shadow`}
                            >
                              #{idx + 1}
                            </div>
                            <ProfileCircle iconId={row.icon} name={row.name} size="md" />
                            <div className="flex-1">
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <p className="text-base font-semibold text-slate-900">{row.name}</p>
                                  <p className="text-xs text-slate-500">{row.completed_count} completions</p>
                                </div>
                                <div className="text-right">
                                  <p className="flex items-center justify-end gap-2 text-lg font-bold text-amber-700">
                                    {row.points} pts
                                    {change && (
                                      <span
                                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
                                          change > 0
                                            ? "border-green-100 bg-green-50 text-green-700"
                                            : "border-rose-100 bg-rose-50 text-rose-700"
                                        }`}
                                      >
                                        {Math.abs(change) === 1 ? (
                                          change > 0 ? (
                                            <ChevronUp className="h-4 w-4" aria-hidden />
                                          ) : (
                                            <ChevronDown className="h-4 w-4" aria-hidden />
                                          )
                                        ) : change > 0 ? (
                                          <ChevronsUp className="h-4 w-4" aria-hidden />
                                        ) : (
                                          <ChevronsDown className="h-4 w-4" aria-hidden />
                                        )}
                                        <span className="sr-only">
                                          {change > 0
                                            ? `Moved up ${Math.abs(change)} position${Math.abs(change) > 1 ? "s" : ""}`
                                            : `Moved down ${Math.abs(change)} position${Math.abs(change) > 1 ? "s" : ""}`}
                                        </span>
                                      </span>
                                    )}
                                  </p>
                                  <button
                                    onClick={() => setExpandedUser(isExpanded ? null : row.user_id)}
                                    className="text-xs font-semibold text-orange-600 underline underline-offset-4 transition hover:text-orange-700"
                                  >
                                    {isExpanded ? "Hide" : "View"} contributions
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="-mt-2 mb-3 overflow-hidden rounded-2xl border border-orange-100 bg-white/70 px-4 py-3 text-sm shadow-inner shadow-orange-100">
                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Recent contributions</p>
                            {memberContributions.length === 0 && (
                              <p className="mt-2 text-xs text-slate-500">No submissions loaded yet.</p>
                            )}
                            <ul className="mt-2 space-y-2">
                              {memberContributions.map((entry) => (
                                <li
                                  key={`${row.user_id}-${entry.challenge_id}-${entry.completed_at}`}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-orange-100 bg-white/90 px-3 py-2 text-xs"
                                >
                                  <div className="flex flex-col">
                                    <span className="font-semibold text-slate-800">{entry.challenge_title}</span>
                                    <span className="text-amber-700">{entry.points} pts</span>
                                  </div>
                                  <span className="text-[11px] text-slate-500">{formatTimestamp(entry.completed_at)}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </Fragment>
                    );
                  })}
                  {rows.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-orange-200 bg-white/70 p-6 text-center text-sm text-slate-500">
                      No data yet for this group.
                    </div>
                  )}
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    disabled={!activityHasMore || activityLoading}
                    onClick={loadMoreActivity}
                    className={`inline-flex items-center justify-center rounded-full px-5 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-orange-300 ${
                      activityHasMore
                        ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-orange-200 hover:translate-y-[-1px]"
                        : "cursor-not-allowed border border-orange-100 bg-white/70 text-slate-400"
                    }`}
                  >
                    {activityLoading ? "Loading..." : activityHasMore ? "Load more activity" : "No more activity"}
                  </button>
                  <p className="text-xs text-slate-500">Loaded {activityOffset} submissions</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-orange-200 bg-white/80 p-8 text-center text-sm text-slate-600 shadow-inner shadow-orange-100">
              Join or create a group to see the leaderboard.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
