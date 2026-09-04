/* ------------------------------------------------------------------ */
/*  Shared look and status logic, ported from the macOS app.           */
/*                                                                      */
/*  Keep this file in step with src/App.jsx in ~/Desktop/kastelu:       */
/*  the palette, the status labels and the thresholds must match, or    */
/*  the two apps will describe the same plant differently on the same   */
/*  day. Anything here is display-only — the PWA logs waterings and     */
/*  feedings, everything else is edited on the Mac.                     */
/* ------------------------------------------------------------------ */

export const C = {
  bg: "#EDF1EA",
  card: "#FFFFFF",
  ink: "#22301F",
  pine: "#2E5339",
  water: "#2F7FA6",
  waterPale: "#DCEDF4",
  feed: "#7A6A2F",
  feedPale: "#F0EBD7",
  track: "#E4E9E0",
  rust: "#A6482A",
  rustPale: "#F4E3DC",
  muted: "#78826E",
  line: "#DDE3D8",
};

export const FONT_DISPLAY = "'Fraunces', Georgia, 'Times New Roman', serif";
export const FONT_BODY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const CARE_GROUPS = [
  { key: "humidity", label: "Humidity 60%+", color: C.water },
  { key: "fluoride-sensitive", label: "Fluoride-sensitive", color: C.feed },
  { key: "spider-mite-watch", label: "Spider mite watch", color: C.rust },
  { key: "acid-loving", label: "Acid-loving", color: C.pine },
];

const OBSERVATION_CATEGORIES = [
  { key: "pest", label: "Pest sighting", emoji: "🐛" },
  { key: "leaf_drop", label: "Leaf drop", emoji: "🍂" },
  { key: "new_growth", label: "New growth", emoji: "🌱" },
  { key: "flowering", label: "Flowering", emoji: "🌸" },
  { key: "dormancy_sign", label: "Dormancy sign", emoji: "💤" },
  { key: "damage", label: "Damage", emoji: "⚠️" },
  { key: "repot_needed", label: "Needs repotting", emoji: "🪴" },
  { key: "other", label: "Other", emoji: "📋" },
];

// Labels only — the Mac app owns the multipliers and bakes them into the
// exported effective interval, so the PWA never recomputes them.
const CONDITION_LABELS = {
  potSize: { small: "Small", medium: "Medium", large: "Large" },
  potMaterial: { terracotta: "Terracotta", plastic: "Plastic / glazed ceramic" },
  medium: {
    soil: "Standard potting soil",
    bark: "Orchid bark / chunky mix",
    succulent: "Succulent / sandy mix",
    retentive: "Peat-heavy / moisture-retentive",
    seramis: "Seramis / clay granules",
  },
  spot: { brightWarm: "Bright & warm", average: "Average room conditions", coolShaded: "Cool or shaded spot" },
};

/* ---------------- date helpers ------------------------------------- */

const DAY = 86400000;
const todayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const daysSince = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  d.setHours(0, 0, 0, 0);
  return Math.round((todayStart() - d.getTime()) / DAY);
};

export const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export const relDay = (iso) => {
  const n = daysSince(iso);
  if (n === 0) return "today";
  if (n === 1) return "yesterday";
  return `${n} days ago`;
};

const isWinterNow = () => {
  const m = new Date().getMonth();
  return m === 10 || m === 11 || m === 0 || m === 1;
};

/* ---------------- status logic ------------------------------------- */

// Days left, not days since — the question is "when does this need me?".
// The interval comes from the Mac app's exported effective interval, which
// already accounts for pot, medium, placement and lifecycle. Days left is
// recomputed here so it stays right as days pass and updates the moment a
// watering is logged.
export function waterStatus(p) {
  const interval = p.adjustedInterval || p.baseInterval || 7;
  const since = daysSince(p.lastWatered);
  if (since === null) return { label: "Not watered yet", tone: "due", daysLeft: 0, fill: 0, interval };
  const daysLeft = interval - since;
  const fill = Math.max(0, Math.min(1, daysLeft / interval));
  if (daysLeft < 0) return { label: `Overdue by ${-daysLeft} d`, tone: "overdue", daysLeft, fill: 0, interval };
  if (daysLeft === 0) return { label: "Water today", tone: "due", daysLeft, fill, interval };
  return { label: `Water in ${daysLeft} d`, tone: "ok", daysLeft, fill, interval };
}

export function fertStatus(p) {
  if (!p.fertInterval || p.fertInterval <= 0) return null;

  // A resting or dormant plant can have feeding paused by lifecycle overrides
  // that the export does not carry, so trust the Mac app's own verdict there.
  const lc = p.lifecycle || "active";
  if (lc !== "active" && p.feeding?.status === "paused") {
    const stateLabel = lc === "rest" ? "resting" : "dormant";
    return {
      label: p.feeding.label || `Feeding paused (${stateLabel})`,
      tone: "paused",
      due: false,
      daysLeft: Infinity,
    };
  }
  if (p.fertWinterPause && isWinterNow())
    return { label: "Feeding paused for winter", tone: "paused", due: false, daysLeft: Infinity };

  const since = daysSince(p.lastFert);
  if (since === null) return { label: "No feeds logged yet", tone: "due", due: true, daysLeft: 0 };
  const daysLeft = p.fertInterval - since;
  if (daysLeft < 0) return { label: `Feed overdue by ${-daysLeft} d`, tone: "due", due: true, daysLeft };
  if (daysLeft === 0) return { label: "Feed today", tone: "due", due: true, daysLeft: 0 };
  return { label: `Feed in ${daysLeft} d`, tone: "ok", due: false, daysLeft };
}

// Same ordering as the Mac app: overdue first, then due, then by days left.
const TONE_RANK = { overdue: 0, due: 1, ok: 2 };
export function compareByUrgency(a, b) {
  const sa = waterStatus(a);
  const sb = waterStatus(b);
  if (TONE_RANK[sa.tone] !== TONE_RANK[sb.tone]) return TONE_RANK[sa.tone] - TONE_RANK[sb.tone];
  return sa.daysLeft - sb.daysLeft;
}

export const locationGroup = (loc) => (loc || "").split(",")[0].trim() || "Unknown";

/* ---------------- derived text ------------------------------------- */

export function conditionsSummary(cond) {
  if (!cond) return "";
  return Object.keys(CONDITION_LABELS)
    .map((k) => CONDITION_LABELS[k][cond[k]])
    .filter(Boolean)
    .join(" · ");
}

export function fertRotationPreview(plant) {
  const rot = plant.fertRotation;
  if (!rot || rot.length < 2) return null;
  const idx = plant.fertRotationIndex ?? 0;
  return { next: rot[(idx + 1) % rot.length], then: rot[(idx + 2) % rot.length] };
}

// Waterings, feeds, observations and repots on one timeline, newest first.
export function buildUnifiedHistory(plant) {
  const events = [];
  for (const iso of plant.history || []) events.push({ type: "water", iso });
  for (const entry of plant.fertHistory || []) {
    const iso = typeof entry === "string" ? entry : entry.iso;
    const fert = typeof entry === "string" ? null : entry.fert;
    events.push({ type: "fert", iso, fert });
  }
  // the export carries only the last few observations, which is all a phone needs
  for (const obs of plant.recentObservations || plant.observations || [])
    events.push({ type: "observation", iso: obs.iso, category: obs.category, note: obs.note });
  if (plant.lastRepotted)
    events.push({ type: "repot", iso: plant.lastRepotted, note: plant.repotNote });
  events.sort((a, b) => new Date(b.iso) - new Date(a.iso));
  return events.slice(0, 10);
}

export function formatHistoryEntry(e) {
  if (e.type === "water") return `💧 Watered ${fmtDate(e.iso)} (${relDay(e.iso)})`;
  if (e.type === "fert") {
    const fertPart = e.fert ? ` (${e.fert})` : "";
    return `🌱 Fertilized${fertPart} ${fmtDate(e.iso)} (${relDay(e.iso)})`;
  }
  if (e.type === "observation") {
    const cat = OBSERVATION_CATEGORIES.find((c) => c.key === e.category);
    const notePart = e.note ? ` — ${e.note}` : "";
    return `${cat?.emoji || "📋"} ${cat?.label || e.category} ${fmtDate(e.iso)} (${relDay(e.iso)})${notePart}`;
  }
  if (e.type === "repot") {
    const notePart = e.note ? ` — ${e.note}` : "";
    return `🪴 Repotted ${fmtDate(e.iso)} (${relDay(e.iso)})${notePart}`;
  }
  return "";
}

/* ---------------- small UI pieces ----------------------------------- */

export function WaterGauge({ fill, tone }) {
  const pct = Math.round(fill * 100);
  const color = tone === "overdue" ? C.rust : C.water;
  const trackColor = tone === "overdue" ? C.rustPale : C.track;
  return (
    <div
      aria-label={`Water reserve ${pct}%`}
      style={{ height: 10, borderRadius: 5, background: trackColor, overflow: "hidden" }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: 5,
          background: `linear-gradient(90deg, ${color}, ${color}CC)`,
          transition: "width 500ms ease",
        }}
      />
    </div>
  );
}

export function Chip({ children, bg, fg }) {
  return (
    <span
      style={{
        background: bg,
        color: fg,
        fontSize: 12,
        fontWeight: 600,
        padding: "3px 10px",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }) {
  const [bg, fg] = {
    overdue: [C.rustPale, C.rust],
    due: [C.waterPale, C.water],
    ok: [C.track, C.pine],
  }[status.tone] || [C.track, C.pine];
  return (
    <Chip bg={bg} fg={fg}>
      {status.label}
    </Chip>
  );
}

export function GroupPills({ groups }) {
  if (!groups || groups.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
      {groups.map((g) => {
        const def = CARE_GROUPS.find((cg) => cg.key === g);
        const color = def?.color || C.muted;
        return (
          <Chip key={g} bg={color + "26"} fg={color}>
            {def?.label || g}
          </Chip>
        );
      })}
    </div>
  );
}
