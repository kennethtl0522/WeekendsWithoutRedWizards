// Date page: list / side-by-side view, sort, area filter, compare selection.
// Selection is kept per date in localStorage and mirrored in the URL (?view=compare&ids=...)
// so a shortlist can be shared as a link.
(() => {
  const board = document.querySelector(".board");
  if (!board) return;

  const storeKey = "airbnb-pitch:" + board.dataset.dates;
  const slots = [...board.querySelectorAll(".slot")];
  const sortSel = document.getElementById("sort");
  const areaSel = document.getElementById("area");
  const count = document.getElementById("sel-count");

  const state = { view: "list", ids: [], sort: "pp", area: "" };
  try { Object.assign(state, JSON.parse(localStorage.getItem(storeKey) || "{}")); } catch {}
  const query = new URLSearchParams(location.search);
  if (query.has("view")) state.view = query.get("view");
  if (query.has("ids")) state.ids = query.get("ids").split(",").filter(Boolean);

  const num = (el, key) => parseFloat(el.dataset[key]) || 0;
  const sorters = {
    pp: (a, b) => num(a, "pp") - num(b, "pp"),
    rating: (a, b) => num(b, "rating") - num(a, "rating"),
    baths: (a, b) => num(b, "baths") - num(a, "baths"),
    beds: (a, b) => num(b, "beds") - num(a, "beds"),
  };

  function save() {
    try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch {}
    const p = new URLSearchParams();
    if (state.view !== "list") p.set("view", state.view);
    if (state.ids.length) p.set("ids", state.ids.join(","));
    history.replaceState(null, "", p.toString() ? "?" + p : location.pathname);
  }

  function render() {
    const compare = state.view === "compare";
    board.classList.toggle("compare", compare);
    board.classList.toggle("list", !compare);
    document.querySelectorAll("[data-view]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));

    slots.sort(sorters[state.sort] || sorters.pp).forEach((s) => board.appendChild(s));

    const picked = new Set(state.ids);
    for (const s of slots) {
      const on = picked.has(s.dataset.id);
      s.querySelector(".pick").checked = on;
      s.classList.toggle("picked", on);
      const inArea = !state.area || s.dataset.area === state.area;
      s.hidden = !inArea || (compare && picked.size > 0 && !on);
    }
    count.textContent = picked.size
      ? `${picked.size} selected`
      : "Tick “Compare” to shortlist";
    sortSel.value = state.sort;
    areaSel.value = state.area;
    save();
  }

  document.querySelectorAll("[data-view]").forEach((b) =>
    b.addEventListener("click", () => { state.view = b.dataset.view; render(); }));
  sortSel.addEventListener("change", () => { state.sort = sortSel.value; render(); });
  areaSel.addEventListener("change", () => { state.area = areaSel.value; render(); });
  document.getElementById("clear").addEventListener("click", () => { state.ids = []; render(); });
  board.addEventListener("change", (e) => {
    if (!e.target.classList.contains("pick")) return;
    const id = e.target.closest(".slot").dataset.id;
    state.ids = e.target.checked ? [...new Set([...state.ids, id])] : state.ids.filter((x) => x !== id);
    render();
  });

  render();
})();
