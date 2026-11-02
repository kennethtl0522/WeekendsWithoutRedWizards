// Weekend timeline planner for the overview page.
// Drag activities from the palette onto the timeline, drag blocks to move them
// (left/right = time, up/down = row), drag either edge to resize, × to remove.
// Arrow keys move a focused block, Shift+arrows resize it, Delete removes it.
// The plan is saved per browser; "Copy link" encodes it in ?plan= to share.

// Bump the version when DEFAULT_PLAN changes so browsers pick up the new default
const STORE = "airbnb-pitch:timeline:v3";
const SNAP = 0.5; // hours
const LANES = 3;
const DAYS = ["Fri", "Sat", "Sun", "Mon"];
// Times are hours from Friday 00:00 (Sat 00:00 = 24, Sun 10:00 = 58)
const CHECK_IN = 16;
const CHECK_OUT = 58;

export const TYPES = {
  meal: { zh: "简餐", dur: 1 },
  evening: { zh: "度过夜晚", dur: 4 },
  prep: { zh: "肉类准备", dur: 2 },
  trpg: { zh: "跑团", dur: 6 },
  bbq: { zh: "烧烤", dur: 3 },
  drinks: { zh: "喝酒", dur: 4 },
  sleep: { zh: "睡觉洗漱", dur: 8 },
  travel: { zh: "回程 / 丹麦小镇", dur: 2 },
};

const FROM_OPTIONS = [[12, "Fri 12:00"], [16, "Fri 16:00"], [18, "Fri 18:00"]];
const TO_OPTIONS = [[58, "Sun 10:00"], [60, "Sun 12:00"], [62, "Sun 14:00"], [66, "Sun 18:00"]];

const DEFAULT_PLAN = {
  from: 16,
  to: 60,
  // Fri: check in, light dinner, evening, 8h sleep. Sat: meat prep at noon, 跑团 in the
  // afternoon, BBQ + drinks at dinner, 8h sleep. Sun: check out 10:00.
  blocks: [
    ["meal", 18, 1, 0], ["evening", 19, 4, 0], ["sleep", 23, 8, 0], ["prep", 35.5, 2, 0],
    ["trpg", 37.5, 5.5, 0], ["bbq", 43, 3, 0], ["drinks", 43, 4, 1], ["sleep", 47.5, 8, 0],
    ["travel", 58, 2, 0],
  ].map(([type, start, dur, lane]) => ({ type, start, dur, lane })),
};

const pad = (n) => String(n).padStart(2, "0");
const clock = (h) => { const m = Math.round(h * 60) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
const day = (h) => DAYS[Math.floor(h / 24)] ?? "";
const when = (h) => `${day(h)} ${clock(h)}`;
const hrs = (d) => `${+d.toFixed(1)}h`;
const snap = (h) => Math.round(h / SNAP) * SNAP;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clone = (plan) => JSON.parse(JSON.stringify(plan));

// ---------- state ----------

// Compact share format: "16-60~prep.34.4.0~bbq.38.6.0" (start/duration in half hours)
function encode(plan) {
  return [`${plan.from}-${plan.to}`, ...plan.blocks.map((b) => `${b.type}.${b.start * 2}.${b.dur * 2}.${b.lane}`)].join("~");
}

function decode(text) {
  const [range, ...items] = text.split("~");
  const [from, to] = range.split("-").map(Number);
  if (!(from < to)) return null;
  const blocks = items.map((s) => {
    const [type, start, dur, lane] = s.split(".");
    return { type, start: Number(start) / 2, dur: Number(dur) / 2, lane: clamp(Number(lane) || 0, 0, LANES - 1) };
  }).filter((b) => TYPES[b.type] && b.dur > 0 && Number.isFinite(b.start));
  return { from, to, blocks };
}

function load() {
  const url = new URL(location.href);
  const shared = url.searchParams.get("plan");
  if (shared) {
    url.searchParams.delete("plan");
    history.replaceState(null, "", url);
    const plan = decode(shared);
    if (plan) { save(plan); return plan; }
  }
  try {
    const plan = JSON.parse(localStorage.getItem(STORE));
    if (plan?.blocks) return plan;
  } catch {}
  return clone(DEFAULT_PLAN);
}

function save(plan) {
  try { localStorage.setItem(STORE, JSON.stringify(plan)); } catch {}
}

// ---------- view ----------

export function mountTimeline(root) {
  let plan = load();
  let focusIndex = null;

  const pct = (h) => ((h - plan.from) / (plan.to - plan.from)) * 100;
  const span = (a, b) => `left:${pct(a)}%;width:${pct(b) - pct(a)}%`;

  root.innerHTML = `<div class="tl">
  <div class="tl-bar">
    <div class="tl-palette" aria-label="Activities: drag onto the timeline, or tap to add">
      ${Object.entries(TYPES).map(([type, t]) => `<button type="button" class="tl-chip" data-add="${type}" data-type="${type}">
        <b>${t.zh}</b><span>${t.dur}h</span></button>`).join("")}
    </div>
    <div class="tl-controls">
      <label>From <select data-range="from">${FROM_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
      <label>To <select data-range="to">${TO_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
      <button type="button" class="tl-btn" data-act="share">Copy link</button>
      <button type="button" class="tl-btn" data-act="reset">Reset</button>
    </div>
  </div>
  <div class="tl-scroll"><div class="tl-inner"></div></div>
</div>`;

  const inner = root.querySelector(".tl-inner");
  const fromSel = root.querySelector('[data-range="from"]');
  const toSel = root.querySelector('[data-range="to"]');

  function blockHTML(b, i) {
    const t = TYPES[b.type];
    return `<div class="blk" data-i="${i}" data-type="${b.type}" tabindex="0" title="${t.zh}: ${when(b.start)}–${when(b.start + b.dur)} (${hrs(b.dur)})" style="${span(b.start, b.start + b.dur)};--lane:${b.lane}"
      aria-label="${t.zh}, ${when(b.start)} to ${when(b.start + b.dur)}">
      <span class="blk-h blk-h-l"></span>
      <span class="blk-zh">${t.zh}</span>
      <span class="blk-time">${when(b.start)}–${clock(b.start + b.dur)} · ${hrs(b.dur)}</span>
      <button type="button" class="blk-del" aria-label="Remove ${t.zh}">×</button>
      <span class="blk-h blk-h-r"></span>
    </div>`;
  }

  function render() {
    const { from, to } = plan;
    fromSel.value = from;
    toSel.value = to;
    inner.style.setProperty("--hours", to - from);

    const days = [];
    for (let d = Math.floor(from / 24) * 24; d < to; d += 24) {
      const a = Math.max(from, d), b = Math.min(to, d + 24);
      days.push(`<div class="tl-day" style="${span(a, b)}">${day(d)}</div>`);
    }
    const ticks = [];
    for (let h = Math.ceil(from / 3) * 3; h <= to; h += 3) {
      if (h > from && h < to) ticks.push(`<span class="tl-tick" style="left:${pct(h)}%">${clock(h)}</span>`);
    }
    const nights = [];
    for (let n = 22; n < to; n += 24) {
      const a = Math.max(from, n), b = Math.min(to, n + 9);
      if (b > a) nights.push(`<div class="tl-night" style="${span(a, b)}"></div>`);
    }
    const marks = [[CHECK_IN, "Check-in"], [CHECK_OUT, "Check-out"]]
      .filter(([h]) => h >= from && h <= to)
      .map(([h, label]) => `<div class="tl-mark${pct(h) > 80 ? " end" : ""}" style="left:${pct(h)}%"><span>${label} ${clock(h)}</span></div>`);

    inner.innerHTML = `<div class="tl-axis">${days.join("")}${ticks.join("")}</div>
      <div class="tl-track" style="--lanes:${LANES}">
        ${nights.join("")}${marks.join("")}
        ${plan.blocks.map((b, i) => (b.start + b.dur > from && b.start < to ? blockHTML(b, i) : "")).join("")}
      </div>`;

    if (focusIndex != null) inner.querySelector(`.blk[data-i="${focusIndex}"]`)?.focus();
    focusIndex = null;
  }

  const overlaps = (b, lane) => plan.blocks.some((o) =>
    o !== b && o.lane === lane && o.start < b.start + b.dur && b.start < o.start + o.dur);

  // focusIndex is the block that just changed; if it now covers another block, move it to a free row
  function commit() {
    const b = plan.blocks[focusIndex];
    if (b && overlaps(b, b.lane)) {
      const free = [...Array(LANES).keys()].find((lane) => !overlaps(b, lane));
      if (free !== undefined) b.lane = free;
    }
    save(plan);
    render();
  }

  // Place a dragged block without a full re-render
  function place(el, b) {
    el.style.left = `${pct(b.start)}%`;
    el.style.width = `${pct(b.start + b.dur) - pct(b.start)}%`;
    el.style.setProperty("--lane", b.lane);
    el.querySelector(".blk-time").textContent = `${when(b.start)}–${clock(b.start + b.dur)} · ${hrs(b.dur)}`;
  }

  // First spot (row by row, left to right) where a block of this length doesn't overlap anything
  function freeSlot(dur) {
    for (let lane = 0; lane < LANES; lane++) {
      for (let start = plan.from; start + dur <= plan.to; start += SNAP) {
        const clash = plan.blocks.some((b) => b.lane === lane && b.start < start + dur && start < b.start + b.dur);
        if (!clash) return { start, lane };
      }
    }
    return { start: plan.from, lane: LANES - 1 };
  }

  // Move / resize existing blocks
  inner.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".blk");
    if (!el || e.target.closest(".blk-del") || e.button > 0) return;
    e.preventDefault();
    const b = plan.blocks[el.dataset.i];
    const orig = { ...b };
    const mode = e.target.closest(".blk-h-l") ? "left" : e.target.closest(".blk-h-r") ? "right" : "move";
    const track = inner.querySelector(".tl-track");
    const pxPerHour = track.getBoundingClientRect().width / (plan.to - plan.from);
    const laneHeight = parseFloat(getComputedStyle(track).getPropertyValue("--lane-h")) || 56;
    const sx = e.clientX, sy = e.clientY;
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    el.focus({ preventScroll: true });

    const move = (ev) => {
      const dh = snap((ev.clientX - sx) / pxPerHour);
      if (mode === "move") {
        b.start = clamp(orig.start + dh, plan.from, plan.to - orig.dur);
        b.lane = clamp(orig.lane + Math.round((ev.clientY - sy) / laneHeight), 0, LANES - 1);
      } else if (mode === "left") {
        const end = orig.start + orig.dur;
        b.start = clamp(orig.start + dh, plan.from, end - SNAP);
        b.dur = end - b.start;
      } else {
        b.dur = clamp(orig.dur + dh, SNAP, plan.to - orig.start);
      }
      place(el, b);
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      focusIndex = Number(el.dataset.i);
      commit();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  });

  inner.addEventListener("click", (e) => {
    const del = e.target.closest(".blk-del");
    if (!del) return;
    plan.blocks.splice(Number(del.closest(".blk").dataset.i), 1);
    commit();
  });

  inner.addEventListener("keydown", (e) => {
    const el = e.target.closest(".blk");
    if (!el) return;
    const i = Number(el.dataset.i);
    const b = plan.blocks[i];
    if (e.key === "Delete" || e.key === "Backspace") {
      plan.blocks.splice(i, 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const dh = e.key === "ArrowLeft" ? -SNAP : SNAP;
      if (e.shiftKey) b.dur = clamp(b.dur + dh, SNAP, plan.to - b.start);
      else b.start = clamp(b.start + dh, plan.from, plan.to - b.dur);
      focusIndex = i;
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      b.lane = clamp(b.lane + (e.key === "ArrowUp" ? -1 : 1), 0, LANES - 1);
      focusIndex = i;
    } else {
      return;
    }
    e.preventDefault();
    commit();
  });

  // Drag a new activity from the palette; a tap without dragging drops it in the first free slot
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
        plan.blocks.push({ type, dur, ...freeSlot(dur) });
        focusIndex = plan.blocks.length - 1;
        return commit();
      }
      ghost.remove();
      if (ev.type === "pointercancel") return;
      const r = inner.querySelector(".tl-track").getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
      const h = plan.from + ((ev.clientX - r.left) / r.width) * (plan.to - plan.from);
      plan.blocks.push({
        type, dur,
        start: clamp(snap(h - dur / 2), plan.from, Math.max(plan.from, plan.to - dur)),
        lane: clamp(Math.floor(((ev.clientY - r.top) / r.height) * LANES), 0, LANES - 1),
      });
      focusIndex = plan.blocks.length - 1;
      commit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });

  fromSel.addEventListener("change", () => { plan.from = Number(fromSel.value); commit(); });
  toSel.addEventListener("change", () => { plan.to = Number(toSel.value); commit(); });

  root.querySelector('[data-act="reset"]').addEventListener("click", () => {
    plan = clone(DEFAULT_PLAN);
    commit();
  });

  root.querySelector('[data-act="share"]').addEventListener("click", async (e) => {
    const url = new URL(location.href);
    url.searchParams.set("plan", encode(plan));
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
