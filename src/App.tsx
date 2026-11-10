import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  FAILED_STATUSES,
  getPassword,
  setPassword,
  statusLabel,
  type GenerateInput,
  type Model,
  type SunoTrack,
  type TaskStatus,
} from "./api";

interface Job {
  taskId: string;
  createdAt: number;
  status: TaskStatus | "SUBMITTING";
  label: string;
  style?: string;
  tracks: SunoTrack[];
  error?: string;
}

const JOBS_KEY = "mymusic.jobs";
const POLL_MS = 5000;
const GIVE_UP_MS = 20 * 60 * 1000;

const STYLE_CHIPS = [
  "Pop", "Lo-fi hip hop", "Synthwave", "Acoustic folk", "Afrobeats", "R&B", "Trap",
  "Cinematic orchestral", "Jazz", "Reggaeton", "Indie rock", "House", "Country", "Gospel",
];

const IDEAS = [
  "An upbeat summer anthem about road trips with friends",
  "A heartfelt piano ballad about missing home",
  "A chill lo-fi track for late-night studying in the rain",
  "An energetic workout song with a big drop",
  "A dreamy synthwave song about driving through a neon city",
];

const MODELS: { id: Model; name: string; hint: string }[] = [
  { id: "V6", name: "V6", hint: "Best quality, natural vocals" },
  { id: "V6_WILD", name: "V6 Wild", hint: "Bolder, more experimental" },
  { id: "V6_MINI", name: "V6 Mini", hint: "Fast and lightweight" },
];

function loadJobs(): Job[] {
  try {
    const raw = localStorage.getItem(JOBS_KEY);
    return raw ? (JSON.parse(raw) as Job[]) : [];
  } catch {
    return [];
  }
}

function saveJobs(jobs: Job[]) {
  try {
    localStorage.setItem(JOBS_KEY, JSON.stringify(jobs.slice(0, 100)));
  } catch {
    /* ignore */
  }
}

const isDone = (s: Job["status"]) => s === "SUCCESS" || FAILED_STATUSES.includes(s as TaskStatus);

function fmtTime(sec?: number | null) {
  if (!sec || !Number.isFinite(sec)) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function trackSrc(t: SunoTrack) {
  return t.audio_url || t.stream_audio_url || t.source_stream_audio_url || "";
}

export default function App() {
  const [jobs, setJobs] = useState<Job[]>(loadJobs);
  const [credits, setCredits] = useState<number | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [keyMissing, setKeyMissing] = useState(false);
  const [playing, setPlaying] = useState<SunoTrack | null>(null);

  useEffect(() => saveJobs(jobs), [jobs]);

  const refreshCredits = useCallback(async () => {
    try {
      setCredits(await api.credits());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setNeedsPassword(true);
    }
  }, []);

  useEffect(() => {
    api
      .config()
      .then((c) => {
        setKeyMissing(!c.keyConfigured);
        if (c.passwordRequired && !getPassword()) setNeedsPassword(true);
        else if (c.keyConfigured) refreshCredits();
      })
      .catch(() => {
        /* functions unavailable (e.g. plain `vite` dev) */
      });
  }, [refreshCredits]);

  // Poll unfinished jobs.
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  useEffect(() => {
    const tick = async () => {
      const pending = jobsRef.current.filter((j) => !isDone(j.status) && j.status !== "SUBMITTING");
      for (const job of pending) {
        if (Date.now() - job.createdAt > GIVE_UP_MS) {
          setJobs((js) => js.map((j) => (j.taskId === job.taskId ? { ...j, status: "GENERATE_AUDIO_FAILED", error: "Timed out." } : j)));
          continue;
        }
        try {
          const d = await api.status(job.taskId);
          const tracks = d.response?.sunoData ?? [];
          setJobs((js) =>
            js.map((j) =>
              j.taskId === job.taskId
                ? { ...j, status: d.status, tracks: tracks.length ? tracks : j.tracks, error: d.errorMessage ?? undefined }
                : j,
            ),
          );
          if (d.status === "SUCCESS") refreshCredits();
        } catch {
          /* transient — retry next tick */
        }
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [refreshCredits]);

  const onSubmit = async (input: GenerateInput, label: string) => {
    const tempId = `tmp-${Date.now()}`;
    setJobs((js) => [{ taskId: tempId, createdAt: Date.now(), status: "SUBMITTING", label, style: input.style, tracks: [] }, ...js]);
    try {
      const { taskId } = await api.generate(input);
      setJobs((js) => js.map((j) => (j.taskId === tempId ? { ...j, taskId, status: "PENDING", createdAt: Date.now() } : j)));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setNeedsPassword(true);
      setJobs((js) =>
        js.map((j) => (j.taskId === tempId ? { ...j, status: "CREATE_TASK_FAILED", error: (e as Error).message } : j)),
      );
    }
  };

  const removeJob = (taskId: string) => setJobs((js) => js.filter((j) => j.taskId !== taskId));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={32} height={32} />
          <span>MyMusic</span>
        </div>
        <div className="credits" title="Remaining Suno API credits">
          {credits !== null ? <>⚡ {credits.toLocaleString()} credits</> : null}
        </div>
      </header>

      {keyMissing && (
        <div className="banner">
          The server has no <code>SUNO_API_KEY</code> yet. Add it in Netlify → Site configuration → Environment variables, then redeploy.
        </div>
      )}

      <main className="layout">
        <section className="panel">
          <Composer onSubmit={onSubmit} onAuthError={() => setNeedsPassword(true)} />
        </section>
        <section className="panel library">
          <h2>Your songs</h2>
          {jobs.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">🎶</div>
              <p>Your generated songs will appear here. Each request creates two variations.</p>
            </div>
          ) : (
            <ul className="jobs">
              {jobs.map((job) => (
                <JobCard key={job.taskId} job={job} playing={playing} onPlay={setPlaying} onRemove={removeJob} />
              ))}
            </ul>
          )}
        </section>
      </main>

      {playing && <PlayerBar track={playing} onClose={() => setPlaying(null)} />}

      {needsPassword && (
        <PasswordModal
          onDone={() => {
            setNeedsPassword(false);
            refreshCredits();
          }}
        />
      )}
    </div>
  );
}

function Composer({
  onSubmit,
  onAuthError,
}: {
  onSubmit: (input: GenerateInput, label: string) => Promise<void>;
  onAuthError: () => void;
}) {
  const [custom, setCustom] = useState(false);
  const [instrumental, setInstrumental] = useState(false);
  const [model, setModel] = useState<Model>("V6");
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("");
  const [title, setTitle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [negativeTags, setNegativeTags] = useState("");
  const [vocalGender, setVocalGender] = useState<"" | "m" | "f">("");
  const [useDuration, setUseDuration] = useState(false);
  const [duration, setDuration] = useState(120);
  const [styleWeight, setStyleWeight] = useState(0.5);
  const [weirdness, setWeirdness] = useState(0.5);
  const [variety, setVariety] = useState(1);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [lyricsIdea, setLyricsIdea] = useState("");
  const [lyricsBusy, setLyricsBusy] = useState(false);
  const [lyricsOptions, setLyricsOptions] = useState<{ title: string; text: string }[]>([]);

  const addStyle = (s: string) => {
    const parts = style.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.some((p) => p.toLowerCase() === s.toLowerCase())) {
      setStyle(parts.filter((p) => p.toLowerCase() !== s.toLowerCase()).join(", "));
    } else {
      setStyle([...parts, s].join(", "));
    }
  };
  const styleHas = (s: string) => style.toLowerCase().split(",").map((p) => p.trim()).includes(s.toLowerCase());

  const writeLyrics = async () => {
    const idea = (lyricsIdea || prompt || title || style).trim();
    if (!idea) {
      setError("Tell us what the lyrics should be about.");
      return;
    }
    setError("");
    setLyricsBusy(true);
    setLyricsOptions([]);
    try {
      const { taskId } = await api.lyrics(idea.slice(0, 200));
      const started = Date.now();
      while (Date.now() - started < 3 * 60 * 1000) {
        await new Promise((r) => setTimeout(r, 3000));
        const d = await api.lyricsStatus(taskId).catch(() => null);
        if (!d) continue;
        if (d.status === "SUCCESS") {
          const opts = (d.response?.data ?? []).filter((o) => o.text);
          setLyricsOptions(opts.map((o) => ({ title: o.title, text: o.text })));
          if (opts[0]) {
            setLyrics(opts[0].text);
            if (!title && opts[0].title) setTitle(opts[0].title);
          }
          return;
        }
        if (d.status !== "PENDING") throw new Error(d.errorMessage || statusLabel(d.status as TaskStatus));
      }
      throw new Error("Lyrics took too long. Please try again.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      setError((e as Error).message);
    } finally {
      setLyricsBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    let input: GenerateInput;
    let label: string;
    if (!custom) {
      if (!prompt.trim() && !style.trim()) {
        setError("Describe your song or pick a style.");
        return;
      }
      input = { customMode: false, instrumental, model, prompt, style };
      label = prompt.trim() || style.trim();
    } else {
      if (!style.trim() && !(lyrics.trim() && !instrumental) && !negativeTags.trim()) {
        setError("Add a style or some lyrics.");
        return;
      }
      input = {
        customMode: true,
        instrumental,
        model,
        style,
        title,
        lyrics: instrumental ? undefined : lyrics,
        negativeTags,
        vocalGender: vocalGender || undefined,
        duration: useDuration ? duration : undefined,
        ...(advanced ? { styleWeight, weirdnessConstraint: weirdness, variety } : {}),
      };
      label = title.trim() || style.trim() || "Untitled";
    }
    setBusy(true);
    await onSubmit(input, label);
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="composer">
      <div className="segmented" role="tablist">
        <button type="button" className={!custom ? "active" : ""} onClick={() => setCustom(false)}>
          ✨ Simple
        </button>
        <button type="button" className={custom ? "active" : ""} onClick={() => setCustom(true)}>
          🎛️ Custom
        </button>
      </div>

      {!custom ? (
        <>
          <label className="field">
            <span>Song description</span>
            <textarea
              rows={4}
              maxLength={3000}
              placeholder="e.g. An upbeat summer anthem about road trips with friends"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>
          <div className="ideas">
            {IDEAS.map((i) => (
              <button type="button" key={i} className="idea" onClick={() => setPrompt(i)}>
                {i}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <label className="field">
            <span>Title</span>
            <input maxLength={80} placeholder="Name your song" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {!instrumental && (
            <div className="field">
              <span className="row-between">
                Lyrics
                <small>{lyrics.length}/5000</small>
              </span>
              <textarea
                rows={9}
                maxLength={5000}
                placeholder={"[Verse]\nWrite your own lyrics here…\n\n[Chorus]\n…"}
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
              />
              <div className="ai-lyrics">
                <input
                  maxLength={200}
                  placeholder="Or let AI write them — what's the song about?"
                  value={lyricsIdea}
                  onChange={(e) => setLyricsIdea(e.target.value)}
                />
                <button type="button" className="btn-secondary" onClick={writeLyrics} disabled={lyricsBusy}>
                  {lyricsBusy ? <span className="spinner" /> : "✍️"} {lyricsBusy ? "Writing…" : "Write lyrics"}
                </button>
              </div>
              {lyricsOptions.length > 1 && (
                <div className="lyric-options">
                  {lyricsOptions.map((o, i) => (
                    <button
                      type="button"
                      key={i}
                      className={`chip ${lyrics === o.text ? "on" : ""}`}
                      onClick={() => {
                        setLyrics(o.text);
                        if (o.title) setTitle(o.title);
                      }}
                    >
                      Option {i + 1}{o.title ? `: ${o.title}` : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="field">
        <span>Style of music</span>
        <input
          maxLength={1000}
          placeholder="e.g. dreamy synthwave, female vocals, 110 bpm"
          value={style}
          onChange={(e) => setStyle(e.target.value)}
        />
        <div className="chips">
          {STYLE_CHIPS.map((s) => (
            <button type="button" key={s} className={`chip ${styleHas(s) ? "on" : ""}`} onClick={() => addStyle(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {custom && (
        <>
          <label className="field">
            <span>Exclude styles (optional)</span>
            <input
              maxLength={1000}
              placeholder="e.g. heavy metal, screaming"
              value={negativeTags}
              onChange={(e) => setNegativeTags(e.target.value)}
            />
          </label>

          <div className="grid-2">
            {!instrumental && (
              <label className="field">
                <span>Vocals</span>
                <select value={vocalGender} onChange={(e) => setVocalGender(e.target.value as "" | "m" | "f")}>
                  <option value="">Any</option>
                  <option value="f">Female</option>
                  <option value="m">Male</option>
                </select>
              </label>
            )}
            <div className="field">
              <span className="row-between">
                <label className="inline">
                  <input type="checkbox" checked={useDuration} onChange={(e) => setUseDuration(e.target.checked)} /> Length
                </label>
                <small>{useDuration ? fmtTime(duration) : "auto"}</small>
              </span>
              <input
                type="range"
                min={10}
                max={360}
                step={5}
                value={duration}
                disabled={!useDuration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </div>
          </div>

          <button type="button" className="link" onClick={() => setAdvanced((a) => !a)}>
            {advanced ? "▾" : "▸"} Advanced controls
          </button>
          {advanced && (
            <div className="advanced">
              <Slider label="Style adherence" value={styleWeight} onChange={setStyleWeight} />
              <Slider label="Weirdness" value={weirdness} onChange={setWeirdness} />
              <div className="field">
                <span className="row-between">
                  Variety <small>{["Off", "Normal", "High", "Extra", "Max"][variety]}</small>
                </span>
                <input type="range" min={0} max={4} step={1} value={variety} onChange={(e) => setVariety(Number(e.target.value))} />
              </div>
            </div>
          )}
        </>
      )}

      <div className="row-between options">
        <label className="toggle">
          <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} />
          <span className="track" />
          Instrumental
        </label>
        <select value={model} onChange={(e) => setModel(e.target.value as Model)} title="Model">
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} — {m.hint}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error">{error}</div>}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? <span className="spinner" /> : "🎵"} Create song
      </button>
    </form>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <span className="row-between">
        {label} <small>{Math.round(value * 100)}%</small>
      </span>
      <input type="range" min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function JobCard({
  job,
  playing,
  onPlay,
  onRemove,
}: {
  job: Job;
  playing: SunoTrack | null;
  onPlay: (t: SunoTrack) => void;
  onRemove: (taskId: string) => void;
}) {
  const failed = FAILED_STATUSES.includes(job.status as TaskStatus);
  const working = !isDone(job.status);
  const placeholders = working ? Math.max(0, 2 - job.tracks.length) : 0;

  return (
    <li className="job">
      <div className="job-head">
        <div className="job-title" title={job.label}>
          {job.label}
        </div>
        <div className={`status ${failed ? "bad" : working ? "busy" : "ok"}`}>
          {working && <span className="spinner small" />}
          {statusLabel(job.status)}
        </div>
        <button className="icon-btn" title="Remove" onClick={() => onRemove(job.taskId)}>
          ✕
        </button>
      </div>
      {failed && job.error && <div className="error small">{job.error}</div>}
      <div className="tracks">
        {job.tracks.map((t) => {
          const src = trackSrc(t);
          const isPlaying = playing?.id === t.id;
          return (
            <div key={t.id} className={`track-card ${isPlaying ? "playing" : ""}`}>
              <button className="cover" disabled={!src} onClick={() => onPlay(t)} title={src ? "Play" : "Not ready"}>
                {t.image_url || t.source_image_url ? (
                  <img src={t.image_url || t.source_image_url} alt="" loading="lazy" />
                ) : (
                  <div className="cover-fallback">♪</div>
                )}
                {src && <span className="play-badge">{isPlaying ? "❚❚" : "▶"}</span>}
              </button>
              <div className="track-meta">
                <div className="track-name">{t.title || job.label}</div>
                <div className="track-tags">{t.tags || job.style}</div>
                <div className="track-foot">
                  <span>{t.audio_url ? fmtTime(t.duration) : src ? "Streaming preview" : "Rendering…"}</span>
                  {t.audio_url && (
                    <a className="dl" href={t.audio_url} target="_blank" rel="noreferrer" download>
                      ⬇ MP3
                    </a>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {Array.from({ length: placeholders }).map((_, i) => (
          <div key={`ph-${i}`} className="track-card skeleton">
            <div className="cover shimmer" />
            <div className="track-meta">
              <div className="line shimmer" />
              <div className="line short shimmer" />
            </div>
          </div>
        ))}
      </div>
      {job.tracks.some((t) => t.prompt) && !working && (
        <details className="lyrics-view">
          <summary>Lyrics</summary>
          <pre>{job.tracks.find((t) => t.prompt)?.prompt}</pre>
        </details>
      )}
    </li>
  );
}

function PlayerBar({ track, onClose }: { track: SunoTrack; onClose: () => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  const src = trackSrc(track);
  useEffect(() => {
    ref.current?.play().catch(() => {});
  }, [src]);
  return (
    <div className="player">
      {(track.image_url || track.source_image_url) && <img src={track.image_url || track.source_image_url} alt="" />}
      <div className="player-meta">
        <div className="track-name">{track.title || "Untitled"}</div>
        <div className="track-tags">{track.tags}</div>
      </div>
      <audio ref={ref} src={src} controls autoPlay />
      <button className="icon-btn" onClick={onClose} title="Close player">
        ✕
      </button>
    </div>
  );
}

function PasswordModal({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState(getPassword());
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassword(pw);
    try {
      await api.credits();
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 401 ? "That password didn't work." : (e as Error).message);
    }
  };
  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <h3>🔒 Access required</h3>
        <p>This studio is private. Enter the access password to start creating.</p>
        <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" />
        {err && <div className="error small">{err}</div>}
        <button className="btn-primary" type="submit">
          Unlock
        </button>
      </form>
    </div>
  );
}
