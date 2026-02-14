import React, { useState, useEffect } from "react";
import "./Jobs.css";

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

    const res = await fetch(`/api/cron/jobs/${name}`, {
      method: "DELETE",
    });

    if (res.ok) {
      await fetchJobs();
    }
  };

  return (
    <div className="jobs-container">
      <div className="jobs-header">
        <h2>Scheduled Jobs</h2>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          {showForm ? "Cancel" : "+ New Job"}
        </button>
      </div>

      {showForm && (
        <form className="job-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Job Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="morning-briefing"
                required
              />
            </div>

            <div className="form-group">
              <label>Cron Schedule</label>
              <input
                type="text"
                value={formData.schedule}
                onChange={(e) =>
                  setFormData({ ...formData, schedule: e.target.value })
                }
                placeholder="0 9 * * * (9 AM daily)"
                required
              />
              <small>Format: minute hour day month weekday</small>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Timezone</label>
              <input
                type="text"
                value={formData.timezone}
                onChange={(e) =>
                  setFormData({ ...formData, timezone: e.target.value })
                }
                placeholder="America/New_York"
              />
            </div>

            <div className="form-group">
              <label>Session</label>
              <input
                type="text"
                value={formData.session}
                onChange={(e) =>
                  setFormData({ ...formData, session: e.target.value })
                }
                placeholder="dashboard:default"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Prompt</label>
            <textarea
              value={formData.prompt}
              onChange={(e) =>
                setFormData({ ...formData, prompt: e.target.value })
              }
              placeholder="What would you like the AI to do?"
              rows={3}
              required
            />
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={formData.oneTime || false}
                onChange={(e) =>
                  setFormData({ ...formData, oneTime: e.target.checked })
                }
              />
              One-time job (auto-delete after running)
            </label>
          </div>

          <button type="submit" className="btn-primary">
            Create Job
          </button>
        </form>
      )}

      <div className="jobs-list">
        {jobs.length === 0 ? (
          <div className="empty-state">
            <p>No scheduled jobs yet.</p>
            <p>Create one to run AI tasks automatically!</p>
          </div>
        ) : (
          jobs.map((job) => (
            <div key={job.name} className={`job-card ${job.oneTime ? 'one-time' : ''}`}>
              <div className="job-header">
                <div className="job-title">
                  <h3>{job.name}</h3>
                  {job.oneTime && <span className="badge-one-time">ONE-TIME</span>}
                </div>
                <button
                  onClick={() => handleDelete(job.name)}
                  className="btn-danger"
                >
                  Delete
                </button>
              </div>
              <div className="job-details">
                <div className="job-detail">
                  <strong>Schedule:</strong> {job.schedule}
                </div>
                <div className="job-detail">
                  <strong>Timezone:</strong> {job.timezone || "America/New_York"}
                </div>
                <div className="job-detail">
                  <strong>Session:</strong> {job.session}
                </div>
                <div className="job-detail">
                  <strong>Prompt:</strong>
                  <pre>{job.prompt}</pre>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
