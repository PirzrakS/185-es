/* Расписание группы: база из ./schedule.json, замены по датам из ./overrides.json */
(() => {
  "use strict";

  const DATA_URL = "./schedule.json";
  const OVERRIDES_URL = "./overrides.json";
  const ADMIN_KEY = "schedule-185es:admin";
  const DRAFT_KEY = "schedule-185es:draft-v1";
  const MONTHS = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];
  const DAYS = [
    { key: "mon", full: "Понедельник" },
    { key: "tue", full: "Вторник" },
    { key: "wed", full: "Среда" },
    { key: "thu", full: "Четверг" },
    { key: "fri", full: "Пятница" },
    { key: "sat", full: "Суббота" },
  ];

  const $ = (selector) => document.querySelector(selector);

  const refs = {
    brand: $("#brand"),
    badge: $("#badge"),
    groupName: $("#groupName"),
    groupSub: $("#groupSub"),
    grid: $("#grid"),
    weekStatus: $("#weekStatus"),
    weekDates: $("#weekDates"),
    weekSummary: $("#weekSummary"),
    overrideChip: $("#overrideChip"),
    draftChip: $("#draftChip"),
    nowCard: $("#nowCard"),
    nowLabel: $("#nowLabel"),
    nowTitle: $("#nowTitle"),
    nowMeta: $("#nowMeta"),
    nowNext: $("#nowNext"),
    hint: $("#hint"),
    editToggle: $("#editToggle"),
    editLabel: $("#editLabel"),
    loadState: $("#loadState"),
    loadStateText: $("#loadStateText"),
    retryBtn: $("#retryBtn"),
    adminStatus: $("#adminStatus"),
    editor: $("#editor"),
    editorForm: $("#editorForm"),
    editorTitle: $("#editorTitle"),
    editorDelete: $("#editorDelete"),
    toast: $("#toast"),
    fSubject: $("#fSubject"),
    fTime: $("#fTime"),
    fRoom: $("#fRoom"),
    fTeacher: $("#fTeacher"),
    fAltSubject: $("#fAltSubject"),
    fAltTeacher: $("#fAltTeacher"),
    fAltRoom: $("#fAltRoom"),
    teacherField: $("#teacherField"),
    subjectNote: $("#subjectNote"),
    altBlock: $("#altBlock"),
    labelSubject: $("#labelSubject"),
    labelRoom: $("#labelRoom"),
  };

  let data = null;
  let overrides = {};
  let weeklyExtras = {};
  let viewWeek = 1;
  let editMode = false;
  let editing = null;
  let isAdmin = false;
  let dirtyBase = false;
  let dirtyOverrides = false;
  let downloaded = false;
  let hasDraft = false;
  let toastTimer = 0;

  /* ---------- Утилиты ---------- */
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showToast(message) {
    refs.toast.textContent = message;
    refs.toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => refs.toast.classList.remove("is-visible"), 2800);
  }

  function hoursText(hours) {
    return Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(".", ",");
  }

  const clone = (value) => JSON.parse(JSON.stringify(value));

  /* ---------- Нормализация ---------- */
  function normalizePair(raw) {
    const n = Number(raw && raw.n);
    const alt = raw && raw.alt && raw.alt.subject
      ? {
          subject: String(raw.alt.subject),
          teacher: String(raw.alt.teacher || ""),
          room: String(raw.alt.room || ""),
        }
      : null;
    return {
      n: Number.isFinite(n) && n > 0 ? n : 1,
      time: String((raw && raw.time) || ""),
      subject: String((raw && raw.subject) || ""),
      teacher: String((raw && raw.teacher) || ""),
      room: String((raw && raw.room) || ""),
      alt,
    };
  }

  function normalizeExtra(raw) {
    return {
      time: String((raw && raw.time) || ""),
      title: String((raw && raw.title) || ""),
      place: String((raw && raw.place) || ""),
    };
  }

  function normalizeData(raw) {
    if (!raw || typeof raw !== "object" || !raw.weeks) {
      throw new Error("в файле нет объекта weeks");
    }
    const sourceBells = raw.bells;
    if (!sourceBells || !Array.isArray(sourceBells.pairs) || !sourceBells.pairs.length || !sourceBells.third) {
      throw new Error("в файле нет блока bells со звонками");
    }
    const bells = {
      pairs: sourceBells.pairs.map(String),
      third: {
        normal: String(sourceBells.third.normal || ""),
        mathLast: String(sourceBells.third.mathLast || ""),
        saturday: String(sourceBells.third.saturday || ""),
      },
      fourth: {
        normal: String((sourceBells.fourth && sourceBells.fourth.normal) || sourceBells.pairs[3] || ""),
        saturday: String((sourceBells.fourth && sourceBells.fourth.saturday) || ""),
      },
      mathPattern: String(sourceBells.mathPattern || "математик"),
    };

    const refMonday = String(raw.refMonday || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(refMonday)) {
      throw new Error("в файле нет корректной даты refMonday");
    }

    const weeks = {};
    ["1", "2"].forEach((week) => {
      const weekSource = raw.weeks[week] || {};
      weeks[week] = {};
      DAYS.forEach((day) => {
        const daySource = weekSource[day.key] || {};
        weeks[week][day.key] = {
          extras: Array.isArray(daySource.extras) ? daySource.extras.map(normalizeExtra) : [],
          pairs: Array.isArray(daySource.pairs) ? daySource.pairs.map(normalizePair) : [],
        };
        weeks[week][day.key].pairs.sort((a, b) => a.n - b.n);
      });
    });

    return {
      version: Number(raw.version) || 1,
      group: String(raw.group || "Расписание"),
      short: String(raw.short || String(raw.group || "").split(" ")[0] || "?"),
      specialty: String(raw.specialty || ""),
      semester: String(raw.semester || ""),
      refMonday,
      bells,
      weeks,
    };
  }

  function normalizeExtrasMap(raw) {
    const result = {};
    DAYS.forEach((day) => {
      const list = raw && Array.isArray(raw[day.key]) ? raw[day.key].map(normalizeExtra) : [];
      result[day.key] = list;
    });
    return result;
  }

  function extrasFromSchedule(schedule) {
    const result = {};
    DAYS.forEach((day) => {
      const first = schedule.weeks["1"] && schedule.weeks["1"][day.key] ? schedule.weeks["1"][day.key].extras : [];
      const second = schedule.weeks["2"] && schedule.weeks["2"][day.key] ? schedule.weeks["2"][day.key].extras : [];
      const source = first && first.length ? first : second || [];
      result[day.key] = clone(source);
    });
    return result;
  }

  function normalizeOverrides(raw) {
    const result = { weeklyExtras: null, byDate: {} };
    if (!raw || typeof raw !== "object") return result;

    if (raw.weeklyExtras && typeof raw.weeklyExtras === "object") {
      result.weeklyExtras = normalizeExtrasMap(raw.weeklyExtras);
    }

    const source = raw.overrides && typeof raw.overrides === "object" ? raw.overrides : {};
    Object.entries(source).forEach(([iso, value]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
      if (!value || typeof value !== "object") return;
      const pairs = Array.isArray(value.pairs) ? value.pairs.map(normalizePair) : [];
      pairs.sort((a, b) => a.n - b.n);
      result.byDate[iso] = {
        note: String(value.note || ""),
        pairs,
        extras: Array.isArray(value.extras) ? value.extras.map(normalizeExtra) : undefined,
      };
    });
    return result;
  }

  function weekOf(week) {
    const source = data.weeks[String(week)] || data.weeks["1"];
    DAYS.forEach((day) => {
      if (!source[day.key]) source[day.key] = { extras: [], pairs: [] };
      if (!Array.isArray(source[day.key].pairs)) source[day.key].pairs = [];
      if (!Array.isArray(source[day.key].extras)) source[day.key].extras = [];
    });
    return source;
  }

  /* ---------- Даты ---------- */
  function parseISO(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(date, count) {
    const next = new Date(date.getTime());
    next.setDate(next.getDate() + count);
    return next;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function startOfToday() {
    return startOfDay(new Date());
  }

  function isoOf(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function dayIndexForDate(date) {
    const day = date.getDay();
    return day === 0 ? -1 : day - 1;
  }

  function weekIndexNow() {
    const ref = parseISO(data.refMonday);
    const diffDays = Math.round((startOfToday() - ref) / 86400000);
    return Math.floor(diffDays / 7);
  }

  function parityOf(index) {
    return ((index % 2) + 2) % 2 === 0 ? 1 : 2;
  }

  function currentWeekNumber() {
    return parityOf(weekIndexNow());
  }

  function weekForDate(date) {
    const ref = parseISO(data.refMonday);
    const diffDays = Math.round((startOfDay(date) - ref) / 86400000);
    return parityOf(Math.floor(diffDays / 7));
  }

  function mondayForWeek(week) {
    const ref = parseISO(data.refMonday);
    const index = weekIndexNow();
    const monday = addDays(ref, index * 7);
    return parityOf(index) === week ? monday : addDays(monday, 7);
  }

  function isSameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function formatRange(monday) {
    const saturday = addDays(monday, 5);
    if (monday.getMonth() === saturday.getMonth()) {
      return `${monday.getDate()}–${saturday.getDate()} ${MONTHS[monday.getMonth()]}`;
    }
    return `${monday.getDate()} ${MONTHS[monday.getMonth()]} – ${saturday.getDate()} ${MONTHS[saturday.getMonth()]}`;
  }

  function formatDay(date) {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    return `${dd}.${mm}`;
  }

  /* ---------- План на конкретную дату: замены важнее базы ---------- */
  function basePlanForDate(date) {
    const index = dayIndexForDate(date);
    if (index < 0) return { extras: [], pairs: [] };
    const week = data.weeks[String(weekForDate(date))];
    return week ? week[DAYS[index].key] : { extras: [], pairs: [] };
  }

  function planForDate(date) {
    const index = dayIndexForDate(date);
    const base = basePlanForDate(date);
    const override = overrides[isoOf(date)] || null;
    const dayKey = index >= 0 ? DAYS[index].key : null;
    const extras = dayKey ? weeklyExtras[dayKey] || [] : [];

    if (override) {
      return {
        pairs: override.pairs.slice().sort((a, b) => a.n - b.n),
        extras: Array.isArray(override.extras) ? override.extras : extras,
        override,
        base,
      };
    }

    return {
      pairs: base.pairs,
      extras,
      override: null,
      base,
    };
  }

  /* ---------- Время пар по звонкам ---------- */
  function isMathSubject(subject) {
    return new RegExp(data.bells.mathPattern, "i").test(String(subject || ""));
  }

  /* Время зависит от номера пары и от состава дня:
     особые 12:10–13:40 бывают только когда математика — последняя пара. */
  function slotTime(dayKey, n, pairs) {
    const bells = data.bells;
    const saturday = dayKey === "sat";

    if (n === 1 || n === 2) return bells.pairs[n - 1] || "";

    if (n === 3) {
      if (saturday) return bells.third.saturday;
      const last = pairs.reduce((acc, item) => (!acc || item.n > acc.n ? item : acc), null);
      const mathLast = Boolean(last && last.n === 3 && isMathSubject(last.subject));
      return mathLast ? bells.third.mathLast : bells.third.normal;
    }

    if (n === 4) return saturday ? bells.fourth.saturday : bells.fourth.normal;
    return "";
  }

  function knownTimes() {
    const set = new Set();
    data.bells.pairs.forEach((time) => set.add(time));
    Object.values(data.bells.third).forEach((time) => set.add(time));
    Object.values(data.bells.fourth).forEach((time) => set.add(time));
    return set;
  }

  /* Пересчитывает стандартные времена, не трогая вручную введённые. */
  function applyDayTimes(dayKey, pairs, edited, typedTime) {
    if (!dayKey) return;
    const sorted = pairs.slice().sort((a, b) => a.n - b.n);
    const known = knownTimes();

    sorted.forEach((pair) => {
      const expected = slotTime(dayKey, pair.n, sorted);
      if (pair === edited) {
        pair.time = !typedTime || known.has(typedTime) ? expected : typedTime;
      } else if (!pair.time || known.has(pair.time)) {
        pair.time = expected;
      }
    });
  }

  function recalcWeekTimes(week) {
    DAYS.forEach((day) => {
      const pairs = week[day.key].pairs.slice().sort((a, b) => a.n - b.n);
      pairs.forEach((pair) => {
        pair.time = slotTime(day.key, pair.n, pairs);
      });
    });
  }

  function timeForNewPair(dayKey, list, n) {
    const probe = { n, subject: "" };
    const sorted = list.concat([probe]).sort((a, b) => a.n - b.n);
    return slotTime(dayKey, n, sorted);
  }

  /* ---------- Разбор времени ---------- */
  function parseRange(time) {
    const match = /(\d{1,2})[:.](\d{2})\s*[–—−-]\s*(\d{1,2})[:.](\d{2})/.exec(String(time || ""));
    if (!match) return null;
    return {
      start: Number(match[1]) * 60 + Number(match[2]),
      end: Number(match[3]) * 60 + Number(match[4]),
    };
  }

  function formatMinutes(total) {
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return `${hours}:${String(minutes).padStart(2, "0")}`;
  }

  /* ---------- Статус загрузки ---------- */
  function setStatus(state, error) {
    if (state === "ready") {
      refs.loadState.hidden = true;
      refs.grid.hidden = false;
      return;
    }
    refs.nowCard.hidden = true;
    refs.overrideChip.hidden = true;
    refs.loadState.hidden = false;
    refs.grid.hidden = true;
    refs.weekStatus.textContent = state === "loading" ? "Загрузка…" : "Нет данных";
    refs.weekStatus.classList.remove("is-other");
    refs.weekDates.textContent = "";
    refs.weekSummary.textContent = "";
    refs.retryBtn.hidden = state !== "error";
    refs.loadStateText.textContent =
      state === "loading"
        ? "Загружаем расписание…"
        : "Не удалось загрузить расписание. Проверьте соединение и попробуйте ещё раз.";
    if (error) console.error("schedule:", error);
  }

  /* ---------- Загрузка ---------- */
  async function fetchJson(url) {
    const response = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }

  function applyDraft(draft) {
    data = normalizeData(draft.schedule);
    const parsed = normalizeOverrides(draft.overrides);
    overrides = parsed.byDate;
    weeklyExtras = parsed.weeklyExtras || extrasFromSchedule(data);
    subjectIndex = null;
    viewWeek = currentWeekNumber();
    hasDraft = true;
  }

  async function loadSchedule({ notify = false, ignoreDraft = false } = {}) {
    setStatus("loading");
    try {
      const [scheduleRaw, overridesRaw] = await Promise.all([
        fetchJson(DATA_URL),
        fetchJson(OVERRIDES_URL).catch((error) => {
          console.warn("overrides.json не загружен, работаем без замен:", error);
          return null;
        }),
      ]);

      data = normalizeData(scheduleRaw);
      const parsedOverrides = normalizeOverrides(overridesRaw);
      overrides = parsedOverrides.byDate;
      weeklyExtras = parsedOverrides.weeklyExtras || extrasFromSchedule(data);
      subjectIndex = null;
      viewWeek = currentWeekNumber();

      hasDraft = false;
      let draftApplied = false;
      if (isAdmin && !ignoreDraft) {
        const draft = readDraft();
        if (draft) {
          try {
            applyDraft(draft);
            draftApplied = true;
          } catch (error) {
            console.warn("Черновик повреждён, отбрасываю:", error);
            clearDraft();
          }
        }
      }

      dirtyBase = false;
      dirtyOverrides = false;
      downloaded = false;
      applyMeta();
      setStatus("ready");
      render();

      if (draftApplied) showToast("Открыт сохранённый черновик");
      else if (notify) showToast("Данные загружены из файлов");
    } catch (error) {
      if (isAdmin) {
        const draft = readDraft();
        if (draft) {
          try {
            applyDraft(draft);
            dirtyBase = false;
            dirtyOverrides = false;
            applyMeta();
            setStatus("ready");
            render();
            showToast("Файлы недоступны — открыт черновик из браузера");
            return;
          } catch (draftError) {
            console.warn("Черновик повреждён:", draftError);
          }
        }
      }
      data = null;
      overrides = {};
      hasDraft = false;
      setStatus("error", error);
    }
  }

  function applyMeta() {
    if (!data) return;
    document.title = `Расписание ${data.group}`;
    refs.groupName.textContent = `Группа ${data.group}`;
    refs.groupSub.textContent = [data.specialty, data.semester].filter(Boolean).join(" · ");
    refs.badge.textContent = data.short;
  }

  /* ---------- Виджет «сейчас идёт / следующая пара» ---------- */
  function setNow(label, title, meta, next) {
    refs.nowLabel.textContent = label;
    refs.nowTitle.textContent = title;
    refs.nowMeta.textContent = meta;
    refs.nowNext.textContent = next;
  }

  function todayInfo(date, plan) {
    if (dayIndexForDate(date) < 0) return { kind: "dayoff" };

    const items = plan.pairs
      .map((pair) => ({ pair, range: parseRange(pair.time) }))
      .filter((entry) => entry.range)
      .sort((a, b) => a.range.start - b.range.start);

    if (!items.length) return { kind: "empty" };

    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const current = items.find((entry) => minutes >= entry.range.start && minutes < entry.range.end) || null;
    const next = items.find((entry) => entry.range.start > minutes) || null;

    return { kind: "normal", items, current, next, minutes };
  }

  function renderNow() {
    if (!data) {
      refs.nowCard.hidden = true;
      refs.overrideChip.hidden = true;
      return;
    }

    const today = startOfToday();
    const plan = planForDate(today);
    const isOverride = Boolean(plan.override);
    const state = todayInfo(today, plan);

    refs.nowCard.hidden = false;
    refs.overrideChip.hidden = !isOverride;
    refs.nowCard.classList.toggle("is-override", isOverride);
    refs.nowCard.classList.toggle("is-live", state.kind === "normal" && Boolean(state.current));

    if (state.kind === "dayoff") {
      setNow("Сегодня", "Воскресенье", "Занятий нет", "");
      return;
    }

    if (state.kind === "empty") {
      if (isOverride) {
        setNow("Сегодня", "Пары отменены", plan.override.note || "На этот день назначена замена", "");
      } else {
        setNow("Сегодня", "Пар нет", "Свободный день", "");
      }
      return;
    }

    const { current, next, minutes, items } = state;
    const last = items[items.length - 1];

    if (current) {
      const left = Math.max(0, current.range.end - minutes);
      const parts = [
        current.pair.room ? `каб. ${current.pair.room}` : "",
        `до ${formatMinutes(current.range.end)}`,
        `ещё ${left} мин`,
      ].filter(Boolean);

      const nextText = next
        ? `Далее: ${next.pair.n} пара · ${formatMinutes(next.range.start)} · ${next.pair.subject}${next.pair.room ? ` · ${next.pair.room}` : ""}`
        : "Последняя пара на сегодня";

      setNow("Сейчас идёт", `${current.pair.n} пара · ${current.pair.subject}`, parts.join(" · "), nextText);
      return;
    }

    if (next) {
      const left = Math.max(0, next.range.start - minutes);
      const parts = [
        `в ${formatMinutes(next.range.start)}`,
        next.pair.room ? `каб. ${next.pair.room}` : "",
        `через ${left} мин`,
      ].filter(Boolean);
      const beforeFirst = minutes < items[0].range.start;
      setNow(
        beforeFirst ? "Скоро начало" : "Перемена",
        `${next.pair.n} пара · ${next.pair.subject}`,
        parts.join(" · "),
        ""
      );
      return;
    }

    setNow(
      "На сегодня всё",
      "Занятия закончились",
      `Последняя пара — до ${formatMinutes(last.range.end)}`,
      ""
    );
  }

  /* ---------- Отрисовка ---------- */
  function pairHtml(dateISO, item, index, editable) {
    const alt = item.alt && item.alt.subject ? item.alt : null;
    const altText = alt
      ? `2-я подгруппа: <b>${esc(alt.subject)}</b>${alt.room ? ` · ${esc(alt.room)}` : ""}`
      : "";
    const actions = editable
      ? `<div class="pair-actions edit-only">
          <button class="icon-btn" type="button" data-act="edit" data-kind="pair"
            data-date="${dateISO}" data-idx="${index}" aria-label="Изменить пару ${esc(item.n)}">✎</button>
          <button class="icon-btn danger" type="button" data-act="delete" data-kind="pair"
            data-date="${dateISO}" data-idx="${index}" aria-label="Удалить пару ${esc(item.n)}">✕</button>
        </div>`
      : "";

    return `
      <li class="pair">
        <span class="pair-num">${esc(item.n)}</span>
        <div class="pair-body">
          <p class="pair-subject">${esc(item.subject)}</p>
          <p class="pair-meta">
            <span class="pair-time">${esc(item.time)}</span>
            ${item.room ? `<span class="pair-room">${esc(item.room)}</span>` : ""}
            ${item.teacher ? `<span class="pair-teacher">${esc(item.teacher)}</span>` : ""}
          </p>
          ${altText ? `<p class="pair-alt">${altText}</p>` : ""}
        </div>
        ${actions}
      </li>`;
  }

  function extraHtml(dateISO, item, index, editable) {
    const actions = editable
      ? `<button class="icon-btn edit-only" type="button" data-act="edit" data-kind="extra"
          data-date="${dateISO}" data-idx="${index}" aria-label="Изменить внеурочку">✎</button>
        <button class="icon-btn danger edit-only" type="button" data-act="delete" data-kind="extra"
          data-date="${dateISO}" data-idx="${index}" aria-label="Удалить внеурочку">✕</button>`
      : "";

    return `
      <li class="extra">
        <span class="extra-time">${esc(item.time)}</span>
        <span class="extra-title">${esc(item.title)}</span>
        ${item.place ? `<span class="extra-place">${esc(item.place)}</span>` : ""}
        ${actions}
      </li>`;
  }

  function dayHtml(day, index, monday) {
    const date = addDays(monday, index);
    const iso = isoOf(date);
    const plan = planForDate(date);
    const isToday = viewWeek === currentWeekNumber() && isSameDay(date, startOfToday());
    const editable = isAdmin && editMode;

    const extras = plan.extras
      .map((item, idx) => ({ item, idx }))
      .map(({ item, idx }) => extraHtml(iso, item, idx, editable))
      .join("");

    const pairs = plan.pairs
      .map((item, idx) => ({ item, idx }))
      .sort((a, b) => a.item.n - b.item.n)
      .map(({ item, idx }) => pairHtml(iso, item, idx, editable))
      .join("");

    const emptyPairs = plan.pairs.length
      ? ""
      : `<p class="day-empty">${
          plan.override ? "Пары на этот день отменены" : editMode ? "Пар нет — добавьте ниже" : "Пар нет"
        }</p>`;

    let note = "";
    if (plan.override && plan.override.note) {
      note = `<p class="day-note">${esc(plan.override.note)}${
        editable
          ? ` <button class="note-edit" type="button" data-act="edit-note" data-date="${iso}">✎</button>`
          : ""
      }</p>`;
    } else if (plan.override && editable) {
      note = `<p class="day-note day-note-empty">Пояснение к замене <button class="note-edit" type="button" data-act="edit-note" data-date="${iso}">добавить</button></p>`;
    }

    const addRow = editable
      ? `<div class="add-row edit-only">
          <button class="add-btn" type="button" data-act="add" data-kind="pair" data-date="${iso}">+ пара</button>
          <button class="add-btn" type="button" data-act="add" data-kind="extra" data-date="${iso}">+ внеурочка</button>
          ${
            plan.override
              ? `<button class="add-btn add-btn-quiet" type="button" data-act="clear-override" data-date="${iso}">убрать замену</button>`
              : `<button class="add-btn add-btn-quiet" type="button" data-act="make-override" data-date="${iso}">заменить день</button>`
          }
        </div>`
      : "";

    return `
      <article class="day${isToday ? " is-today" : ""}${plan.override ? " is-override" : ""}" data-day="${day.key}">
        <header class="day-head">
          <h2>${day.full}${isToday ? '<span class="today-tag">сегодня</span>' : ""}${
            plan.override ? '<span class="override-tag">замена</span>' : ""
          }</h2>
          <span class="day-date">${formatDay(date)}</span>
        </header>
        ${extras ? `<ul class="extras">${extras}</ul>` : ""}
        ${note}
        <ol class="pairs">${pairs}</ol>
        ${emptyPairs}
        ${addRow}
      </article>`;
  }

  function updateAdminUi() {
    refs.editToggle.setAttribute("aria-pressed", String(editMode && isAdmin));
    refs.editLabel.textContent = editMode ? "Готово" : "Редактировать";
    const changed = [];
    if (dirtyBase) changed.push("расписание");
    if (dirtyOverrides) changed.push("замены");
    refs.adminStatus.textContent = changed.length
      ? `не сохранено: ${changed.join(", ")}`
      : downloaded
        ? "файлы скачаны — замените их в репозитории"
        : hasDraft
          ? "черновик сохранён в браузере"
          : "данные из файлов";
    refs.adminStatus.classList.toggle("is-dirty", changed.length > 0);
    if (refs.draftChip) refs.draftChip.hidden = !(hasDraft && isAdmin);
  }

  function render() {
    if (!data) return;
    const monday = mondayForWeek(viewWeek);
    const current = currentWeekNumber();

    refs.grid.innerHTML = DAYS.map((day, index) => dayHtml(day, index, monday)).join("");

    document.querySelectorAll(".week-btn").forEach((btn) => {
      btn.setAttribute("aria-selected", String(Number(btn.dataset.week) === viewWeek));
    });

    refs.weekStatus.textContent =
      viewWeek === current ? `Сейчас идёт ${current} неделя` : `Просмотр: ${viewWeek} неделя`;
    refs.weekStatus.classList.toggle("is-other", viewWeek !== current);
    refs.weekDates.textContent = formatRange(monday);

    const total = DAYS.reduce((sum, day, index) => {
      return sum + planForDate(addDays(monday, index)).pairs.length;
    }, 0);
    refs.weekSummary.textContent = total ? `${total} пар · ${hoursText(total * 1.5)} ч` : "Пар нет";

    const editingNow = isAdmin && editMode;
    document.body.classList.toggle("editing", editingNow);
    refs.hint.textContent = editMode
      ? "Режим редактирования: у пар и внеурочки есть ✎ и ✕. «Заменить день» делает замену на одну дату, «убрать замену» возвращает базовое расписание."
      : "Вы вошли как администратор: «Редактировать» — правка, «Сохранить» — черновик в браузере, «Скачать JSON» и «Скачать замены» — файлы для репозитория.";

    updateAdminUi();
    renderNow();
  }

  /* ---------- Админ-режим ---------- */
  function detectAdmin() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      if (params.get("admin") === "1") {
        sessionStorage.setItem(ADMIN_KEY, "1");
        return true;
      }
      return sessionStorage.getItem(ADMIN_KEY) === "1";
    } catch {
      return false;
    }
  }

  function setAdmin(value) {
    isAdmin = value;
    if (!value) editMode = false;
    document.body.classList.toggle("is-admin", value);
    document.body.classList.toggle("editing", value && editMode);
    try {
      if (value) sessionStorage.setItem(ADMIN_KEY, "1");
      else sessionStorage.removeItem(ADMIN_KEY);
    } catch {
      /* приватный режим */
    }

    if (data) {
      if (value && !hasDraft) {
        const draft = readDraft();
        if (draft) {
          try {
            applyDraft(draft);
            showToast("Открыт сохранённый черновик");
          } catch (error) {
            console.warn("Черновик повреждён:", error);
            clearDraft();
          }
        }
      }
      render();
    }
  }

  let secretClicks = 0;
  let secretTimer = 0;

  refs.brand.addEventListener("click", () => {
    if (isAdmin) return;
    secretClicks += 1;
    window.clearTimeout(secretTimer);
    secretTimer = window.setTimeout(() => {
      secretClicks = 0;
    }, 2200);
    if (secretClicks >= 5) {
      secretClicks = 0;
      setAdmin(true);
      showToast("Режим администратора включён");
    }
  });

  function markDirty(kind = "base") {
    if (kind === "overrides") dirtyOverrides = true;
    else {
      dirtyBase = true;
      subjectIndex = null;
    }
    downloaded = false;
    updateAdminUi();
  }

  function hasUnsaved() {
    return dirtyBase || dirtyOverrides;
  }

  /* ---------- Редактор базового расписания ---------- */
  function setEditorKind(kind) {
    const isPair = kind === "pair";
    refs.labelSubject.textContent = isPair ? "Предмет" : "Название";
    refs.labelRoom.textContent = isPair ? "Аудитория" : "Место";
    refs.fSubject.placeholder = isPair ? "Математика" : "Классный час";
    refs.fRoom.placeholder = isPair ? "122" : "актовый зал";
    refs.fTime.placeholder = isPair ? "8:30–10:00" : "8:00";
    refs.teacherField.hidden = !isPair;
    refs.altBlock.hidden = !isPair;
    if (refs.subjectNote) refs.subjectNote.hidden = !isPair;
    if (!isPair) refs.altBlock.open = false;
  }

  function dayKeyForDate(date) {
    const index = dayIndexForDate(date);
    return index < 0 ? null : DAYS[index].key;
  }

  function editTarget(dateISO, kind) {
    const key = kind === "pair" ? "pairs" : "extras";
    const override = overrides[dateISO];
    const dayKey = dayKeyForDate(parseISO(dateISO)) || "mon";

    if (override) {
      if (key === "extras" && !Array.isArray(override.extras)) {
        override.extras = clone(weeklyExtras[dayKey] || []);
      }
      if (!Array.isArray(override[key])) override[key] = [];
      return { kind, source: "overrides", dateISO, list: override[key] };
    }

    if (kind === "extra") {
      if (!Array.isArray(weeklyExtras[dayKey])) weeklyExtras[dayKey] = [];
      return { kind, source: "overrides", dateISO, list: weeklyExtras[dayKey] };
    }

    const list = dayKey ? weekOf(viewWeek)[dayKey][key] : [];
    return { kind, source: "base", dateISO, list };
  }

  const SUBJECT_ALIASES = {
    "матем": "математика",
    "математика": "математика",
    "приклад матем": "прикладная математика",
    "прикладная математика": "прикладная математика",
    "англ": "английский язык",
    "английский": "английский язык",
    "английский язык": "английский язык",
    "русский": "русский язык",
    "русский язык": "русский язык",
    "литр": "литература",
    "лит": "литература",
    "литература": "литература",
    "инфа": "информатика",
    "информатика": "информатика",
    "ист": "история",
    "история": "история",
    "физра": "физическая культура",
    "физ ра": "физическая культура",
    "физ-ра": "физическая культура",
    "физкультура": "физическая культура",
    "физическая культура": "физическая культура",
    "обзир": "обзр",
    "обзр": "обзр",
    "обж": "обзр",
    "общество": "обществознание",
    "обществознание": "обществознание",
    "хим": "химия",
    "химия": "химия",
    "опд": "основы проектной деятельности",
    "основы проектной деятельности": "основы проектной деятельности",
    "физика": "физика",
    "физ": "физика",
  };

  function normalizeSubject(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[.,;:()]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  let subjectIndex = null;

  function getSubjectIndex() {
    if (subjectIndex) return subjectIndex;
    const map = new Map();
    ["1", "2"].forEach((week) => {
      DAYS.forEach((day) => {
        data.weeks[week][day.key].pairs.forEach((pair) => {
          const key = normalizeSubject(pair.subject);
          if (!key) return;
          const entry = map.get(key) || { subject: pair.subject, teachers: new Map(), rooms: new Map() };
          if (pair.teacher) entry.teachers.set(pair.teacher, (entry.teachers.get(pair.teacher) || 0) + 1);
          if (pair.room) entry.rooms.set(pair.room, (entry.rooms.get(pair.room) || 0) + 1);
          map.set(key, entry);
        });
      });
    });
    subjectIndex = map;
    return map;
  }

  function pickMost(map) {
    let best = "";
    let max = -1;
    map.forEach((times, value) => {
      if (times > max) {
        best = value;
        max = times;
      }
    });
    return best;
  }

  function pickSubject(entry) {
    return {
      subject: entry.subject,
      teacher: pickMost(entry.teachers),
      room: pickMost(entry.rooms),
    };
  }

  function lookupSubject(query) {
    const normalized = normalizeSubject(query);
    if (normalized.length < 3) return null;

    const index = getSubjectIndex();
    const canonical = SUBJECT_ALIASES[normalized] || normalized;
    if (index.has(canonical)) return pickSubject(index.get(canonical));

    const matches = [];
    index.forEach((entry, key) => {
      if (key.startsWith(canonical) || canonical.startsWith(key)) matches.push(entry);
    });
    return matches.length === 1 ? pickSubject(matches[0]) : null;
  }

  refs.fSubject.addEventListener("input", () => {
    if (!editing || editing.kind !== "pair") return;

    const typed = refs.fSubject.value;
    const lookup = lookupSubject(typed);
    if (lookup) {
      if (lookup.teacher) refs.fTeacher.value = lookup.teacher;
      if (lookup.room) refs.fRoom.value = lookup.room;
    }

    const { dateISO, dayKey, index } = editing;
    const list = editTarget(dateISO, "pair").list;
    const existing = index >= 0 ? list[index] : null;
    const n = existing ? existing.n : list.reduce((max, entry) => Math.max(max, entry.n), 0) + 1;
    const probe = { n, subject: lookup ? lookup.subject : typed };
    const others = existing ? list.filter((entry) => entry !== existing) : list.slice();
    const sorted = others.concat([probe]).sort((a, b) => a.n - b.n);

    refs.fTime.value = slotTime(dayKey, n, sorted);
  });

  function openEditor(kind, dateISO, index) {
    if (!isAdmin || !data) return;
    const date = parseISO(dateISO);
    const dayKey = dayKeyForDate(date);
    if (!dayKey) return;

    const target = editTarget(dateISO, kind);
    const list = target.list;
    const isNew = index < 0;
    const item = isNew ? null : list[index];
    const suffix = target.source === "overrides" ? " · замена" : "";

    editing = { kind, dateISO, dayKey, index, source: target.source };
    setEditorKind(kind);

    refs.editorTitle.textContent = isNew
      ? `${kind === "pair" ? "Новая пара" : "Новая внеурочка"}${suffix}`
      : `${kind === "pair" ? "Пара" : "Внеурочка"}${suffix}`;
    refs.editorDelete.hidden = isNew;

    if (kind === "pair") {
      const nextNumber = isNew
        ? list.reduce((max, entry) => Math.max(max, entry.n), 0) + 1
        : item.n;
      refs.fSubject.value = item ? item.subject : "";
      refs.fTime.value = item ? item.time || "" : timeForNewPair(dayKey, list, nextNumber);
      refs.fRoom.value = item ? item.room || "" : "";
      refs.fTeacher.value = item ? item.teacher || "" : "";
      refs.fAltSubject.value = item && item.alt ? item.alt.subject || "" : "";
      refs.fAltTeacher.value = item && item.alt ? item.alt.teacher || "" : "";
      refs.fAltRoom.value = item && item.alt ? item.alt.room || "" : "";
      refs.altBlock.open = Boolean(item && item.alt && item.alt.subject);
    } else {
      refs.fSubject.value = item ? item.title : "";
      refs.fTime.value = item ? item.time || "" : "8:00";
      refs.fRoom.value = item ? item.place || "" : "";
      refs.fTeacher.value = "";
      refs.fAltSubject.value = "";
      refs.fAltTeacher.value = "";
      refs.fAltRoom.value = "";
    }

    if (typeof refs.editor.showModal === "function") refs.editor.showModal();
    else refs.editor.setAttribute("open", "");
    refs.fSubject.focus();
    refs.fSubject.select();
  }

  function closeEditor() {
    if (typeof refs.editor.close === "function") refs.editor.close();
    else refs.editor.removeAttribute("open");
    editing = null;
  }

  function toMinutes(time) {
    const match = /(\d{1,2})[:.](\d{2})/.exec(time || "");
    return match ? Number(match[1]) * 60 + Number(match[2]) : 9999;
  }

  function saveEditor() {
    if (!editing || !isAdmin) return;
    const { kind, dateISO, dayKey, index } = editing;
    const subject = refs.fSubject.value.trim();

    if (!subject) {
      showToast(kind === "pair" ? "Впишите предмет" : "Впишите название");
      refs.fSubject.focus();
      return;
    }

    const target = editTarget(dateISO, kind);
    const list = target.list;

    if (kind === "pair") {
      const n = index >= 0 ? list[index].n : list.reduce((max, entry) => Math.max(max, entry.n), 0) + 1;
      const altSubject = refs.fAltSubject.value.trim();
      const alt = altSubject
        ? {
            subject: altSubject,
            teacher: refs.fAltTeacher.value.trim(),
            room: refs.fAltRoom.value.trim(),
          }
        : null;
      const typedTime = refs.fTime.value.trim();
      const item = {
        n,
        time: typedTime,
        subject,
        teacher: refs.fTeacher.value.trim(),
        room: refs.fRoom.value.trim(),
        alt,
      };
      if (index >= 0) list[index] = item;
      else list.push(item);
      list.sort((a, b) => a.n - b.n);
      applyDayTimes(dayKey, list, item, typedTime);
    } else {
      const item = {
        time: refs.fTime.value.trim() || "8:00",
        title: subject,
        place: refs.fRoom.value.trim(),
      };
      if (index >= 0) list[index] = item;
      else list.push(item);
      list.sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
    }

    markDirty(target.source);
    closeEditor();
    render();
    showToast(
      target.source === "overrides"
        ? "Замена сохранена — скачайте overrides.json"
        : "Сохранено в черновике — не забудьте скачать schedule.json"
    );
  }

  function deleteItem(kind, dateISO, index) {
    if (!isAdmin) return;
    const target = editTarget(dateISO, kind);
    const list = target.list;
    if (index < 0 || index >= list.length) return;
    list.splice(index, 1);
    if (kind === "pair") {
      applyDayTimes(dayKeyForDate(parseISO(dateISO)), list, null, null);
    }
    markDirty(target.source);
    render();
    showToast(kind === "pair" ? "Пара удалена" : "Внеурочка удалена");
  }

  function makeOverride(dateISO) {
    if (!isAdmin || overrides[dateISO]) return;
    const base = basePlanForDate(parseISO(dateISO));
    overrides[dateISO] = {
      note: "",
      pairs: clone(base.pairs),
    };
    markDirty("overrides");
    render();
    showToast("День переведён в замену — правьте пары как обычно");
  }

  function clearOverride(dateISO) {
    if (!isAdmin || !overrides[dateISO]) return;
    if (!window.confirm("Убрать замену и вернуть базовое расписание на этот день?")) return;
    delete overrides[dateISO];
    markDirty("overrides");
    render();
    showToast("Замена убрана — день снова по базовому расписанию");
  }

  function editOverrideNote(dateISO) {
    if (!isAdmin || !overrides[dateISO]) return;
    const next = window.prompt(
      "Пояснение к замене (можно оставить пустым):",
      overrides[dateISO].note || ""
    );
    if (next === null) return;
    overrides[dateISO].note = next.trim();
    markDirty("overrides");
    render();
  }

  /* ---------- Экспорт / импорт ---------- */
  function cleanPair(item) {
    const result = {
      n: item.n,
      time: item.time,
      subject: item.subject,
      teacher: item.teacher,
      room: item.room,
    };
    if (item.alt && item.alt.subject) {
      result.alt = {
        subject: item.alt.subject,
        teacher: item.alt.teacher || "",
        room: item.alt.room || "",
      };
    }
    return result;
  }

  function cleanWeek(week) {
    const result = {};
    DAYS.forEach((day) => {
      const info = week[day.key];
      result[day.key] = {
        pairs: info.pairs
          .slice()
          .sort((a, b) => a.n - b.n)
          .map(cleanPair),
      };
    });
    return result;
  }

  function exportPayload() {
    return {
      version: data.version,
      group: data.group,
      short: data.short,
      specialty: data.specialty,
      semester: data.semester,
      refMonday: data.refMonday,
      bells: {
        pairs: data.bells.pairs,
        third: data.bells.third,
        mathPattern: data.bells.mathPattern,
      },
      weeks: {
        "1": cleanWeek(data.weeks["1"]),
        "2": cleanWeek(data.weeks["2"]),
      },
    };
  }

  function cleanExtras(list) {
    return list.map((item) => ({
      time: item.time,
      title: item.title,
      place: item.place || "",
    }));
  }

  function exportOverridesPayload() {
    const result = { version: 2, weeklyExtras: {}, overrides: {} };

    DAYS.forEach((day) => {
      const list = weeklyExtras[day.key];
      if (Array.isArray(list) && list.length) {
        result.weeklyExtras[day.key] = cleanExtras(list);
      }
    });

    Object.keys(overrides)
      .sort()
      .forEach((iso) => {
        const item = overrides[iso];
        const entry = {
          note: item.note || "",
          pairs: item.pairs.slice().sort((a, b) => a.n - b.n).map(cleanPair),
        };
        if (Array.isArray(item.extras)) entry.extras = cleanExtras(item.extras);
        result.overrides[iso] = entry;
      });
    return result;
  }

  /* ---------- Черновик в браузере ---------- */
  function buildDraft() {
    return {
      savedAt: new Date().toISOString(),
      schedule: exportPayload(),
      overrides: exportOverridesPayload(),
    };
  }

  function readDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.schedule || !parsed.overrides) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function saveDraft({ quiet = false } = {}) {
    if (!data) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(buildDraft()));
      hasDraft = true;
      downloaded = false;
      dirtyBase = false;
      dirtyOverrides = false;
      updateAdminUi();
      if (!quiet) {
        showToast("Сохранено в браузере. Для публикации скачайте файлы.");
      }
    } catch {
      showToast("Не удалось сохранить черновик в браузере");
    }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* приватный режим */
    }
    hasDraft = false;
  }

  function downloadBlob(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadJson() {
    if (!data) return;
    downloadBlob(exportPayload(), "schedule.json");
    dirtyBase = false;
    downloaded = true;
    updateAdminUi();
    showToast("schedule.json скачан — замените файл в репозитории");
  }

  function downloadOverrides() {
    if (!data) return;
    downloadBlob(exportOverridesPayload(), "overrides.json");
    dirtyOverrides = false;
    downloaded = true;
    updateAdminUi();
    showToast("overrides.json скачан — замените файл в репозитории");
  }

  /* ---------- ZIP с двумя JSON ---------- */
  let crcTable = null;

  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let i = 0; i < 256; i += 1) {
        let value = i;
        for (let bit = 0; bit < 8; bit += 1) {
          value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        crcTable[i] = value >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function buildZip(files) {
    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;

    files.forEach((file) => {
      const name = encoder.encode(file.name);
      const data = encoder.encode(file.text);
      const crc = crc32(data);

      const local = new Uint8Array(30 + name.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, name.length, true);
      local.set(name, 30);

      const entry = new Uint8Array(46 + name.length);
      const entryView = new DataView(entry.buffer);
      entryView.setUint32(0, 0x02014b50, true);
      entryView.setUint16(4, 20, true);
      entryView.setUint16(6, 20, true);
      entryView.setUint16(8, 0x0800, true);
      entryView.setUint32(16, crc, true);
      entryView.setUint32(20, data.length, true);
      entryView.setUint32(24, data.length, true);
      entryView.setUint16(28, name.length, true);
      entryView.setUint32(42, offset, true);
      entry.set(name, 46);

      parts.push(local, data);
      central.push(entry);
      offset += local.length + data.length;
    });

    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);

    return new Blob([...parts, ...central, end], { type: "application/zip" });
  }

  function downloadZip() {
    if (!data) return;
    const files = [
      { name: "schedule.json", text: `${JSON.stringify(exportPayload(), null, 2)}\n` },
      { name: "overrides.json", text: `${JSON.stringify(exportOverridesPayload(), null, 2)}\n` },
    ];
    const blob = buildZip(files);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "185-es-files.zip";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    dirtyBase = false;
    dirtyOverrides = false;
    downloaded = true;
    updateAdminUi();
    showToast("ZIP с двумя JSON скачан — распакуйте перед загрузкой на GitHub");
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        data = normalizeData(parsed);
        subjectIndex = null;
        viewWeek = currentWeekNumber();
        applyMeta();
        markDirty();
        render();
        showToast("JSON загружен в черновик");
      } catch (error) {
        console.error("import:", error);
        showToast("Не получилось прочитать файл");
      }
    };
    reader.readAsText(file);
  }

  /* ---------- События ---------- */
  document.querySelectorAll(".week-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      viewWeek = Number(btn.dataset.week);
      if (data) render();
    });
  });

  refs.editToggle.addEventListener("click", () => {
    if (!isAdmin) return;
    editMode = !editMode;
    render();
  });

  refs.grid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button || !isAdmin) return;

    const act = button.dataset.act;
    const kind = button.dataset.kind;
    const dateISO = button.dataset.date;
    const index = button.dataset.idx === undefined ? -1 : Number(button.dataset.idx);

    if (act === "edit") openEditor(kind, dateISO, index);
    else if (act === "delete") deleteItem(kind, dateISO, index);
    else if (act === "add") openEditor(kind, dateISO, -1);
    else if (act === "make-override") makeOverride(dateISO);
    else if (act === "clear-override") clearOverride(dateISO);
    else if (act === "edit-note") editOverrideNote(dateISO);
  });

  refs.editorForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveEditor();
  });

  $("#editorCancel").addEventListener("click", closeEditor);

  refs.editorDelete.addEventListener("click", () => {
    if (!editing) return;
    const { kind, dateISO, index } = editing;
    closeEditor();
    deleteItem(kind, dateISO, index);
  });

  refs.editor.addEventListener("click", (event) => {
    if (event.target === refs.editor) closeEditor();
  });

  $("#recalcTimes").addEventListener("click", () => {
    if (!isAdmin) return;
    recalcWeekTimes(weekOf(viewWeek));
    markDirty();
    render();
    showToast("Время пар пересчитано по звонкам");
  });

  $("#copyWeek").addEventListener("click", () => {
    if (!isAdmin) return;
    const target = viewWeek === 1 ? 2 : 1;
    data.weeks[String(target)] = clone(weekOf(viewWeek));
    markDirty();
    viewWeek = target;
    render();
    showToast(`Данные перенесены в ${viewWeek} неделю`);
  });

  $("#clearWeek").addEventListener("click", () => {
    if (!isAdmin) return;
    if (!window.confirm(`Очистить все пары и внеурочку в ${viewWeek} неделе?`)) return;
    const week = weekOf(viewWeek);
    DAYS.forEach((day) => {
      week[day.key] = { extras: [], pairs: [] };
    });
    markDirty();
    render();
    showToast(`Неделя ${viewWeek} очищена`);
  });

  $("#exportBtn").addEventListener("click", downloadJson);

  $("#saveBtn").addEventListener("click", () => saveDraft());

  $("#exportOverridesBtn").addEventListener("click", downloadOverrides);

  $("#exportZipBtn").addEventListener("click", downloadZip);

  $("#importBtn").addEventListener("click", () => $("#importFile").click());

  $("#importFile").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) importJson(file);
    event.target.value = "";
  });

  $("#resetBtn").addEventListener("click", () => {
    if (!isAdmin) return;
    const question = hasUnsaved() || hasDraft
      ? "Вернуть расписание и замены из файлов? Черновик и нескачанные изменения пропадут."
      : "Загрузить расписание и замены из файлов заново?";
    if (!window.confirm(question)) return;
    clearDraft();
    loadSchedule({ ignoreDraft: true, notify: true });
  });

  $("#exitAdmin").addEventListener("click", () => {
    if (hasUnsaved() && !window.confirm("Выйти без сохранения? Нескачанные правки пропадут.")) return;
    setAdmin(false);
    loadSchedule({ ignoreDraft: true });
    showToast("Режим администратора выключен");
  });

  refs.retryBtn.addEventListener("click", () => loadSchedule());

  window.addEventListener("beforeunload", (event) => {
    if (!isAdmin || !hasUnsaved()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  /* ---------- Живой фон: параллакс сфер ---------- */
  (() => {
    const bg = document.getElementById("bg");
    if (!bg) return;
    const orbs = bg.querySelector(".orbs");
    if (!orbs) return;

    const finePointer = window.matchMedia("(pointer: fine)").matches;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!finePointer || reducedMotion) return;

    let targetX = 0;
    let targetY = 0;
    let positionX = 0;
    let positionY = 0;
    let frame = 0;

    const step = () => {
      positionX += (targetX - positionX) * 0.065;
      positionY += (targetY - positionY) * 0.065;
      orbs.style.transform = `translate3d(${positionX * 22}px, ${positionY * 16}px, 0)`;

      if (Math.abs(targetX - positionX) < 0.0015 && Math.abs(targetY - positionY) < 0.0015) {
        frame = 0;
        return;
      }
      frame = requestAnimationFrame(step);
    };

    window.addEventListener(
      "pointermove",
      (event) => {
        targetX = (event.clientX / window.innerWidth - 0.5) * 2;
        targetY = (event.clientY / window.innerHeight - 0.5) * 2;
        if (!frame) frame = requestAnimationFrame(step);
      },
      { passive: true }
    );
  })();

  /* ---------- Старт ---------- */
  isAdmin = detectAdmin();
  document.body.classList.toggle("is-admin", isAdmin);
  loadSchedule();
  window.setInterval(renderNow, 30000);
})();
