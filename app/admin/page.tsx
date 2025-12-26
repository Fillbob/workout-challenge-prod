"use client";

import { useRequireAdmin } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useCallback, useEffect, useState } from "react";

interface Challenge {
  id: string;
  week_index: number;
  title: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  base_points: number;
}

interface AdminTeam {
  id: string;
  name: string;
  join_code: string;
  member_count?: number;
}

const emptyForm: Omit<Challenge, "id"> = {
  week_index: 1,
  title: "",
  description: "",
  start_date: null,
  end_date: null,
  base_points: 10,
};

export default function AdminPage() {
  const supabase = getSupabaseClient();
  const [isAuthed, setIsAuthed] = useState(false);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [teams, setTeams] = useState<AdminTeam[]>([]);
  const [teamName, setTeamName] = useState("");
  const [teamStatus, setTeamStatus] = useState<string | null>(null);

  const loadChallenges = useCallback(async () => {
    const { data, error } = await supabase
      .from("challenges")
      .select("*")
      .order("week_index");
    if (error) {
      setStatus(error.message);
      return;
    }
    setChallenges(data ?? []);
  }, [supabase]);

  const loadTeams = useCallback(async () => {
    const { data, error } = await supabase
      .from("teams")
      .select("id, name, join_code, team_members(count)")
      .order("name", { ascending: true });

    if (error) {
      setTeamStatus(error.message);
      return;
    }

    const normalized: AdminTeam[] = (data ?? []).map((team) => ({
      id: team.id,
      name: team.name,
      join_code: team.join_code,
      member_count: Array.isArray(team.team_members) ? team.team_members[0]?.count ?? 0 : undefined,
    }));

    setTeams(normalized);
    setTeamStatus(null);
  }, [supabase]);

  useRequireAdmin(() => setIsAuthed(true));

  useEffect(() => {
    if (!isAuthed) return;
    loadChallenges();
    loadTeams();
  }, [isAuthed, loadChallenges, loadTeams]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const handleSubmit = async () => {
    setStatus(null);
    console.log("Creating/updating challenges via", process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (editingId) {
      const { error } = await supabase
        .from("challenges")
        .update(form)
        .eq("id", editingId);
      if (error) {
        setStatus(error.message);
        return;
      }
      setStatus("Challenge updated");
    } else {
      const { error } = await supabase.from("challenges").insert(form);
      if (error) {
        setStatus(error.message);
        return;
      }
      setStatus("Challenge created");
    }
    resetForm();
    loadChallenges();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("challenges").delete().eq("id", id);
    if (error) {
      setStatus(error.message);
      return;
    }
    setStatus("Challenge deleted");
    loadChallenges();
  };

  const handleCreateTeam = async () => {
    setTeamStatus(null);
    const trimmed = teamName.trim();

    if (!trimmed) {
      setTeamStatus("Team name is required");
      return;
    }

    try {
      const response = await fetch("/api/teams/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamName: trimmed }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to create team");
      }

      setTeamStatus("Team created");
      setTeamName("");
      loadTeams();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create team";
      setTeamStatus(message);
    }
  };

  const handleDeleteTeam = async (id: string) => {
    setTeamStatus(null);

    try {
      const response = await fetch("/api/teams/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: id }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to delete team");
      }

      setTeamStatus("Team deleted");
      loadTeams();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete team";
      setTeamStatus(message);
    }
  };

  const startEditing = (challenge: Challenge) => {
    setEditingId(challenge.id);
    setForm({
      week_index: challenge.week_index,
      title: challenge.title,
      description: challenge.description,
      start_date: challenge.start_date,
      end_date: challenge.end_date,
      base_points: challenge.base_points,
    });
  };

  if (!isAuthed) return null;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-4xl mx-auto p-8 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-indigo-400">Admin</p>
            <h1 className="text-3xl font-semibold">Manage challenges</h1>
          </div>
          <a className="text-sm text-indigo-400 underline" href="/dashboard">
            Back to dashboard
          </a>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-indigo-400">Teams</p>
              <h2 className="text-2xl font-semibold">Create and manage teams</h2>
            </div>
            {teamStatus && <p className="text-sm text-rose-400">{teamStatus}</p>}
          </div>
          <div className="flex flex-col gap-3 md:flex-row">
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Team name"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
            />
            <button onClick={handleCreateTeam} className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg">
              Create team
            </button>
          </div>
          <p className="text-sm text-slate-400">Join codes are shown below and can be shared with users.</p>

          <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-300">
                <tr>
                  <th className="p-3 text-left">Name</th>
                  <th className="p-3 text-left">Join code</th>
                  <th className="p-3 text-left">Members</th>
                  <th className="p-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => (
                  <tr key={team.id} className="border-t border-slate-800">
                    <td className="p-3">{team.name}</td>
                    <td className="p-3 text-slate-300">{team.join_code}</td>
                    <td className="p-3">{team.member_count ?? "-"}</td>
                    <td className="p-3">
                      <button onClick={() => handleDeleteTeam(team.id)} className="text-rose-400">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {teams.length === 0 && (
                  <tr>
                    <td className="p-3" colSpan={4}>
                      <p className="text-slate-500">No teams created yet.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <label className="space-y-2 text-sm">
              <span className="text-slate-300">Week index</span>
              <input
                type="number"
                value={form.week_index}
                onChange={(e) => setForm({ ...form, week_index: Number(e.target.value) })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-slate-300">Base points</span>
              <input
                type="number"
                value={form.base_points}
                onChange={(e) => setForm({ ...form, base_points: Number(e.target.value) })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
              />
            </label>
            <label className="space-y-2 text-sm md:col-span-2">
              <span className="text-slate-300">Title</span>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
              />
            </label>
            <label className="space-y-2 text-sm md:col-span-2">
              <span className="text-slate-300">Description</span>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
                rows={3}
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-slate-300">Start date</span>
              <input
                type="date"
                value={form.start_date ?? ""}
                onChange={(e) =>
                  setForm({ ...form, start_date: e.target.value || null })
                }
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-slate-300">End date</span>
              <input
                type="date"
                value={form.end_date ?? ""}
                onChange={(e) => setForm({ ...form, end_date: e.target.value || null })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
              />
            </label>
          </div>
          {status && <p className="text-sm text-rose-400">{status}</p>}
          <div className="flex gap-3">
            <button
              onClick={handleSubmit}
              className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg"
            >
              {editingId ? "Update" : "Create"} challenge
            </button>
            {editingId && (
              <button onClick={resetForm} className="text-slate-300 underline">
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-300">
              <tr>
                <th className="p-3 text-left">Week</th>
                <th className="p-3 text-left">Title</th>
                <th className="p-3 text-left">Points</th>
                <th className="p-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {challenges.map((challenge) => (
                <tr key={challenge.id} className="border-t border-slate-800">
                  <td className="p-3">{challenge.week_index}</td>
                  <td className="p-3">{challenge.title}</td>
                  <td className="p-3">{challenge.base_points}</td>
                  <td className="p-3 flex gap-3">
                    <button
                      className="text-indigo-400"
                      onClick={() => startEditing(challenge)}
                    >
                      Edit
                    </button>
                    <button
                      className="text-rose-400"
                      onClick={() => handleDelete(challenge.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {challenges.length === 0 && (
                <tr>
                  <td className="p-3" colSpan={4}>
                    <p className="text-slate-500">No challenges created yet.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
