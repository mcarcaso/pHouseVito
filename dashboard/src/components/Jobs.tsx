import React, { useState, useEffect } from "react";

interface CronJob {
  name: string;
  schedule: string;
  timezone?: string;
  session: string;
  prompt: string;
  oneTime?: boolean;
}

export default function Jobs() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<CronJob>({
    name: "",
    schedule: "",
    timezone: "America/New_York",
    session: "dashboard:default",
    prompt: "",
    oneTime: false,
  });

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    const res = await fetch("/api/cron/jobs");
    const data = await res.json();
    setJobs(data);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/cron/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });

    if (res.ok) {
      await fetchJobs();
      setShowForm(false);
      setFormData({
        name: "",
        schedule: "",
        timezone: "America/New_York",
        session: "dashboard:default",
        prompt: "",
        oneTime: false,
      });
    } else {
      const error = await res.json();
      alert(`Error: ${error.error}`);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete job "${name}"?`)) return;
    const res = await fetch(`/api/cron/jobs/${name}`, { method: "DELETE" });
    if (res.ok) await fetchJobs();
  };

  return (
    <div className="flex flex-col pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white">Jobs ({jobs.length})</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="ml-auto px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md transition-colors shrink-0"
        >
          {showForm ? "Cancel" : "+ New"}
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Create Form */}
        {showForm && (
          <form
            className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-4"
            onSubmit={handleSubmit}
          >
            {/* Row 1: Name + Schedule */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-neutral-500 font-medium">Job Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="morning-briefing"
                  required
                  className="px-3 py-2 bg-neutral-950 border border-neutral-700 rounded-md text-neutral-200 text-sm sm:text-base focus:outline-none focus:border-blue-600 transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-neutral-500 font-medium">Cron Schedule</label>
                <input
                  type="text"
                  value={formData.schedule}
                  onChange={(e) => setFormData({ ...formData, schedule: e.target.value })}
                  placeholder="0 9 * * *"
                  required
                  className="px-3 py-2 bg-neutral-950 border border-neutral-700 rounded-md text-neutral-200 text-sm sm:text-base focus:outline-none focus:border-blue-600 transition-colors"
                />
                <span className="text-xs text-neutral-600">minute hour day month weekday</span>
              </div>
            </div>

            {/* Row 2: Timezone + Session */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-neutral-500 font-medium">Timezone</label>
                <input
                  type="text"
                  value={formData.timezone}
                  onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                  placeholder="America/New_York"
                  className="px-3 py-2 bg-neutral-950 border border-neutral-700 rounded-md text-neutral-200 text-sm sm:text-base focus:outline-none focus:border-blue-600 transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-neutral-500 font-medium">Session</label>
                <input
                  type="text"
                  value={formData.session}
                  onChange={(e) => setFormData({ ...formData, session: e.target.value })}
                  placeholder="dashboard:default"
                  required
                  className="px-3 py-2 bg-neutral-950 border border-neutral-700 rounded-md text-neutral-200 text-sm sm:text-base focus:outline-none focus:border-blue-600 transition-colors"
                />
              </div>
            </div>

            {/* Prompt */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-neutral-500 font-medium">Prompt</label>
              <textarea
                value={formData.prompt}
                onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                placeholder="What should the AI do?"
                rows={3}
                required
                className="px-3 py-2 bg-neutral-950 border border-neutral-700 rounded-md text-neutral-200 text-sm sm:text-base font-mono focus:outline-none focus:border-blue-600 transition-colors resize-y"
              />
            </div>

            {/* One-time checkbox */}
            <label className="flex items-center gap-2 cursor-pointer text-sm text-neutral-200">
              <input
                type="checkbox"
                checked={formData.oneTime || false}
                onChange={(e) => setFormData({ ...formData, oneTime: e.target.checked })}
                className="cursor-pointer"
              />
              One-time job (auto-delete after running)
            </label>

            <button
              type="submit"
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors"
            >
              Create Job
            </button>
          </form>
        )}

        {/* Jobs List */}
        {jobs.length === 0 ? (
          <div className="text-center py-12 text-neutral-500">
            No scheduled jobs yet
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <div
                key={job.name}
                className={`bg-neutral-900 border rounded-xl p-4 transition-colors ${
                  job.oneTime
                    ? "border-violet-500/30 hover:border-violet-500/50"
                    : "border-neutral-800 hover:border-neutral-700"
                }`}
              >
                {/* Job Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 pb-3 border-b border-neutral-800">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-blue-500 font-medium truncate">{job.name}</h3>
                    {job.oneTime && (
                      <span className="shrink-0 px-2 py-0.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-[10px] font-semibold rounded tracking-wide uppercase">
                        One-time
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(job.name)}
                    className="w-full sm:w-auto px-3 py-1.5 text-red-500 border border-red-900/50 hover:bg-red-950/50 hover:border-red-600 rounded text-sm transition-colors"
                  >
                    Delete
                  </button>
                </div>

                {/* Job Details - Desktop: grid, Mobile: stack */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] text-neutral-500 font-medium uppercase tracking-wide">Schedule</span>
                    <span className="text-sm text-neutral-300 font-mono">{job.schedule}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] text-neutral-500 font-medium uppercase tracking-wide">Timezone</span>
                    <span className="text-sm text-neutral-300">{job.timezone || "America/New_York"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] text-neutral-500 font-medium uppercase tracking-wide">Session</span>
                    <span className="text-sm text-neutral-300 truncate">{job.session}</span>
                  </div>
                </div>

                {/* Prompt */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-neutral-500 font-medium uppercase tracking-wide">Prompt</span>
                  <pre className="bg-neutral-950 p-3 rounded-md text-sm text-neutral-300 font-mono whitespace-pre-wrap break-words">
                    {job.prompt}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
