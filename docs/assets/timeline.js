// Weekend plans for the overview page: Plan A and Plan B as two calendar-style
// timelines side by side (time runs down). Drag activities from the palette into
// either plan, drag blocks to move them (up/down = time, left/right = column),
// drag the top or bottom edge to resize, × to remove. Arrow keys move a focused
// block, Shift+Up/Down resizes it, Delete removes it.
// Both plans are saved per browser; "Copy link" encodes them in ?plans= to share.

// Bump the version when DEFAULT_PLANS changes so browsers pick up the new defaults
const STORE = "airbnb-pitch:plans:v5";
const SNAP = 0.25; // hours
const LANES = 2;
const KEYS = ["A", "B"];
const RECOMMENDED = "A";
// Times are hours from check-in day 00:00 (next day 00:00 = 24, check-out 10:00 = 58)
const CHECK_IN = 16;
const CHECK_OUT = 58;

// Palette activities. A block can override the name with its own `label` (double-click to rename).
export const TYPES = {
  drive: { zh: "出发 / 路上", dur: 2 },
  shop: { zh: "Costco / 采购", dur: 1.5 },
  checkin: { zh: "Check-in / 卸行李", dur: 0.5 },
  solvang: { zh: "丹麦小镇", dur: 2 },
  dinner: { zh: "烹饪 / 晚餐", dur: 3 },
  // open: no preset length; the chip shows no hours and a new block starts short, then gets resized
  drinks: { zh: "喝酒", dur: 2, open: true },
  games: { zh: "桌游", dur: 2 },
  trpg: { zh: "跑团", dur: 6 },
  wake: { zh: "起床 / 早餐", dur: 2 },
  meal: { zh: "简餐", dur: 1 },
  beach: { zh: "沙滩", dur: 2 },
  prep: { zh: "肉类准备", dur: 2 },
  bbq: { zh: "烧烤", dur: 3 },
  free: { zh: "自由娱乐", dur: 2 },
  sleep: { zh: "睡觉洗漱", dur: 8 },
  travel: { zh: "返程", dur: 2 },
  stay: { zh: "留宿至周一（可选）", dur: 12 },
};

const FROM_HOURS = [8, 10, 12, 16];
const TO_HOURS = [48, 52, 58, 60, 64];

const toBlocks = (rows) => rows.map(([type, start, dur, lane, label]) => ({ type, start, dur, lane, ...(label && { label }) }));
const DEFAULT_PLANS = {
  from: 8,
  to: 58,
  plans: {
    // Solvang on the way up on day 1, full 跑团 on day 2, some head home Sunday night.
    // Things that happen at the same time sit side by side (column 0 | column 1).
    A: toBlocks([
      ["drive", 8.5, 4, 0, "集合出发、前往 Solvang"],
      ["solvang", 12.5, 2, 0, "丹麦小镇：午餐、观光"],
      ["shop", 14.5, 1.5, 0, "Costco / 超市采购、前往住宿"],
      ["checkin", 16, 2, 0, "Check-in、卸行李"], ["prep", 16, 2, 1],
      ["bbq", 18, 6, 0], ["drinks", 21, 5, 1],
      ["sleep", 24, 11, 0],
      ["wake", 35, 2, 0, "起床、早餐"], ["trpg", 36, 6, 1, "完整跑团"],
      ["meal", 42, 1.5, 0, "整理、晚餐"],
      ["travel", 43.5, 2, 0, "马尔基诺返程"],
      ["stay", 45.5, 12.5, 0, "其余可选择住至周一"],
    ]),
    // Drive straight up and hit the beach on day 1, 跑团 alongside dinner; Solvang on day 2
    B: toBlocks([
      ["drive", 10.5, 3, 0, "出发、前往住宿"],
      ["beach", 13.5, 2.5, 0, "沙滩"], ["shop", 14.5, 1.5, 1],
      ["prep", 16, 2, 0], ["checkin", 16, 2, 1, "Check-in、卸行李"],
      ["bbq", 18, 3, 0, "烧烤、晚餐"], ["drinks", 21, 3, 0], ["trpg", 18, 6, 1],
      ["sleep", 24, 10, 0],
      ["wake", 34, 1.5, 0, "起床、早餐"],
      ["drive", 35.5, 1.75, 0, "前往 Solvang"],
      ["solvang", 37.25, 3.25, 0, "Solvang 丹麦小镇：观光、甜点"],
      ["dinner", 40.5, 1.5, 0, "晚餐或休息"],
      ["travel", 42, 2, 0, "返程"],
      ["stay", 45, 13, 0, "其余可选择住至周一"],
    ]),
  },
};

const pad = (n) => String(n).padStart(2, "0");
const clock = (h) => { const m = Math.round(h * 60) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
const hrs = (d) => `${+d.toFixed(1)}h`;
const snap = (h) => Math.round(h / SNAP) * SNAP;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------- state ----------

// Share format: "10-58_A~drive.42.12.0.集合…~sleep.100.40.0_B~…" (start/duration in quarter hours,
// optional URI-encoded label)
const escLabel = (t) => encodeURIComponent(t).replace(/[.~_!]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function encode(state) {
  return [`${state.from}-${state.to}`, ...KEYS.map((k) =>
    [k, ...state.plans[k].map((b) => [b.type, b.start * 4, b.dur * 4, b.lane, ...(b.label ? [escLabel(b.label)] : [])].join("."))].join("~"))].join("_");
}

function decode(text) {
  const [range, ...parts] = text.split("_");
  const [from, to] = range.split("-").map(Number);
  if (!(from < to)) return null;
  const plans = Object.fromEntries(KEYS.map((k) => [k, []]));
  for (const part of parts) {
    const [key, ...items] = part.split("~");
    if (!plans[key]) continue;
    plans[key] = items.map((s) => {
      const [type, start, dur, lane, label] = s.split(".");
      const b = { type, start: Number(start) / 4, dur: Number(dur) / 4, lane: clamp(Number(lane) || 0, 0, LANES - 1) };
      if (label) { try { b.label = decodeURIComponent(label); } catch {} }
      return b;
    }).filter((b) => TYPES[b.type] && b.dur > 0 && Number.isFinite(b.start));
  }
  return { from, to, plans };
}

function save(state) {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {}
}

function load() {
  const url = new URL(location.href);
  const shared = url.searchParams.get("plans");
  if (shared) {
    url.searchParams.delete("plans");
    history.replaceState(null, "", url);
    const state = decode(shared);
    if (state) { save(state); return state; }
  }
  try {
    const state = JSON.parse(localStorage.getItem(STORE));
    if (state?.plans?.A && state?.plans?.B) return state;
  } catch {}
  return clone(DEFAULT_PLANS);
}

// ---------- view ----------

// dayNames: weekday labels starting from the check-in day, e.g. ["Sat", "Sun", "Mon", "Tue"]
// quiet: the house's quiet hours, e.g. { from: 21, to: 8, label: "9:00 PM – 8:00 AM" }; shaded
// on both plans (falls back to plain night shading 22:00–07:00)
export function mountPlans(root, { dayNames, quiet }) {
  const day = (h) => dayNames[Math.floor(h / 24)] ?? "";
  const when = (h) => `${day(h)} ${clock(h)}`;
  let state = load();
  let focus = null; // { key, i } of the block that just changed
  let lastKey = "A"; // tapping a palette chip adds to the plan used last

  root.innerHTML = `<div class="pl">
  <div class="tl-bar">
    <div class="tl-palette" aria-label="Activities: drag into a plan, or tap to add">
      ${Object.entries(TYPES).map(([type, t]) => `<button type="button" class="tl-chip" data-add="${type}" data-type="${type}">
        <b>${t.zh}</b>${t.open ? "" : `<span>${t.dur}h</span>`}</button>`).join("")}
    </div>
  </div>
  <div class="tl-controls">
    <label>From <select data-range="from">${FROM_HOURS.map((h) => `<option value="${h}">${when(h)}</option>`).join("")}</select></label>
    <label>To <select data-range="to">${TO_HOURS.map((h) => `<option value="${h}">${when(h)}</option>`).join("")}</select></label>
    <button type="button" class="tl-btn" data-act="share">Copy link</button>
    <button type="button" class="tl-btn" data-act="reset">Reset</button>
  </div>
  <div class="pl-grid">
    <div></div>
    ${KEYS.map((k) => `<div class="pl-head${k === RECOMMENDED ? " rec" : ""}">Plan ${k}${k === RECOMMENDED ? ' <span class="rec-badge">Recommended</span>' : ""}</div>`).join("")}
    <div class="pl-axis"></div>
    ${KEYS.map((k) => `<div class="pl-track" data-plan="${k}"></div>`).join("")}
  </div>
</div>`;

  const grid = root.querySelector(".pl-grid");
  const axis = root.querySelector(".pl-axis");
  const tracks = Object.fromEntries(KEYS.map((k) => [k, root.querySelector(`.pl-track[data-plan="${k}"]`)]));
  const fromSel = root.querySelector('[data-range="from"]');
  const toSel = root.querySelector('[data-range="to"]');

  const pct = (h) => ((h - state.from) / (state.to - state.from)) * 100;
  const timeText = (b) => `${clock(b.start)}–${clock(b.start + b.dur)}`;

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ESC[c]);

  function blockHTML(key, b, i) {
    const name = esc(b.label || TYPES[b.type].zh);
    return `<div class="blk${b.dur <= 1 ? " short" : ""}${b.dur <= 0.5 ? " tiny" : ""}" data-plan="${key}" data-i="${i}" data-type="${b.type}" tabindex="0"
      title="${name}: ${when(b.start)}–${when(b.start + b.dur)} (${hrs(b.dur)}). Double-click to rename" aria-label="${name}, ${when(b.start)} to ${when(b.start + b.dur)}"
      style="top:${pct(b.start)}%;height:${pct(b.start + b.dur) - pct(b.start)}%;--lane:${b.lane}">
      <span class="blk-h blk-h-t"></span>
      <span class="blk-zh">${name}</span>
      <span class="blk-time">${timeText(b)}</span>
      <button type="button" class="blk-del" aria-label="Remove ${name}">×</button>
      <span class="blk-h blk-h-b"></span>
    </div>`;
  }

  function render() {
    const { from, to } = state;
    fromSel.value = from;
    toSel.value = to;
    grid.style.setProperty("--hours", to - from);
    grid.style.setProperty("--lanes", LANES);

    const marks = { [CHECK_IN]: "入住", [CHECK_OUT]: "退房" };
    const ticks = [`<span class="pl-day" style="top:0%">${day(from)}</span>`];
    for (let h = Math.ceil(from / 2) * 2; h < to; h += 2) {
      if (h === from || marks[h]) continue;
      ticks.push(h % 24 === 0
        ? `<span class="pl-day" style="top:${pct(h)}%">${day(h)}</span>`
        : `<span class="pl-tick" style="top:${pct(h)}%">${clock(h)}</span>`);
    }
    // Check-in / check-out sit on the axis (not over the blocks), with a dashed line across both plans
    for (const [h, label] of Object.entries(marks).map(([h, l]) => [Number(h), l])) {
      if (h > from && h <= to) ticks.push(`<span class="pl-tick mark" style="top:${pct(h)}%">${clock(h)}<b>${label}</b></span>`);
    }
    axis.innerHTML = ticks.join("");

    const backdrop = [];
    for (let d = Math.ceil(from / 24) * 24; d < to; d += 24) {
      if (d > from) backdrop.push(`<div class="pl-midnight" style="top:${pct(d)}%"></div>`);
    }
    const nightFrom = quiet?.from ?? 22;
    const nightLen = (quiet?.to ?? 7) + 24 - nightFrom;
    for (let n = nightFrom - 24; n < to; n += 24) {
      const a = Math.max(from, n), b = Math.min(to, n + nightLen);
      if (b > a) {
        backdrop.push(`<div class="pl-night${quiet ? " quiet" : ""}" style="top:${pct(a)}%;height:${pct(b) - pct(a)}%">${
          quiet && b - a >= 2 ? "<span>Quiet hours</span>" : ""}</div>`);
      }
    }
    for (const [h, label] of [[CHECK_IN, "Check-in"], [CHECK_OUT, "Check-out"]]) {
      if (h >= from && h <= to) backdrop.push(`<div class="pl-mark" style="top:${pct(h)}%" title="${label} ${clock(h)}"></div>`);
    }

    for (const key of KEYS) {
      tracks[key].innerHTML = backdrop.join("") + state.plans[key]
        .map((b, i) => (b.start + b.dur > from && b.start < to ? blockHTML(key, b, i) : "")).join("");
    }

    if (focus) root.querySelector(`.blk[data-plan="${focus.key}"][data-i="${focus.i}"]`)?.focus();
    focus = null;
  }

  const overlaps = (blocks, b, lane) => blocks.some((o) =>
    o !== b && o.lane === lane && o.start < b.start + b.dur && b.start < o.start + o.dur);

  // If the block that just changed now covers another one, move it to a free column
  function commit() {
    const blocks = focus && state.plans[focus.key];
    const b = blocks?.[focus.i];
    if (b && overlaps(blocks, b, b.lane)) {
      const free = [...Array(LANES).keys()].find((lane) => !overlaps(blocks, b, lane));
      if (free !== undefined) b.lane = free;
    }
    save(state);
    render();
  }

  // Redraw a dragged block without a full re-render
  function place(el, b) {
    el.style.top = `${pct(b.start)}%`;
    el.style.height = `${pct(b.start + b.dur) - pct(b.start)}%`;
    el.style.setProperty("--lane", b.lane);
    el.querySelector(".blk-time").textContent = timeText(b);
  }

  // First spot (column by column, top to bottom) where a block of this length fits
  function freeSlot(blocks, dur) {
    for (let lane = 0; lane < LANES; lane++) {
      for (let start = state.from; start + dur <= state.to; start += SNAP) {
        const clash = blocks.some((b) => b.lane === lane && b.start < start + dur && start < b.start + b.dur);
        if (!clash) return { start, lane };
      }
    }
    return { start: state.from, lane: LANES - 1 };
  }

  // Move / resize blocks
  grid.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".blk");
    if (!el || el.classList.contains("editing") || e.target.closest(".blk-del") || e.button > 0) return;
    e.preventDefault();
    const key = el.dataset.plan;
    lastKey = key;
    const b = state.plans[key][el.dataset.i];
    const orig = { ...b };
    const mode = e.target.closest(".blk-h-t") ? "top" : e.target.closest(".blk-h-b") ? "bottom" : "move";
    const rect = tracks[key].getBoundingClientRect();
    const pxPerHour = rect.height / (state.to - state.from);
    const laneWidth = rect.width / LANES;
    const sx = e.clientX, sy = e.clientY;
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    el.focus({ preventScroll: true });

    const move = (ev) => {
      const dh = snap((ev.clientY - sy) / pxPerHour);
      if (mode === "move") {
        b.start = clamp(orig.start + dh, state.from, state.to - orig.dur);
        b.lane = clamp(orig.lane + Math.round((ev.clientX - sx) / laneWidth), 0, LANES - 1);
      } else if (mode === "top") {
        const end = orig.start + orig.dur;
        b.start = clamp(orig.start + dh, state.from, end - SNAP);
        b.dur = end - b.start;
      } else {
        b.dur = clamp(orig.dur + dh, SNAP, state.to - orig.start);
      }
      place(el, b);
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      el.classList.remove("dragging");
      // A plain click (nothing moved) keeps the same element, so a double-click can follow
      if (b.start === orig.start && b.dur === orig.dur && b.lane === orig.lane) return;
      focus = { key, i: Number(el.dataset.i) };
      commit();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  });

  grid.addEventListener("click", (e) => {
    const del = e.target.closest(".blk-del");
    if (!del) return;
    const el = del.closest(".blk");
    state.plans[el.dataset.plan].splice(Number(el.dataset.i), 1);
    commit();
  });

  // Double-click (or Enter) a block to rename it in place: Enter saves, Esc cancels,
  // an empty name goes back to the activity's default name
  function rename(el) {
    const key = el.dataset.plan, i = Number(el.dataset.i);
    const b = state.plans[key][i];
    const nameEl = el.querySelector(".blk-zh");
    const input = document.createElement("input");
    input.className = "blk-edit";
    input.value = b.label || TYPES[b.type].zh;
    input.setAttribute("aria-label", "Block name");
    nameEl.replaceWith(input);
    el.classList.add("editing");
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save) {
        if (name && name !== TYPES[b.type].zh) b.label = name;
        else delete b.label;
      }
      focus = { key, i };
      commit();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", () => finish(true));
  }
  grid.addEventListener("dblclick", (e) => {
    const el = e.target.closest(".blk");
    if (el && !el.classList.contains("editing") && !e.target.closest(".blk-del")) rename(el);
  });

  grid.addEventListener("keydown", (e) => {
    const el = e.target.closest(".blk");
    if (!el) return;
    const key = el.dataset.plan;
    const i = Number(el.dataset.i);
    const b = state.plans[key][i];
    if (e.key === "Enter") {
      e.preventDefault();
      return rename(el);
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      state.plans[key].splice(i, 1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const dh = e.key === "ArrowUp" ? -SNAP : SNAP;
      if (e.shiftKey) b.dur = clamp(b.dur + dh, SNAP, state.to - b.start);
      else b.start = clamp(b.start + dh, state.from, state.to - b.dur);
      focus = { key, i };
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      b.lane = clamp(b.lane + (e.key === "ArrowLeft" ? -1 : 1), 0, LANES - 1);
      focus = { key, i };
    } else {
      return;
    }
    e.preventDefault();
    commit();
  });

  // Drag a new activity from the palette into a plan; a tap adds it to the last-used plan
  root.querySelector(".tl-palette").addEventListener("pointerdown", (e) => {
    const chip = e.target.closest("[data-add]");
    if (!chip || e.button > 0) return;
    e.preventDefault();
    const type = chip.dataset.add;
    const dur = TYPES[type].dur;
    const sx = e.clientX, sy = e.clientY;
    let ghost = null;

    const move = (ev) => {
      if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      if (!ghost) {
        ghost = chip.cloneNode(true);
        ghost.classList.add("tl-ghost");
        document.body.append(ghost);
      }
      ghost.style.left = `${ev.clientX}px`;
      ghost.style.top = `${ev.clientY}px`;
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!ghost) {
        const blocks = state.plans[lastKey];
        blocks.push({ type, dur, ...freeSlot(blocks, dur) });
        focus = { key: lastKey, i: blocks.length - 1 };
        return commit();
      }
      ghost.remove();
      if (ev.type === "pointercancel") return;
      const track = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".pl-track");
      if (!track || !root.contains(track)) return;
      const key = track.dataset.plan;
      const r = track.getBoundingClientRect();
      const h = state.from + ((ev.clientY - r.top) / r.height) * (state.to - state.from);
      const blocks = state.plans[key];
      blocks.push({
        type, dur,
        start: clamp(snap(h - dur / 2), state.from, Math.max(state.from, state.to - dur)),
        lane: clamp(Math.floor(((ev.clientX - r.left) / r.width) * LANES), 0, LANES - 1),
      });
      lastKey = key;
      focus = { key, i: blocks.length - 1 };
      commit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });

  fromSel.addEventListener("change", () => { state.from = Number(fromSel.value); commit(); });
  toSel.addEventListener("change", () => { state.to = Number(toSel.value); commit(); });

  root.querySelector('[data-act="reset"]').addEventListener("click", () => {
    state = clone(DEFAULT_PLANS);
    commit();
  });

  root.querySelector('[data-act="share"]').addEventListener("click", async (e) => {
    const url = new URL(location.href);
    url.searchParams.set("plans", encode(state));
    const btn = e.currentTarget;
    try {
      await navigator.clipboard.writeText(url.href);
      btn.textContent = "Link copied";
    } catch {
      prompt("Copy this link:", url.href);
    }
    setTimeout(() => { btn.textContent = "Copy link"; }, 1800);
  });

  render();
}
