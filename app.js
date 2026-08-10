const SOURCE_URL = "./daodao.txt";
const ORDER_KEY = "daodao-order";
const ORDERS = new Set(["asc", "desc", "random"]);
const DATE_LINE = /^(\d{4})(\d{2})(\d{2})(?:[ \t]+(.+))?$/;

const diaryRoot = document.querySelector("#diary");
const orderButtons = document.querySelectorAll("[data-order]");
const yearRail = document.querySelector("#yearRail");
const yearRailList = document.querySelector("#yearRailList");
let diaryEntries = [];
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
        rawDate: `${marker[1]}${marker[2]}${marker[3]}`,
        displayDate: `${marker[1]} - ${marker[2]} - ${marker[3]}`,
        year: marker[1],
        month: marker[2],
        day: marker[3],
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

function renderEntry(entry, index) {
  const title = entry.title ? `<p>${escapeHtml(entry.title)}</p>` : "";
  const datetime = `${entry.year}-${entry.month}-${entry.day}`;
  const shadeClass = index % 2 === 1 ? " entry--shade" : "";

  return `
    <section
      id="entry-${entry.rawDate}"
      class="entry${shadeClass}"
      data-entry-year="${entry.year}"
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

function getStoredOrder() {
  try {
    const order = window.localStorage.getItem(ORDER_KEY);

    return ORDERS.has(order) ? order : "asc";
  } catch (error) {
    return "asc";
  }
}

function storeOrder(order) {
  try {
    window.localStorage.setItem(ORDER_KEY, order);
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
  const years = [...new Set(entries.map((entry) => entry.year))];

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
  diaryRoot.querySelectorAll("[data-entry-year]").forEach((entry) => {
    const year = entry.dataset.entryYear;

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

  entryPositions = [...diaryRoot.querySelectorAll("[data-entry-year]")].map(
    (entry) => ({
      top: pageTop + entry.getBoundingClientRect().top,
      year: entry.dataset.entryYear,
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

function renderError(message) {
  setOrderControlsDisabled(true);
  diaryRoot.innerHTML = `
    <section class="entry entry--error">
      <div class="entry__meta">
        <span class="entry__date">daodao</span>
      </div>
      <article class="entry__body">
        <p>${escapeHtml(message)}</p>
      </article>
    </section>
  `;
}

async function init() {
  try {
    const response = await fetch(SOURCE_URL, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`无法读取 ${SOURCE_URL}`);
    }

    const source = await response.text();
    diaryEntries = parseDiary(source).sort((left, right) =>
      left.rawDate.localeCompare(right.rawDate)
    );

    if (diaryEntries.length === 0) {
      renderError("没有找到以 8 位日期独占一行开头的日记。");
      return;
    }

    renderEntries(getStoredOrder());
    setOrderControlsDisabled(false);
  } catch (error) {
    renderError(
      "日记暂时没有打开。请通过本地服务器或 GitHub Pages 访问这个页面。"
    );
  }
}

orderButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const order = button.dataset.order;

    if (!ORDERS.has(order) || diaryEntries.length === 0) {
      return;
    }

    storeOrder(order);
    renderEntries(order);
    diaryRoot.scrollIntoView({ block: "start" });
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
