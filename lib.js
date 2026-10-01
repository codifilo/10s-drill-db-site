export const FACETS = [
  { key: "source_id", type: "scalar" },
  { key: "format", type: "scalar" },
  { key: "players", type: "scalar" },
  { key: "serve_required", type: "bool" },
  { key: "needs_coach", type: "bool" },
  { key: "level", type: "scalar" },
  { key: "phase", type: "scalar" },
  { key: "skills", type: "list" },
  { key: "shots", type: "list" },
  { key: "sides", type: "list" },
  { key: "directions", type: "list" },
  { key: "equipment", type: "list" },
  { key: "surface", type: "list" },
  { key: "audience", type: "scalar" },
  { key: "opponent_styles", type: "list" },
];

export function emptyFilters() {
  return Object.fromEntries(FACETS.map((f) => [f.key, []]));
}

function matchesFacet(drill, facet, selected) {
  if (selected.length === 0) return true;
  const value = drill[facet.key];
  if (facet.type === "list") return value.some((v) => selected.includes(v));
  return selected.includes(String(value));
}

export function filterDrills(drills, filters) {
  return drills.filter((d) => FACETS.every((f) => matchesFacet(d, f, filters[f.key] ?? [])));
}

export function normalize(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function drillText(drill, lang) {
  return normalize(
    [
      drill.title[lang],
      drill.purpose[lang],
      drill.scoring[lang],
      ...drill.procedure[lang],
      ...drill.key_points[lang],
      ...drill.variations[lang],
    ].join(" "),
  );
}

export function searchDrills(drills, query, lang) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return drills;
  return drills.filter((d) => {
    const text = drillText(d, lang);
    return tokens.every((t) => text.includes(t));
  });
}

export function applyFilters(drills, filters, query, lang) {
  return searchDrills(filterDrills(drills, filters), query, lang);
}

export function facetOptions(drills, facet) {
  const counts = new Map();
  for (const d of drills) {
    const values = facet.type === "list" ? d[facet.key] : [String(d[facet.key])];
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

export const emptySession = () => ({ name: "", items: [] });

export function defaultMinutes(drill) {
  return drill.duration_min ?? 10;
}

export function addToSession(session, drill) {
  if (session.items.some((i) => i.drillId === drill.id)) return session;
  return { ...session, items: [...session.items, { drillId: drill.id, minutes: defaultMinutes(drill) }] };
}

export function removeFromSession(session, drillId) {
  return { ...session, items: session.items.filter((i) => i.drillId !== drillId) };
}

export function moveInSession(session, from, to) {
  const n = session.items.length;
  if (from < 0 || from >= n || to < 0 || to >= n) return session;
  const items = [...session.items];
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  return { ...session, items };
}

export function setMinutes(session, drillId, minutes) {
  const value = Math.max(1, Math.min(240, Math.round(Number(minutes)) || 1));
  return {
    ...session,
    items: session.items.map((i) => (i.drillId === drillId ? { ...i, minutes: value } : i)),
  };
}

export function sessionTotal(session) {
  return session.items.reduce((sum, i) => sum + i.minutes, 0);
}

export function sessionToJSON(session, drills) {
  const byId = new Map(drills.map((d) => [d.id, d]));
  return {
    name: session.name,
    total_minutes: sessionTotal(session),
    items: session.items.map((i) => {
      const d = byId.get(i.drillId);
      return {
        id: i.drillId,
        title_en: d ? d.title.en : "",
        title_es: d ? d.title.es : "",
        minutes: i.minutes,
      };
    }),
  };
}

function isValidSession(s) {
  return (
    s !== null &&
    typeof s === "object" &&
    typeof s.name === "string" &&
    Array.isArray(s.items) &&
    s.items.every((i) => typeof i.drillId === "string" && Number.isFinite(i.minutes))
  );
}

export function readSession(storage, key) {
  if (!storage) return emptySession();
  try {
    const raw = storage.getItem(key);
    if (!raw) return emptySession();
    const parsed = JSON.parse(raw);
    return isValidSession(parsed) ? parsed : emptySession();
  } catch {
    return emptySession();
  }
}

export function writeSession(storage, key, session) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function toggleFavorite(ids, drillId) {
  return ids.includes(drillId) ? ids.filter((id) => id !== drillId) : [...ids, drillId];
}

export function filterFavorites(drills, ids) {
  const favorites = new Set(ids);
  return drills.filter((d) => favorites.has(d.id));
}

export function readFavorites(storage, key) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "string")) return [];
    return [...new Set(parsed)];
  } catch {
    return [];
  }
}

export function writeFavorites(storage, key, ids) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}
