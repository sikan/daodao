const COLLECTIONS = {
  diary: {
    label: "An Island in Amber",
    railLabel: "按年份快速跳转",
    sourceUrl: "./daodao.txt",
  },
  swimming: {
    label: "Every Lap Counts",
    railLabel: "按季度快速跳转",
    sourceUrl: "./every-lap-counts.txt",
  },
};
const COLLECTION_KEY = "daodao-collection";
const ORDER_KEY = "daodao-order";
const ORDERS = new Set(["asc", "desc", "random"]);
const DATE_LINE = /^(\d{4})(\d{2})(\d{2})(?:[ \t]+(.+))?$/;
const TIME_RANGE_LINE = /^\d{2}:\d{2}-\d{2}:\d{2}$/;

const diaryRoot = document.querySelector("#diary");
const orderButtons = document.querySelectorAll("[data-order]");
const collectionButtons = document.querySelectorAll("[data-collection]");
const yearRail = document.querySelector("#yearRail");
const yearRailList = document.querySelector("#yearRailList");
let diaryEntries = [];
let activeCollection = "diary";
let activeOrder = "desc";
let activationSequence = 0;
const collectionCache = new Map();
let entryPositions = [];
let yearTargets = new Map();
let activeYear = null;
let yearRailVisible = false;
let scrollFrame = null;
let positionFrame = null;
let scrubPointerId = null;
let scrubStartY = 0;
let scrubMoved = false;
let scrubYear = null;
let suppressNextYearClick = false;

function escapeHtml(value) {
  return value
    .replaceAll("\uFFFC", "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isRealDate(year, month, day) {
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));

  return (
    parsed.getFullYear() === Number(year) &&
    parsed.getMonth() === Number(month) - 1 &&
    parsed.getDate() === Number(day)
  );
}

function parseDateLine(line) {
  const marker = line.match(DATE_LINE);

  if (!marker || !isRealDate(marker[1], marker[2], marker[3])) {
    return null;
  }

  return marker;
}

function parseDiary(source) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const entries = [];
  let current = null;

  for (const line of lines) {
    const marker = parseDateLine(line);

    if (marker) {
      if (current) {
        current.body = current.lines.join("\n").trim();
        delete current.lines;
        entries.push(current);
      }

      current = {
        kind: "diary",
        rawDate: `${marker[1]}${marker[2]}${marker[3]}`,
        displayDate: `${marker[1]} - ${marker[2]} - ${marker[3]}`,
        year: marker[1],
        month: marker[2],
        day: marker[3],
        railLabel: marker[1],
        title: marker[4] ? marker[4].trim() : "",
        lines: [],
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    current.body = current.lines.join("\n").trim();
    delete current.lines;
    entries.push(current);
  }

  return entries;
}

function getQuarterLabel(year, month) {
  const quarter = Math.floor((Number(month) - 1) / 3) + 1;

  return `${year.slice(-2)}Q${quarter}`;
}

function trimEmptyLines(lines) {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim() === "") {
    start += 1;
  }

  while (end > start && lines[end - 1].trim() === "") {
    end -= 1;
  }

  return lines.slice(start, end);
}

function finalizeSwimmingEntry(current) {
  const lines = trimEmptyLines(current.lines);
  let cursor = 0;
  let time = "";
  let session = "";
  let coach = "";
  let competition = "";
  let competitionName = "";
  let pool = "";

  if (TIME_RANGE_LINE.test(lines[cursor] || "")) {
    time = lines[cursor] || "";
    cursor += 1;
    session = lines[cursor] || "";
    cursor += 1;

    if ((lines[cursor] || "").includes("教练")) {
      coach = lines[cursor];
      cursor += 1;
    }
  } else if (lines[cursor] === "比赛日") {
    competition = lines[cursor] || "";
    cursor += 1;
    competitionName = lines[cursor] || "";
    cursor += 1;
    pool = lines[cursor] || "";
    cursor += 1;
  } else {
    competition = lines[cursor] || "";
    cursor += 1;
  }

  current.time = time;
  current.session = session;
  current.coach = coach;
  current.competition = competition;
  current.competitionName = competitionName;
  current.pool = pool;
  current.body = trimEmptyLines(lines.slice(cursor)).join("\n");
  delete current.lines;

  return current;
}

function parseSwimming(source) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const entries = [];
  let current = null;

  for (const line of lines) {
    const marker = parseDateLine(line);

    if (marker) {
      if (current) {
        entries.push(finalizeSwimmingEntry(current));
      }

      current = {
        kind: "swimming",
        rawDate: `${marker[1]}${marker[2]}${marker[3]}`,
        displayDate: `${marker[1]} - ${marker[2]} - ${marker[3]}`,
        year: marker[1],
        month: marker[2],
        day: marker[3],
        railLabel: getQuarterLabel(marker[1], marker[2]),
        lines: [],
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    entries.push(finalizeSwimmingEntry(current));
  }

  return entries;
}

function renderParagraph(paragraph) {
  const lines = paragraph.split("\n").map((line) => escapeHtml(line.trimEnd()));

  if (lines.every((line) => line.trim() === "")) {
    return "";
  }

  const content = lines
    .map((line) => `<span class="line">${line || "&nbsp;"}</span>`)
    .join("");

  return `<p>${content}</p>`;
}

function renderBody(entry) {
  if (!entry.body) {
    return '<p class="empty-note">这一日只留下了日期。</p>';
  }

  return entry.body
    .split(/\n{2,}/)
    .map((paragraph) => renderParagraph(paragraph))
    .join("");
}

function renderSwimmingMeta(entry) {
  if (entry.competition) {
    const rows = [entry.competition, entry.competitionName, entry.pool]
      .filter(Boolean)
      .map((row) => `<p>${escapeHtml(row)}</p>`)
      .join("");

    return `
      <div class="swim-session swim-session--competition">
        ${rows}
      </div>
    `;
  }

  const rows = [entry.time, entry.session, entry.coach]
    .filter(Boolean)
    .map((row) => `<p>${escapeHtml(row)}</p>`)
    .join("");

  return `<div class="swim-session">${rows}</div>`;
}

function renderSwimmingProgram(entry) {
  if (!entry.body) {
    return '<p class="empty-note">这一场只留下了基本信息。</p>';
  }

  const rendered = [];
  let hasGap = false;

  entry.body.split("\n").forEach((sourceLine) => {
    const line = sourceLine.trim();

    if (!line) {
      hasGap = true;
      return;
    }

    const spacedClass = hasGap ? " swim-line--spaced" : "";
    hasGap = false;

    if (line.startsWith("└ ")) {
      rendered.push(`
        <div class="swim-line swim-line--structure${spacedClass}">
          <span class="swim-line__mark" aria-hidden="true">└</span>
          <p>${escapeHtml(line.slice(2))}</p>
        </div>
      `);
      return;
    }

    if (line.startsWith("· ")) {
      rendered.push(`
        <div class="swim-line swim-line--annotation${spacedClass}">
          <span class="swim-line__mark" aria-hidden="true">·</span>
          <p>${escapeHtml(line.slice(2))}</p>
        </div>
      `);
      return;
    }

    if (line.startsWith("- ")) {
      rendered.push(`
        <div class="swim-line swim-line--note${spacedClass}">
          <span class="swim-line__mark" aria-hidden="true">−</span>
          <p>${escapeHtml(line.slice(2))}</p>
        </div>
      `);
      return;
    }

    if (line.startsWith("> ")) {
      rendered.push(`
        <blockquote class="swim-line swim-line--quote${spacedClass}">
          <p>${escapeHtml(line.slice(2))}</p>
        </blockquote>
      `);
      return;
    }

    rendered.push(
      `<p class="swim-line swim-line--set${spacedClass}">${escapeHtml(line)}</p>`
    );
  });

  return `<div class="swim-program">${rendered.join("")}</div>`;
}

function renderDiaryEntry(entry, index) {
  const title = entry.title ? `<p>${escapeHtml(entry.title)}</p>` : "";
  const datetime = `${entry.year}-${entry.month}-${entry.day}`;
  const shadeClass = index % 2 === 1 ? " entry--shade" : "";

  return `
    <section
      id="entry-${entry.rawDate}"
      class="entry${shadeClass}"
      data-entry-period="${entry.railLabel}"
      aria-label="${entry.displayDate}"
    >
      <div class="entry__meta">
        <time class="entry__date" datetime="${datetime}">${entry.displayDate}</time>
      </div>
      <article class="entry__body">
        ${title}
        ${renderBody(entry)}
      </article>
    </section>
  `;
}

function renderSwimmingEntry(entry, index) {
  const datetime = `${entry.year}-${entry.month}-${entry.day}`;
  const shadeClass = index % 2 === 1 ? " entry--shade" : "";
  const accessibleDetail =
    entry.time ||
    [entry.competition, entry.competitionName, entry.pool]
      .filter(Boolean)
      .join(" ");

  return `
    <section
      id="swim-entry-${entry.rawDate}-${index}"
      class="entry entry--swimming${shadeClass}"
      data-entry-period="${entry.railLabel}"
      aria-label="${entry.displayDate}${accessibleDetail ? ` ${escapeHtml(accessibleDetail)}` : ""}"
    >
      <div class="entry__meta">
        <time class="entry__date" datetime="${datetime}">${entry.displayDate}</time>
        ${renderSwimmingMeta(entry)}
      </div>
      <article class="entry__body entry__body--swimming">
        ${renderSwimmingProgram(entry)}
      </article>
    </section>
  `;
}

function renderEntry(entry, index) {
  if (entry.kind === "swimming") {
    return renderSwimmingEntry(entry, index);
  }

  return renderDiaryEntry(entry, index);
}

function getStoredOrder() {
  try {
    const order = window.localStorage.getItem(ORDER_KEY);

    return order === "asc" ? "asc" : "desc";
  } catch (error) {
    return "desc";
  }
}

function getStoredCollection() {
  try {
    const collection = window.localStorage.getItem(COLLECTION_KEY);

    return COLLECTIONS[collection] ? collection : "diary";
  } catch (error) {
    return "diary";
  }
}

function storeCollection(collection) {
  try {
    window.localStorage.setItem(COLLECTION_KEY, collection);
  } catch (error) {
    return;
  }
}

function storeOrder(order) {
  try {
    const storedOrder = order === "asc" ? "asc" : "desc";
    window.localStorage.setItem(ORDER_KEY, storedOrder);
  } catch (error) {
    return;
  }
}

function setOrderControlState(order) {
  orderButtons.forEach((button) => {
    const isActive = button.dataset.order === order;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function setOrderControlsDisabled(isDisabled) {
  orderButtons.forEach((button) => {
    button.disabled = isDisabled;
  });
}

function renderYearRail(entries) {
  const years = [...new Set(entries.map((entry) => entry.railLabel))];

  yearRail.hidden = years.length < 2;
  setYearRailVisibility(false);
  yearRailList.innerHTML = years
    .map(
      (year) => `
        <li class="year-rail__item">
          <button
            class="year-rail__button"
            type="button"
            data-year="${year}"
          >${year}</button>
        </li>
      `
    )
    .join("");

  yearTargets = new Map();
  diaryRoot.querySelectorAll("[data-entry-period]").forEach((entry) => {
    const year = entry.dataset.entryPeriod;

    if (!yearTargets.has(year)) {
      yearTargets.set(year, entry);
    }
  });

  activeYear = null;

  if (years.length > 0) {
    setActiveYear(years[0]);
  }
}

function disableYearRail() {
  yearRail.hidden = true;
  setYearRailVisibility(false);
  yearRailList.replaceChildren();
  yearTargets = new Map();
  entryPositions = [];
  activeYear = null;
  diaryRoot.style.removeProperty("--diary-end-space");
}

function setActiveYear(year) {
  if (!year || activeYear === year) {
    return;
  }

  activeYear = year;

  yearRailList.querySelectorAll("[data-year]").forEach((button) => {
    const isActive = button.dataset.year === year;

    button.classList.toggle("is-active", isActive);

    if (isActive) {
      button.setAttribute("aria-current", "true");
    } else {
      button.removeAttribute("aria-current");
    }
  });
}

function setYearRailVisibility(isVisible) {
  if (yearRailVisible === isVisible) {
    return;
  }

  yearRailVisible = isVisible;
  yearRail.classList.toggle("is-visible", isVisible);
  yearRail.setAttribute("aria-hidden", String(!isVisible));

  if (isVisible) {
    yearRail.removeAttribute("inert");
    return;
  }

  yearRail.setAttribute("inert", "");

  if (yearRail.contains(document.activeElement)) {
    document.activeElement.blur();
  }
}

function getReadingLineOffset() {
  const proportionalOffset = window.innerHeight * 0.32;
  const lowerBound = Math.min(112, window.innerHeight - 72);

  return Math.max(
    40,
    Math.min(Math.max(proportionalOffset, lowerBound), window.innerHeight - 72)
  );
}

function updateYearFromScroll() {
  scrollFrame = null;

  if (yearRail.hidden || entryPositions.length === 0) {
    return;
  }

  const readingLineOffset = getReadingLineOffset();
  const diaryBounds = diaryRoot.getBoundingClientRect();
  const isReadingDiary =
    diaryBounds.top <= readingLineOffset &&
    diaryBounds.bottom > readingLineOffset;

  setYearRailVisibility(isReadingDiary);

  if (!isReadingDiary) {
    return;
  }

  const readingPosition = window.scrollY + readingLineOffset;
  let low = 0;
  let high = entryPositions.length - 1;
  let currentIndex = 0;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);

    if (entryPositions[middle].top <= readingPosition) {
      currentIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  setActiveYear(entryPositions[currentIndex].year);
}

function scheduleScrollUpdate() {
  if (scrollFrame !== null) {
    return;
  }

  scrollFrame = window.requestAnimationFrame(updateYearFromScroll);
}

function refreshEntryPositions() {
  positionFrame = null;

  if (yearRail.hidden) {
    entryPositions = [];
    diaryRoot.style.removeProperty("--diary-end-space");
    return;
  }

  refreshDiaryEndSpace();
  const pageTop = window.scrollY;

  entryPositions = [...diaryRoot.querySelectorAll("[data-entry-period]")].map(
    (entry) => ({
      top: pageTop + entry.getBoundingClientRect().top,
      year: entry.dataset.entryPeriod,
    })
  );

  updateYearFromScroll();
}

function refreshDiaryEndSpace() {
  const years = [...yearTargets.keys()];
  const finalYear = years[years.length - 1];
  const finalYearTarget = yearTargets.get(finalYear);

  if (!finalYearTarget) {
    diaryRoot.style.removeProperty("--diary-end-space");
    return;
  }

  const currentEndSpace =
    Number.parseFloat(getComputedStyle(diaryRoot).paddingBottom) || 0;
  const documentBottomWithoutEndSpace =
    document.documentElement.scrollHeight - currentEndSpace;
  const targetTop =
    window.scrollY + finalYearTarget.getBoundingClientRect().top;
  const targetInset = Math.min(64, finalYearTarget.offsetHeight * 0.35);
  const desiredScrollTop =
    targetTop - getReadingLineOffset() + targetInset;
  const requiredEndSpace = Math.max(
    0,
    Math.ceil(
      desiredScrollTop + window.innerHeight - documentBottomWithoutEndSpace
    )
  );
  const renderedEndSpace =
    Number.parseFloat(
      diaryRoot.style.getPropertyValue("--diary-end-space")
    ) || 0;

  if (Math.abs(requiredEndSpace - renderedEndSpace) > 1) {
    diaryRoot.style.setProperty("--diary-end-space", `${requiredEndSpace}px`);
  }
}

function schedulePositionRefresh() {
  if (positionFrame !== null) {
    return;
  }

  positionFrame = window.requestAnimationFrame(refreshEntryPositions);
}

function jumpToYear(year) {
  const target = yearTargets.get(year);

  if (!target) {
    return;
  }

  const targetTop = window.scrollY + target.getBoundingClientRect().top;
  const targetInset = Math.min(64, target.offsetHeight * 0.35);
  const scrollTop = Math.max(
    0,
    targetTop - getReadingLineOffset() + targetInset
  );

  setActiveYear(year);
  window.scrollTo({ top: scrollTop, behavior: "auto" });
}

function getPointerYear(clientY) {
  const buttons = [...yearRailList.querySelectorAll("[data-year]")];

  if (buttons.length === 0) {
    return null;
  }

  const firstBounds = buttons[0].getBoundingClientRect();
  const lastBounds = buttons[buttons.length - 1].getBoundingClientRect();
  const firstCenter = firstBounds.top + firstBounds.height / 2;
  const lastCenter = lastBounds.top + lastBounds.height / 2;
  const progress = Math.max(
    0,
    Math.min(1, (clientY - firstCenter) / (lastCenter - firstCenter || 1))
  );
  const index = Math.round(progress * (buttons.length - 1));

  return buttons[index].dataset.year;
}

function resetScrub() {
  scrubPointerId = null;
  scrubMoved = false;
  scrubYear = null;
}

function createShuffledEntries(entries) {
  const result = [...entries];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [
      result[randomIndex],
      result[index],
    ];
  }

  return result;
}

function getEntriesForOrder(order) {
  if (order === "desc") {
    return [...diaryEntries].reverse();
  }

  if (order === "random") {
    return createShuffledEntries(diaryEntries);
  }

  return [...diaryEntries];
}

function renderEntries(order) {
  const entries = getEntriesForOrder(order);

  diaryRoot.classList.toggle("diary--random", order === "random");
  diaryRoot.innerHTML = entries.map(renderEntry).join("");
  setOrderControlState(order);

  if (order === "random") {
    disableYearRail();
  } else {
    renderYearRail(entries);
  }

  refreshEntryPositions();
}

function setCollectionControlState(collection) {
  const config = COLLECTIONS[collection];

  collectionButtons.forEach((button) => {
    const isActive = button.dataset.collection === collection;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  document.body.dataset.collection = collection;
  diaryRoot.classList.toggle("diary--swimming", collection === "swimming");
  diaryRoot.setAttribute("aria-label", config.label);
  yearRail.setAttribute("aria-label", config.railLabel);
}

function renderLoading(collection) {
  const label = COLLECTIONS[collection].label;

  disableYearRail();
  diaryRoot.innerHTML = `
    <section class="entry entry--loading">
      <div class="entry__meta">
        <span class="entry__date">${escapeHtml(label)}</span>
      </div>
      <article class="entry__body">
        <p>${collection === "swimming" ? "正在整理泳道里的波纹……" : "正在透射琥珀的温光……"}</p>
      </article>
    </section>
  `;
}

function renderError(message, collection = activeCollection) {
  setOrderControlsDisabled(true);
  diaryRoot.innerHTML = `
    <section class="entry entry--error">
      <div class="entry__meta">
        <span class="entry__date">${escapeHtml(COLLECTIONS[collection].label)}</span>
      </div>
      <article class="entry__body">
        <p>${escapeHtml(message)}</p>
      </article>
    </section>
  `;
}

async function loadCollection(collection) {
  if (collectionCache.has(collection)) {
    return collectionCache.get(collection);
  }

  const config = COLLECTIONS[collection];
  const response = await fetch(config.sourceUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`无法读取 ${config.sourceUrl}`);
  }

  const source = await response.text();
  const entries = (collection === "swimming"
    ? parseSwimming(source)
    : parseDiary(source)
  ).sort((left, right) => left.rawDate.localeCompare(right.rawDate));

  if (entries.length === 0) {
    throw new Error(
      collection === "swimming"
        ? "没有找到以 8 位日期独占一行开头的游泳记录。"
        : "没有找到以 8 位日期独占一行开头的日记。"
    );
  }

  collectionCache.set(collection, entries);
  return entries;
}

async function activateCollection(collection, shouldScroll = true) {
  if (!COLLECTIONS[collection]) {
    return;
  }

  const sequence = activationSequence + 1;
  activationSequence = sequence;
  activeCollection = collection;
  storeCollection(collection);
  setCollectionControlState(collection);
  setOrderControlsDisabled(true);
  renderLoading(collection);

  try {
    const entries = await loadCollection(collection);

    if (sequence !== activationSequence) {
      return;
    }

    diaryEntries = entries;
    renderEntries(activeOrder);
    setOrderControlsDisabled(false);

    if (shouldScroll) {
      diaryRoot.scrollIntoView({ block: "start" });
    }
  } catch (error) {
    if (sequence !== activationSequence) {
      return;
    }

    renderError(
      collection === "swimming"
        ? "游泳记录暂时没有打开。请通过本地服务器或 GitHub Pages 访问这个页面。"
        : "日记暂时没有打开。请通过本地服务器或 GitHub Pages 访问这个页面。",
      collection
    );
  }
}

async function init() {
  activeOrder = getStoredOrder();
  await activateCollection(getStoredCollection(), false);
}

orderButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const order = button.dataset.order;

    if (!ORDERS.has(order) || diaryEntries.length === 0) {
      return;
    }

    activeOrder = order;
    storeOrder(order);
    renderEntries(order);
    diaryRoot.scrollIntoView({ block: "start" });
  });
});

collectionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const collection = button.dataset.collection;

    if (!COLLECTIONS[collection] || collection === activeCollection) {
      return;
    }

    activateCollection(collection);
  });
});

yearRailList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-year]");

  if (!button) {
    return;
  }

  if (suppressNextYearClick) {
    suppressNextYearClick = false;
    event.preventDefault();
    return;
  }

  jumpToYear(button.dataset.year);
});

yearRail.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }

  scrubPointerId = event.pointerId;
  scrubStartY = event.clientY;
  scrubMoved = false;
  scrubYear = null;
  yearRail.setPointerCapture(event.pointerId);
});

yearRail.addEventListener("pointermove", (event) => {
  if (event.pointerId !== scrubPointerId) {
    return;
  }

  if (Math.abs(event.clientY - scrubStartY) > 4) {
    scrubMoved = true;
  }

  if (!scrubMoved) {
    return;
  }

  event.preventDefault();
  const year = getPointerYear(event.clientY);

  if (year && year !== scrubYear) {
    scrubYear = year;
    jumpToYear(year);
  }
});

yearRail.addEventListener("pointerup", (event) => {
  if (event.pointerId !== scrubPointerId) {
    return;
  }

  if (scrubMoved) {
    suppressNextYearClick = true;
    window.setTimeout(() => {
      suppressNextYearClick = false;
    }, 0);
  } else if (!event.target.closest("[data-year]")) {
    jumpToYear(getPointerYear(event.clientY));
  }

  if (yearRail.hasPointerCapture(event.pointerId)) {
    yearRail.releasePointerCapture(event.pointerId);
  }
  resetScrub();
});

yearRail.addEventListener("pointercancel", resetScrub);
window.addEventListener("scroll", scheduleScrollUpdate, { passive: true });
window.addEventListener("resize", schedulePositionRefresh, { passive: true });

if ("ResizeObserver" in window) {
  new ResizeObserver(schedulePositionRefresh).observe(diaryRoot);
}

if (document.fonts) {
  document.fonts.ready.then(schedulePositionRefresh);
}

init();
