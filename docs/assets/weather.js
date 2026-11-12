// Live forecast for the trip days. Two free, key-less, CORS-friendly sources:
//   - National Weather Service (api.weather.gov): the official US forecast, about 7 days out.
//     Used for the sky, high / low, chance of rain and the hourly row whenever it covers the day.
//   - Open-Meteo: model data up to 16 days out. Used for wind and sunset, and for any day the NWS
//     doesn't cover yet. (Its default model, GFS, tends to call light "drizzle" days the NWS doesn't.)
// Until either source reaches a day, it shows "预报尚未发布".
// Refreshes every 30 min and whenever the tab comes back into view.

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const NWS = "https://api.weather.gov";
const HOURS = [9, 12, 15, 18, 21];
const REFRESH_MS = 30 * 60 * 1000;

// WMO weather codes (Open-Meteo) → short Chinese labels
const CODES = [
  [[0], "晴"], [[1], "大致晴"], [[2], "局部多云"], [[3], "阴"],
  [[45, 48], "雾"],
  [[51, 53, 55], "毛毛雨"], [[56, 57], "冻毛毛雨"],
  [[61], "小雨"], [[63], "中雨"], [[65], "大雨"], [[66, 67], "冻雨"],
  [[71, 73, 75, 77], "雪"],
  [[80], "阵雨"], [[81], "中阵雨"], [[82], "强阵雨"], [[85, 86], "阵雪"],
  [[95], "雷雨"], [[96, 99], "雷雨伴冰雹"],
];
const codeLabel = (code) => CODES.find(([cs]) => cs.includes(code))?.[1] ?? "—";

// NWS short forecasts ("Partly Sunny then Slight Chance Light Rain") → Chinese
const WORDS = [
  ["Thunderstorms", "雷雨"], ["Showers", "阵雨"], ["Heavy Rain", "大雨"], ["Light Rain", "小雨"], ["Rain", "雨"],
  ["Drizzle", "毛毛雨"], ["Patchy Fog", "局部有雾"], ["Areas Of Fog", "局部有雾"], ["Fog", "雾"],
  ["Mostly Sunny", "大致晴"], ["Partly Sunny", "局部多云"], ["Mostly Clear", "大致晴"], ["Partly Cloudy", "局部多云"],
  ["Mostly Cloudy", "多云"], ["Cloudy", "阴"], ["Sunny", "晴"], ["Clear", "晴"], ["Breezy", "有风"], ["Windy", "大风"],
];
function nwsLabel(text = "") {
  return text.split(/\s+then\s+/i).map((part) => {
    let p = part.trim(), prefix = "";
    if (/^Slight Chance /i.test(p)) { prefix = "小概率"; p = p.replace(/^Slight Chance /i, ""); }
    else if (/^Chance /i.test(p)) { prefix = "可能有"; p = p.replace(/^Chance /i, ""); }
    if (/ Likely$/i.test(p)) { prefix = "很可能有"; p = p.replace(/ Likely$/i, ""); }
    p = p.replace(/ And /gi, " · ");
    for (const [en, zh] of WORDS) p = p.replace(new RegExp(`\\b${en}\\b`, "gi"), zh);
    return prefix + p;
  }).join("，转");
}
const rainy = (text) => /rain|shower|drizzle|thunder/i.test(text);

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
const hourKey = (day, h) => `${day}T${String(h).padStart(2, "0")}`;

async function fetchOpenMeteo({ lat, lng, start, end }) {
  const params = new URLSearchParams({
    latitude: lat, longitude: lng, timezone: "America/Los_Angeles",
    temperature_unit: "fahrenheit", wind_speed_unit: "mph",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunset",
    hourly: "temperature_2m,precipitation_probability",
    start_date: start, end_date: end,
  });
  const res = await fetch(`${OPEN_METEO}?${params}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.reason || `HTTP ${res.status}`);
  // Reshape into the same per-day / per-hour maps the NWS data uses
  const days = {}, hours = {};
  data.daily.time.forEach((t, i) => {
    if (data.daily.temperature_2m_max[i] == null) return;
    days[t] = {
      label: codeLabel(data.daily.weather_code[i]), wet: data.daily.weather_code[i] >= 51,
      high: data.daily.temperature_2m_max[i], low: data.daily.temperature_2m_min[i],
      pop: data.daily.precipitation_probability_max[i] ?? 0,
      wind: data.daily.wind_speed_10m_max[i], sunset: data.daily.sunset[i],
    };
  });
  data.hourly.time.forEach((t, i) => {
    if (data.hourly.temperature_2m[i] != null) hours[t.slice(0, 13)] = { temp: data.hourly.temperature_2m[i], pop: data.hourly.precipitation_probability[i] ?? 0 };
  });
  return { days, hours };
}

async function fetchNWS({ lat, lng }) {
  const get = async (url) => {
    const r = await fetch(url, { headers: { Accept: "application/geo+json" }, cache: "no-store" });
    if (!r.ok) throw new Error(`NWS HTTP ${r.status}`);
    return (await r.json()).properties;
  };
  const point = await get(`${NWS}/points/${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`);
  const [daily, hourly] = await Promise.all([get(point.forecast), get(point.forecastHourly)]);
  const days = {}, hours = {};
  for (const p of daily.periods) {
    const day = p.startTime.slice(0, 10); // local date (startTime carries the local offset)
    const pop = p.probabilityOfPrecipitation?.value ?? 0;
    if (p.isDaytime) {
      days[day] = { ...days[day], label: nwsLabel(p.shortForecast), wet: rainy(p.shortForecast) && pop >= 30, high: p.temperature, pop };
    } else if (days[day]) {
      days[day].low = p.temperature; // that evening's night period
    }
  }
  for (const p of hourly.periods) {
    hours[p.startTime.slice(0, 13)] = { temp: p.temperature, pop: p.probabilityOfPrecipitation?.value ?? 0 };
  }
  return { days, hours };
}

function dayCard(day, nws, om, esc) {
  const date = new Date(`${day}T12:00:00`);
  const head = `<div class="wx-day"><b>${date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</b>
    <span>${date.toLocaleDateString("zh-CN", { weekday: "short" })}</span></div>`;
  const n = nws?.days[day];
  const o = om?.days[day];
  const main = n && n.high != null ? n : o;
  if (!main) return `<article class="wx-card pending">${head}<p class="wx-pending">预报尚未发布</p></article>`;
  const low = main.low ?? o?.low;
  const hours = HOURS.map((h) => {
    const k = hourKey(day, h);
    const v = (main === n && nws.hours[k]) || om?.hours[k];
    if (!v) return "";
    return `<li><span>${hourLabel(h)}</span><b>${Math.round(v.temp)}°</b>
      <em${v.pop >= 30 ? ' class="hi"' : ""}>${v.pop}%</em></li>`;
  }).join("");
  return `<article class="wx-card${main.wet ? " wet" : ""}">
    ${head}
    <p class="wx-cond">${esc(main.label)}</p>
    <p class="wx-temp"><b>${Math.round(main.high)}°</b>${low != null ? `<span>/ ${Math.round(low)}°F</span>` : "<span>°F</span>"}</p>
    <dl class="wx-facts">
      <div><dt>降雨</dt><dd>${main.pop}%</dd></div>
      ${o?.wind != null ? `<div><dt>风</dt><dd>${Math.round(o.wind)} mph</dd></div>` : ""}
      ${o?.sunset ? `<div><dt>日落</dt><dd>${hhmm(o.sunset)}</dd></div>` : ""}
    </dl>
    ${hours ? `<ul class="wx-hours">${hours}</ul>` : ""}
  </article>`;
}

export function mountWeather(root, { lat, lng, start, end, esc }) {
  const days = daysBetween(start, end);
  let nws = null, om = null;
  let status = "加载中…";

  const render = () => {
    root.innerHTML = `<div class="wx-grid">${days.map((d) => dayCard(d, nws, om, esc)).join("")}</div>
      <p class="wx-status">${esc(status)}</p>`;
  };

  const load = async () => {
    const [n, o] = await Promise.allSettled([fetchNWS({ lat, lng }), fetchOpenMeteo({ lat, lng, start, end })]);
    if (n.status === "fulfilled") nws = n.value;
    if (o.status === "fulfilled") om = o.value;
    const usedNWS = nws && days.some((d) => nws.days[d]?.high != null);
    const when = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    status = n.status === "rejected" && o.status === "rejected"
      ? (nws || om ? "更新失败，显示上次结果" : "预报尚未发布")
      : `${usedNWS ? "美国国家气象局 NWS 预报" : "Open-Meteo 预报"} · 已更新 ${when}`;
    render();
  };

  render();
  load();
  setInterval(load, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
}
