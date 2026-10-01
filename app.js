import {
  FACETS, applyFilters, emptyFilters, facetOptions, emptySession, addToSession,
  removeFromSession, moveInSession, setMinutes, sessionTotal, sessionToJSON,
  readSession, writeSession, toggleFavorite, filterFavorites, readFavorites, writeFavorites,
} from "./lib.js";
import { FACET_LABELS, UI, valueLabel } from "./labels.js";

const SESSION_KEY = "tennis-drill-session-v1";
const LANG_KEY = "tennis-drill-lang-v1";
const FAVORITES_KEY = "tennis-drill-favorites-v1";

const state = {
  data: null,
  lang: "en",
  query: "",
  filters: emptyFilters(),
  session: emptySession(),
  favorites: [],
  onlyFavorites: false,
};

const $ = (selector) => document.querySelector(selector);
const t = () => UI[state.lang];

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readLang() {
  try {
    const stored = getStorage()?.getItem(LANG_KEY);
    return stored === "es" || stored === "en" ? stored : "en";
  } catch {
    return "en";
  }
}

function saveLang() {
  try {
    getStorage()?.setItem(LANG_KEY, state.lang);
  } catch {
    /* storage unavailable: the language just resets on reload */
  }
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function drillById(id) {
  return state.data?.drills.find((d) => d.id === id);
}

function inSession(drillId) {
  return state.session.items.some((i) => i.drillId === drillId);
}

function persistSession() {
  writeSession(getStorage(), SESSION_KEY, state.session);
}

function isFavorite(drillId) {
  return state.favorites.includes(drillId);
}

function persistFavorites() {
  writeFavorites(getStorage(), FAVORITES_KEY, state.favorites);
}

function cardId(drill) {
  const title = state.data.sources[drill.source_id]?.title ?? drill.source_id;
  return `${title} · #${drill.book_number} · ${drill.book_category}`;
}

function slug(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function snippet(text) {
  return text.length > 150 ? `${text.slice(0, 147).trimEnd()}...` : text;
}

/* ---------- chrome (static text that depends on language) ---------- */

function renderChrome() {
  document.documentElement.lang = state.lang;
  document.title = t().title;
  $("#app-title").textContent = t().title;
  $("#search").placeholder = t().search;
  $("#search").setAttribute("aria-label", t().search);
  $("#lang-toggle").textContent = t().langButton;
  $("#lang-toggle").setAttribute("aria-label", `${t().langButton}: ${t().langLabel}`);
  renderSessionButton();
  renderFavoritesButton();
}

function renderFavoritesButton() {
  const button = $("#favorites-toggle");
  button.textContent = `\u2605 ${t().favorites} (${state.favorites.length})`;
  button.setAttribute("aria-pressed", String(state.onlyFavorites));
  button.classList.toggle("on", state.onlyFavorites);
}

function renderSessionButton() {
  $("#session-open").textContent = `${t().session} (${state.session.items.length})`;
}

/* ---------- filters ---------- */

function renderFilters() {
  const prevBox = $("#filters .filters-box");
  const prevGroups = new Map(
    [...$("#filters").querySelectorAll("details[data-facet]")].map((d) => [d.dataset.facet, d.open]),
  );
  const box = el("details", { class: "filters-box" });
  box.open = prevBox ? prevBox.open : window.matchMedia("(min-width: 801px)").matches;
  box.append(
    el("summary", {}, t().filters),
    el("button", { type: "button", onclick: clearFilters }, t().clearFilters),
  );
  for (const facet of FACETS) {
    const options = facetOptions(state.data.drills, facet);
    if (options.length === 0) continue;
    const selected = state.filters[facet.key];
    const group = el("details", { "data-facet": facet.key }, el("summary", {}, FACET_LABELS[facet.key][state.lang]));
    group.open = prevGroups.has(facet.key)
      ? prevGroups.get(facet.key)
      : selected.length > 0 || ["format", "skills", "serve_required"].includes(facet.key);
    for (const { value, count } of options) {
      const checkbox = el("input", { type: "checkbox", value });
      checkbox.checked = selected.includes(value);
      checkbox.addEventListener("change", () => {
        const current = state.filters[facet.key];
        state.filters[facet.key] = checkbox.checked
          ? [...current, value]
          : current.filter((v) => v !== value);
        renderList();
      });
      group.append(
        el("label", {}, checkbox, valueLabel(facet.key, value, state.lang, state.data.sources), el("span", { class: "count" }, count)),
      );
    }
    box.append(group);
  }
  $("#filters").replaceChildren(box);
}

function clearFilters() {
  state.filters = emptyFilters();
  state.onlyFavorites = false;
  renderFavoritesButton();
  renderFilters();
  renderList();
}

/* ---------- list ---------- */

function chipsFor(drill) {
  const chips = [
    valueLabel("format", drill.format, state.lang),
    valueLabel("players", drill.players, state.lang),
    valueLabel("level", drill.level, state.lang),
  ];
  if (drill.serve_required) chips.push(valueLabel("skills", "serve", state.lang));
  chips.push(drill.duration_min ? `${drill.duration_min} ${t().minutes}` : t().noTime);
  return chips;
}

function favoriteButton(drill) {
  const on = isFavorite(drill.id);
  return el(
    "button",
    {
      type: "button",
      class: on ? "star on" : "star",
      "aria-pressed": String(on),
      "aria-label": `${t().favorite}: ${drill.title[state.lang]}`,
      onclick: () => toggleFavoriteDrill(drill),
    },
    on ? "\u2605" : "\u2606",
  );
}

function card(drill) {
  const selected = inSession(drill.id);
  return el(
    "li",
    { class: "card" },
    el("div", { class: "card-top" }, el("p", { class: "card-id" }, cardId(drill)), favoriteButton(drill)),
    el("h3", {}, el("button", { type: "button", class: "link", onclick: () => openDetail(drill.id) }, drill.title[state.lang])),
    el("p", { class: "chips" }, chipsFor(drill).map((c) => el("span", { class: "chip" }, c))),
    el("p", { class: "snippet" }, snippet(drill.purpose[state.lang])),
    el(
      "div",
      { class: "card-actions" },
      el("button", { type: "button", onclick: () => openDetail(drill.id) }, t().details),
      el(
        "button",
        { type: "button", class: selected ? "on" : "", "aria-pressed": String(selected), "aria-label": t().addSession, onclick: () => toggleSession(drill) },
        selected ? t().inSession : t().addSession,
      ),
    ),
  );
}

function renderList() {
  if (!state.data) return;
  const pool = state.onlyFavorites ? filterFavorites(state.data.drills, state.favorites) : state.data.drills;
  const results = applyFilters(pool, state.filters, state.query, state.lang);
  $("#result-count").textContent = t().results(results.length);
  const list = $("#results");
  list.replaceChildren(...results.map(card));
  if (results.length === 0) {
    const noFavorites = state.onlyFavorites && state.favorites.length === 0;
    list.append(el("li", { class: "empty" }, noFavorites ? t().noFavorites : t().noResults));
  }
}

function toggleFavoriteDrill(drill) {
  state.favorites = toggleFavorite(state.favorites, drill.id);
  persistFavorites();
  renderFavoritesButton();
  renderList();
  if ($("#detail").open) renderDetail(drill.id);
}

function toggleSession(drill) {
  state.session = inSession(drill.id)
    ? removeFromSession(state.session, drill.id)
    : addToSession(state.session, drill);
  persistSession();
  renderSessionButton();
  renderList();
  if ($("#session").open) renderSessionDialog();
  if ($("#detail").open) renderDetail(drill.id);
}

/* ---------- detail dialog ---------- */

function section(title, content) {
  return [el("h3", {}, title), content];
}

function renderDetail(id) {
  const drill = drillById(id);
  if (!drill) return;
  const lang = state.lang;
  const source = state.data.sources[drill.source_id];
  const diagrams = [drill.diagram, ...(drill.extra_diagrams ?? [])].filter(Boolean);
  const selected = inSession(drill.id);
  const dialog = $("#detail");
  dialog.setAttribute("aria-labelledby", "detail-title");
  const children = [
    el(
      "div",
      { class: "dialog-head" },
      el("div", {}, el("p", { class: "card-id" }, cardId(drill)), el("h2", { id: "detail-title" }, drill.title[lang])),
      el("button", { type: "button", onclick: () => dialog.close() }, t().close),
    ),
    el("p", { class: "chips" }, chipsFor(drill).map((c) => el("span", { class: "chip" }, c))),
    el(
      "p",
      { class: "chips" },
      [
        ...drill.skills.map((v) => valueLabel("skills", v, lang)),
        ...drill.shots.map((v) => valueLabel("shots", v, lang)),
        ...drill.surface.map((v) => valueLabel("surface", v, lang)),
        ...drill.opponent_styles.map((v) => valueLabel("opponent_styles", v, lang)),
        ...(drill.audience === "all" ? [] : [valueLabel("audience", drill.audience, lang)]),
      ].map((c) => el("span", { class: "chip" }, c)),
    ),
    el(
      "div",
      { class: "card-actions" },
      favoriteButton(drill),
      el(
        "button",
        { type: "button", class: selected ? "on" : "primary", "aria-pressed": String(selected), "aria-label": t().addSession, onclick: () => toggleSession(drill) },
        selected ? t().inSession : t().addSession,
      ),
    ),
    section(t().purpose, el("p", {}, drill.purpose[lang])),
    section(t().time, el("p", {}, drill.duration_note[lang])),
    section(t().procedure, el("ol", {}, drill.procedure[lang].map((s) => el("li", {}, s)))),
    section(t().scoring, el("p", {}, drill.scoring[lang])),
    drill.key_points[lang].length ? section(t().keyPoints, el("ul", {}, drill.key_points[lang].map((s) => el("li", {}, s)))) : null,
    drill.variations[lang].length ? section(t().variations, el("ul", {}, drill.variations[lang].map((s) => el("li", {}, s)))) : null,
    diagrams.length
      ? el(
          "div",
          { class: "diagrams" },
          diagrams.map((path, i) => el("img", { src: `data/${path}`, alt: `${drill.title[lang]} (${i + 1}/${diagrams.length})`, loading: "lazy" })),
        )
      : null,
    el("p", { class: "note" }, `${t().source}: ${source.title}, ${source.author}, ${t().page} ${drill.book_page}. ${lang === "es" ? t().machineTranslation : ""}`),
  ];
  dialog.replaceChildren(...children.flat().filter(Boolean));
}

function openDetail(id) {
  const dialog = $("#detail");
  renderDetail(id);
  dialog.dataset.drillId = id;
  if (!dialog.open) dialog.showModal();
  history.replaceState(null, "", `#drill=${encodeURIComponent(id)}`);
}

function openFromHash() {
  const match = /^#drill=(.+)$/.exec(location.hash);
  if (!match) return;
  const id = decodeURIComponent(match[1]);
  if (drillById(id)) openDetail(id);
}

/* ---------- session dialog ---------- */

function renderSessionDialog() {
  const dialog = $("#session");
  const { items } = state.session;
  const list = items.map((item, index) => {
    const drill = drillById(item.drillId);
    const title = drill ? drill.title[state.lang] : item.drillId;
    const minutes = el("input", { type: "number", min: "1", max: "240", value: String(item.minutes), "aria-label": `${title} ${t().minutes}` });
    minutes.addEventListener("change", () => {
      state.session = setMinutes(state.session, item.drillId, minutes.value);
      persistSession();
      renderSessionDialog();
    });
    return el(
      "li",
      { class: "session-item" },
      el("strong", {}, `${index + 1}. ${title}`),
      el(
        "div",
        { class: "controls" },
        minutes,
        el("span", {}, t().minutes),
        el("button", { type: "button", "aria-label": t().moveUp, disabled: index === 0, onclick: () => moveItem(index, index - 1) }, "↑"),
        el("button", { type: "button", "aria-label": t().moveDown, disabled: index === items.length - 1, onclick: () => moveItem(index, index + 1) }, "↓"),
        el("button", { type: "button", onclick: () => removeItem(item.drillId) }, t().remove),
      ),
    );
  });

  const name = el("input", { class: "session-name", type: "text", value: state.session.name, placeholder: t().sessionName, "aria-label": t().sessionName });
  name.addEventListener("input", () => {
    state.session = { ...state.session, name: name.value };
    persistSession();
  });

  dialog.setAttribute("aria-labelledby", "session-title");
  dialog.replaceChildren(
    el(
      "div",
      { class: "dialog-head" },
      el("h2", { id: "session-title" }, t().session),
      el("button", { type: "button", onclick: () => dialog.close() }, t().close),
    ),
    name,
    items.length ? el("ol", { class: "session-list", style: "list-style:none;padding:0;margin:0" }, list) : el("p", { class: "empty" }, t().sessionEmpty),
    el("p", {}, el("strong", {}, `${t().total}: ${sessionTotal(state.session)} ${t().minutes}`)),
    el(
      "div",
      { class: "session-tools" },
      el("button", { type: "button", class: "primary", disabled: items.length === 0, onclick: exportSession }, t().exportJson),
      el("button", { type: "button", disabled: items.length === 0, onclick: printSession }, t().print),
      el("button", { type: "button", disabled: items.length === 0, onclick: clearSession }, t().clearSession),
    ),
  );
}

function afterSessionChange() {
  persistSession();
  renderSessionButton();
  renderList();
  renderSessionDialog();
}

function moveItem(from, to) {
  state.session = moveInSession(state.session, from, to);
  afterSessionChange();
}

function removeItem(drillId) {
  state.session = removeFromSession(state.session, drillId);
  afterSessionChange();
}

function clearSession() {
  state.session = { ...emptySession(), name: state.session.name };
  afterSessionChange();
}

function exportSession() {
  if (!state.data) return;
  const data = sessionToJSON(state.session, state.data.drills);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: `${slug(state.session.name) || "session"}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printSession() {
  const area = $("#print-area");
  const lang = state.lang;
  area.replaceChildren(
    el("h1", {}, state.session.name || t().session),
    el("p", {}, `${t().total}: ${sessionTotal(state.session)} ${t().minutes}`),
    ...state.session.items.flatMap((item, index) => {
      const drill = drillById(item.drillId);
      if (!drill) return [];
      return [
        el("h2", {}, `${index + 1}. ${drill.title[lang]} (${item.minutes} ${t().minutes})`),
        el("p", {}, drill.purpose[lang]),
        el("ol", {}, drill.procedure[lang].map((s) => el("li", {}, s))),
      ];
    }),
  );
  window.print();
}

/* ---------- boot ---------- */

function bindStatic() {
  $("#search").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderList();
  });
  $("#lang-toggle").addEventListener("click", () => {
    state.lang = state.lang === "en" ? "es" : "en";
    saveLang();
    renderAll();
    if (!state.data) {
      showLoadError();
      return;
    }
    if ($("#detail").open) renderDetail($("#detail").dataset.drillId);
    if ($("#session").open) renderSessionDialog();
  });
  $("#favorites-toggle").addEventListener("click", () => {
    state.onlyFavorites = !state.onlyFavorites;
    renderFavoritesButton();
    renderList();
  });
  $("#session-open").addEventListener("click", () => {
    renderSessionDialog();
    $("#session").showModal();
  });
  $("#detail").addEventListener("close", () => {
    if (location.hash.startsWith("#drill=")) history.replaceState(null, "", location.pathname + location.search);
  });
  window.addEventListener("hashchange", () => {
    if (location.hash.startsWith("#drill=")) openFromHash();
    else if ($("#detail").open) $("#detail").close();
  });
}

function showLoadError() {
  const error = $("#error");
  error.textContent = t().loadError;
  error.hidden = false;
}

function renderAll() {
  renderChrome();
  if (!state.data) return;
  renderFilters();
  renderList();
}

async function init() {
  state.lang = readLang();
  state.session = readSession(getStorage(), SESSION_KEY);
  state.favorites = readFavorites(getStorage(), FAVORITES_KEY);
  bindStatic();
  renderChrome();
  try {
    const response = await fetch("data/drills.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
  } catch {
    showLoadError();
    return;
  }
  const known = new Set(state.data.drills.map((d) => d.id));
  state.session = { ...state.session, items: state.session.items.filter((i) => known.has(i.drillId)) };
  state.favorites = state.favorites.filter((id) => known.has(id));
  renderAll();
  openFromHash();
}

init();
