// Live forecast for the trip days from Open-Meteo (free, no key, CORS-friendly).
// Forecasts reach 16 days out; until then each day shows "预报尚未发布".
// Refreshes every 30 min and whenever the tab comes back into view.

const API = "https://api.open-meteo.com/v1/forecast";
const HOURS = [9, 12, 15, 18, 21];
const REFRESH_MS = 30 * 60 * 1000;

// WMO weather codes → short Chinese labels
const CODES = [
  [[0], "晴"], [[1], "大致晴"], [[2], "局部多云"], [[3], "阴"],
  [[45, 48], "雾"],
  [[51, 53, 55], "毛毛雨"], [[56, 57], "冻毛毛雨"],
  [[61], "小雨"], [[63], "中雨"], [[65], "大雨"], [[66, 67], "冻雨"],
  [[71, 73, 75, 77], "雪"],
  [[80], "阵雨"], [[81], "中阵雨"], [[82], "强阵雨"], [[85, 86], "阵雪"],
  [[95], "雷雨"], [[96, 99], "雷雨伴冰雹"],
];
const label = (code) => CODES.find(([cs]) => cs.includes(code))?.[1] ?? "—";
const wet = (code) => code >= 51;

// Every date from start to end inclusive, as YYYY-MM-DD
function daysBetween(start, end) {
  const out = [];
  for (let t = Date.parse(`${start}T12:00:00Z`); t <= Date.parse(`${end}T12:00:00Z`); t += 864e5) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const hhmm = (iso) => {
  const [h, m] = iso.slice(11, 16).split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;

async function fetchForecast({ lat, lng, start, end }) {
  const params = new URLSearchParams({
    latitude: lat, longitude: lng, timezone: "America/Los_Angeles",
    temperature_unit: "fahrenheit", wind_speed_unit: "mph",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunset",
    hourly: "temperature_2m,weather_code,precipitation_probability",
    start_date: start, end_date: end,
  });
  const res = await fetch(`${API}?${params}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.reason || `HTTP ${res.status}`);
  return data;
}

function dayCard(day, data, esc) {
  const date = new Date(`${day}T12:00:00`);
  const head = `<div class="wx-day"><b>${date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</b>
    <span>${date.toLocaleDateString("zh-CN", { weekday: "short" })}</span></div>`;
  const i = data?.daily?.time.indexOf(day) ?? -1;
  const d = data?.daily;
  if (i < 0 || d.temperature_2m_max[i] == null) {
    return `<article class="wx-card pending">${head}<p class="wx-pending">预报尚未发布</p></article>`;
  }
  const code = d.weather_code[i];
  const hours = HOURS.map((h) => {
    const j = data.hourly.time.indexOf(`${day}T${String(h).padStart(2, "0")}:00`);
    if (j < 0 || data.hourly.temperature_2m[j] == null) return "";
    const rain = data.hourly.precipitation_probability[j];
    return `<li><span>${hourLabel(h)}</span><b>${Math.round(data.hourly.temperature_2m[j])}°</b>
      <em${rain >= 30 ? ' class="hi"' : ""}>${rain ?? 0}%</em></li>`;
  }).join("");
  return `<article class="wx-card${wet(code) ? " wet" : ""}">
    ${head}
    <p class="wx-cond">${esc(label(code))}</p>
    <p class="wx-temp"><b>${Math.round(d.temperature_2m_max[i])}°</b><span>/ ${Math.round(d.temperature_2m_min[i])}°F</span></p>
    <dl class="wx-facts">
      <div><dt>降雨</dt><dd>${d.precipitation_probability_max[i] ?? 0}%</dd></div>
      <div><dt>风</dt><dd>${Math.round(d.wind_speed_10m_max[i])} mph</dd></div>
      <div><dt>日落</dt><dd>${hhmm(d.sunset[i])}</dd></div>
    </dl>
    ${hours ? `<ul class="wx-hours">${hours}</ul>` : ""}
  </article>`;
}

export function mountWeather(root, { lat, lng, start, end, esc }) {
  const days = daysBetween(start, end);
  let data = null;
  let status = "加载中…";

  const render = () => {
    root.innerHTML = `<div class="wx-grid">${days.map((d) => dayCard(d, data, esc)).join("")}</div>
      <p class="wx-status">${esc(status)}</p>`;
  };

  const load = async () => {
    try {
      data = await fetchForecast({ lat, lng, start, end });
      status = `已更新 · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
    } catch (err) {
      // The API refuses dates beyond its 16-day window; show every day as pending until then
      status = data ? "更新失败，显示上次结果" : "预报尚未发布";
    }
    render();
  };

  render();
  load();
  setInterval(load, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
}
