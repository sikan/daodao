const SOURCE_URL = "./daodao.txt";
const ORDER_KEY = "daodao-order";
const DATE_LINE = /^(\d{4})(\d{2})(\d{2})(?:[ \t]+(.+))?$/;

const diaryRoot = document.querySelector("#diary");
const orderButtons = document.querySelectorAll("[data-order]");
let diaryEntries = [];

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

  const className = lines.some((line) => line.includes("：")) ? "dialogue" : "";
  const content = lines
    .map((line) => `<span class="line">${line || "&nbsp;"}</span>`)
    .join("");

  return `<p${className ? ` class="${className}"` : ""}>${content}</p>`;
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
    <section class="entry${shadeClass}" aria-label="${entry.displayDate}">
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

    return order === "desc" ? "desc" : "asc";
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

function renderEntries(order) {
  const entries =
    order === "desc" ? [...diaryEntries].reverse() : [...diaryEntries];

  diaryRoot.innerHTML = entries.map(renderEntry).join("");
  setOrderControlState(order);
}

function renderError(message) {
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
    diaryEntries = parseDiary(source);

    if (diaryEntries.length === 0) {
      renderError("没有找到以 8 位日期独占一行开头的日记。");
      return;
    }

    renderEntries(getStoredOrder());
  } catch (error) {
    renderError(
      "日记暂时没有打开。请通过本地服务器或 GitHub Pages 访问这个页面。"
    );
  }
}

orderButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const order = button.dataset.order === "desc" ? "desc" : "asc";

    storeOrder(order);
    renderEntries(order);
    diaryRoot.scrollIntoView({ block: "start" });
  });
});

init();
