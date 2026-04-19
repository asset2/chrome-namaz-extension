const CITIES = {
  almaty: {
    title: "Алматы",
    url: "https://sajda.com/ru/prayer-times/kazakhstan/almaty/1526384"
  },
  astana: {
    title: "Астана",
    url: "https://sajda.com/ru/prayer-times/kazakhstan/astana/1526273"
  },
  shymkent: {
    title: "Шымкент",
    url: "https://sajda.com/ru/prayer-times/kazakhstan/shymkent/1518980"
  }
};

const PRAYER_ORDER = [
  { key: "Фаджр", aliases: ["Фаджр"] },
  { key: "Восход", aliases: ["Восход"] },
  { key: "Зухр", aliases: ["Зухр"] },
  { key: "Аср", aliases: ["Аср"] },
  { key: "Магриб", aliases: ["Магриб"] },
  { key: "Иша", aliases: ["Иша"] }
];

const statusEl = document.getElementById("status");
const contentEl = document.getElementById("content");
const nextPrayerBlockEl = document.getElementById("nextPrayerBlock");
const nextPrayerNameEl = document.getElementById("nextPrayerName");
const nextPrayerTimeEl = document.getElementById("nextPrayerTime");
const countdownEl = document.getElementById("countdown");
const todayDetailsEl = document.getElementById("todayDetails");
const todayListEl = document.getElementById("todayList");
const refreshBtn = document.getElementById("refreshBtn");
const citySelectEl = document.getElementById("citySelect");
const cityTitleEl = document.getElementById("cityTitle");
const sourceLinkEl = document.getElementById("sourceLink");

let liveTimer = null;
let currentSchedule = null;
let selectedCity = "almaty";

refreshBtn.addEventListener("click", () => {
  loadSchedule();
});

citySelectEl.addEventListener("change", async () => {
  selectedCity = citySelectEl.value;
  syncCityMeta();
  await chrome.storage.local.set({ selectedCity });
  loadSchedule();
});

document.addEventListener("DOMContentLoaded", () => {
  initialize();
});

async function initialize() {
  const saved = await chrome.storage.local.get(["selectedCity"]);
  if (saved.selectedCity && CITIES[saved.selectedCity]) {
    selectedCity = saved.selectedCity;
  }

  citySelectEl.value = selectedCity;
  syncCityMeta();
  loadSchedule();
}

function syncCityMeta() {
  const city = CITIES[selectedCity] || CITIES.almaty;
  cityTitleEl.textContent = city.title;
  sourceLinkEl.href = city.url;
}

async function loadSchedule() {
  clearLiveTimer();
  setLoadingState();

  try {
    const html = await fetchHtml();
    const schedule = extractTodaySchedule(html);
    const nextPrayer = findNextPrayer(schedule, new Date());

    if (!nextPrayer) {
      throw new Error("Не удалось определить следующий намаз");
    }

    currentSchedule = schedule;
    renderSchedule(schedule, nextPrayer);
    startCountdown(nextPrayer);

    await chrome.storage.local.set({
      [getScheduleCacheKey()]: schedule,
      [getUpdatedAtCacheKey()]: new Date().toISOString()
    });
  } catch (error) {
    showError(error.message || "Ошибка загрузки данных");

    const scheduleKey = getScheduleCacheKey();
    const updatedAtKey = getUpdatedAtCacheKey();
    const cached = await chrome.storage.local.get([scheduleKey, updatedAtKey]);
    if (cached[scheduleKey]) {
      const fallbackNextPrayer = findNextPrayer(cached[scheduleKey], new Date());
      if (fallbackNextPrayer) {
        renderSchedule(cached[scheduleKey], fallbackNextPrayer, cached[updatedAtKey]);
        startCountdown(fallbackNextPrayer);
      }
    }
  }
}

async function fetchHtml() {
  const city = CITIES[selectedCity] || CITIES.almaty;
  const response = await fetch(city.url, { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Сайт вернул ошибку: ${response.status}`);
  }
  return response.text();
}

function extractTodaySchedule(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const dayNames = ["вск", "пнд", "втр", "срд", "чтв", "птн", "сбт"];
  const now = new Date();
  const day = String(now.getDate());
  const month = now.toLocaleString("ru-RU", { month: "long" }).toLowerCase();
  const shortDay = dayNames[now.getDay()];

  const rowRegex = new RegExp(`${month}\\s+${day}\\s*${shortDay}\\s+((?:\\d{2}:\\d{2}\\s+){6}\\d{2}:\\d{2})`, "i");
  const rowMatch = text.match(rowRegex);

  let times = [];

  if (rowMatch) {
    times = rowMatch[1].trim().split(/\s+/);
  } else {
    times = parseFromFaqLine(text);
  }

  if (times.length < 6) {
    throw new Error("Не удалось распарсить времена намаза на сегодня");
  }

  const normalized = PRAYER_ORDER.map((prayer, index) => ({
    name: prayer.key,
    time: times[index]
  }));

  return normalized;
}

function parseFromFaqLine(text) {
  const regex = /Фаджр\s+(\d{2}:\d{2}).*?Восход\s+(\d{2}:\d{2}).*?Зухр\s+(\d{2}:\d{2}).*?Аср\s+(\d{2}:\d{2}).*?Магриб\s+(\d{2}:\d{2}).*?Иша\s+(\d{2}:\d{2})/i;
  const match = text.match(regex);
  if (!match) {
    return [];
  }

  return match.slice(1, 7);
}

function findNextPrayer(schedule, now) {
  const today = new Date(now);

  for (const item of schedule) {
    const prayerDate = toDate(today, item.time);
    if (prayerDate > now) {
      return {
        ...item,
        date: prayerDate
      };
    }
  }

  const tomorrowFirst = toDate(new Date(today.getTime() + 24 * 60 * 60 * 1000), schedule[0].time);
  return {
    ...schedule[0],
    date: tomorrowFirst
  };
}

function toDate(baseDate, hhmm) {
  const [hh, mm] = hhmm.split(":").map(Number);
  const d = new Date(baseDate);
  d.setHours(hh, mm, 0, 0);
  return d;
}

function renderSchedule(schedule, nextPrayer, updatedAt) {
  contentEl.classList.remove("loading", "error");
  statusEl.textContent = updatedAt
    ? `Показаны последние сохранённые данные (${formatUpdatedAt(updatedAt)})`
    : "Расписание загружено";

  nextPrayerBlockEl.classList.remove("hidden");
  todayDetailsEl.classList.remove("hidden");
  nextPrayerNameEl.textContent = nextPrayer.name;
  nextPrayerTimeEl.textContent = nextPrayer.time;

  todayListEl.innerHTML = "";
  schedule.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${item.name}</span><strong>${item.time}</strong>`;
    todayListEl.appendChild(li);
  });

  updateCountdown(nextPrayer);
}

function startCountdown(nextPrayer) {
  updateCountdown(nextPrayer);
  liveTimer = setInterval(() => {
    const latestNext = findNextPrayer(currentSchedule, new Date());
    nextPrayerNameEl.textContent = latestNext.name;
    nextPrayerTimeEl.textContent = latestNext.time;
    updateCountdown(latestNext);
  }, 1000);
}

function updateCountdown(nextPrayer) {
  const now = new Date();
  const diffMs = nextPrayer.date.getTime() - now.getTime();
  if (diffMs <= 0) {
    countdownEl.textContent = "До намаза: сейчас";
    return;
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  countdownEl.textContent = `До намаза: ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function setLoadingState() {
  contentEl.classList.remove("error");
  statusEl.textContent = "Загружаю расписание...";
  nextPrayerBlockEl.classList.add("hidden");
  todayDetailsEl.classList.add("hidden");
}

function showError(message) {
  contentEl.classList.add("error");
  statusEl.textContent = `Ошибка: ${message}`;
}

function clearLiveTimer() {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
}

function pad(num) {
  return String(num).padStart(2, "0");
}

function formatUpdatedAt(iso) {
  const date = new Date(iso);
  return date.toLocaleString("ru-RU", { hour12: false });
}

function getScheduleCacheKey() {
  return `lastSchedule_${selectedCity}`;
}

function getUpdatedAtCacheKey() {
  return `updatedAt_${selectedCity}`;
}
