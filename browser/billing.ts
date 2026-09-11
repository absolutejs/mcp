import { App } from "@modelcontextprotocol/ext-apps";
const app = new App(
  { name: "Billing reports", version: "1.0.0" },
  {},
  { autoResize: true },
);
const view = document.documentElement.dataset.view;
const names = {
  status: "get_billing_status",
  usage: "get_usage_report",
  receipts: "list_receipts",
};
if (view !== "status" && view !== "usage" && view !== "receipts")
  throw Error("Unknown report view");
const toolName = names[view];
const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const number = (value: unknown) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw Error("Invalid report amount");
  return value;
};
const label = (value: unknown) => {
  if (typeof value !== "string") throw Error("Invalid report label");
  return value.slice(0, 256);
};
const root = element("main");
document.body.append(root);
root.append(
  element(
    "h1",
    view === "status"
      ? "Billing and credits"
      : view === "usage"
        ? "Recorded credit usage"
        : "Receipts",
  ),
);
const message = element("p", "Waiting for the report from your assistant…");
message.setAttribute("role", "status");
root.append(message);
const controls = element("div");
controls.className = "controls";
root.append(controls);
const refresh = element("button", "Refresh");
refresh.disabled = true;
controls.append(refresh);
const output = element("section");
root.append(output);
const note = element(
  "p",
  "Service credits are separate from dollars paid and your assistant’s tokens. These views do not purchase, renew or cancel anything.",
);
note.className = "note";
root.append(note);
let ready = false;
let busy = false;
let nextCursor: string | null = null;
let currentArgs: Record<string, unknown> = {};
const start = element("input");
start.type = "date";
const end = element("input");
end.type = "date";
if (view === "usage")
  for (const [text, input] of [
    ["From (UTC, inclusive)", start],
    ["To (UTC, exclusive)", end],
  ] as const) {
    const field = element("label", text);
    field.append(input);
    controls.append(field);
  }
const next = element("button", "Older receipts");
next.hidden = true;
controls.append(next);
const table = (headers: string[], rows: string[][]) => {
  const wrapper = element("div");
  wrapper.className = "table-scroll";
  const table = element("table");
  const head = element("thead");
  const headRow = element("tr");
  for (const title of headers) {
    const th = element("th", title);
    th.scope = "col";
    headRow.append(th);
  }
  head.append(headRow);
  table.append(head);
  const body = element("tbody");
  for (const row of rows) {
    const tr = element("tr");
    for (const value of row) tr.append(element("td", value));
    body.append(tr);
  }
  table.append(body);
  wrapper.append(table);
  return wrapper;
};
const money = (value: unknown, currency: unknown) => {
  const code = label(currency);
  if (!/^[A-Z]{3}$/.test(code)) throw Error("Invalid currency");
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: code,
  }).format(number(value) / 100);
};
const renderStatus = (data: Record<string, unknown>, target: HTMLElement) => {
  if (!record(data.credits) || typeof data.portalAccess !== "boolean")
    throw Error("Invalid billing report");
  const cards = element("dl");
  cards.className = "cards";
  for (const [key, title] of [
    ["remaining", "Available"],
    ["reserved", "Reserved"],
    ["purchased", "Purchased remaining"],
    ["promotional", "Promotional remaining"],
    ["debt", "Credit debt"],
  ]) {
    const card = element("div");
    card.append(
      element("dt", title),
      element("dd", number(data.credits[key!]).toLocaleString()),
    );
    cards.append(card);
  }
  target.append(
    cards,
    element(
      "p",
      `Portal access: ${data.portalAccess ? "enabled" : "not enabled"}.`,
    ),
  );
  if (record(data.subscription))
    target.append(
      element(
        "p",
        `Subscription: ${label(data.subscription.status)}${data.subscription.cancelAtPeriodEnd === true ? " · renewal canceled" : ""}`,
      ),
    );
  else if (data.subscription === null)
    target.append(
      element(
        "p",
        "No subscription. Funded MCP use does not require portal access.",
      ),
    );
  else throw Error("Invalid subscription report");
  if (data.automaticRefill !== false) throw Error("Unsupported refill state");
  target.append(element("p", "Automatic refill is off."));
};
const renderUsage = (data: Record<string, unknown>, target: HTMLElement) => {
  const from = label(data.from),
    to = label(data.to);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    throw Error("Invalid range");
  const consumed = number(data.creditsConsumed),
    events = number(data.events);
  target.append(
    element(
      "p",
      `${consumed.toLocaleString()} credits across ${events.toLocaleString()} recorded events. ${from} inclusive to ${to} exclusive (UTC).`,
    ),
  );
  if (
    !Array.isArray(data.byFeature) ||
    data.byFeature.length > 21 ||
    !Array.isArray(data.byDay) ||
    data.byDay.length > 90
  )
    throw Error("Invalid usage rows");
  const featureRows = data.byFeature.map((row) => {
    if (!record(row)) throw Error("Invalid feature");
    return [
      label(row.feature),
      number(row.credits).toLocaleString(),
      number(row.events).toLocaleString(),
    ];
  });
  target.append(table(["Feature", "Credits", "Events"], featureRows));
  const daily = element("details");
  daily.append(
    element("summary", "Daily usage"),
    table(
      ["UTC day", "Credits", "Events"],
      data.byDay.map((row) => {
        if (!record(row)) throw Error("Invalid day");
        return [
          label(row.day),
          number(row.credits).toLocaleString(),
          number(row.events).toLocaleString(),
        ];
      }),
    ),
  );
  target.append(daily);
  if (events === 0)
    target.append(element("p", "No recorded usage in this range."));
  start.value = from;
  end.value = to;
  currentArgs = { from, to };
};
const renderReceipts = (data: Record<string, unknown>, target: HTMLElement) => {
  if (!Array.isArray(data.receipts) || data.receipts.length > 50)
    throw Error("Invalid receipts");
  const cursor = data.nextCursor;
  if (
    cursor !== null &&
    (typeof cursor !== "string" ||
      cursor.length > 256 ||
      !/^[A-Za-z0-9_-]+$/.test(cursor))
  )
    throw Error("Invalid page cursor");
  const rows = data.receipts.map((row) => {
    if (!record(row)) throw Error("Invalid receipt");
    const issued = label(row.issuedAt);
    if (!Number.isFinite(Date.parse(issued)))
      throw Error("Invalid receipt date");
    return [
      new Date(issued).toLocaleString(),
      label(row.source).replaceAll("_", " "),
      money(row.amountCents, row.currency),
      money(row.refundedAmountCents, row.currency),
      label(row.status).replaceAll("_", " "),
    ];
  });
  target.append(
    table(["Date", "Payment", "Amount", "Refunded", "Status"], rows),
  );
  if (!rows.length) target.append(element("p", "No receipts on this page."));
  nextCursor = cursor;
  next.hidden = cursor === null;
};
const render = (result: unknown) => {
  try {
    if (
      !record(result) ||
      result.isError === true ||
      !record(result.structuredContent)
    )
      throw Error("Report unavailable");
    const target = element("div");
    if (view === "status") renderStatus(result.structuredContent, target);
    else if (view === "usage") renderUsage(result.structuredContent, target);
    else renderReceipts(result.structuredContent, target);
    output.replaceChildren(target);
    message.textContent = "Report loaded. Refresh to check for changes.";
  } catch {
    message.textContent =
      "Could not display this report. Use the assistant’s text result or refresh; any previous report remains visible.";
  }
};
const load = async (older = false) => {
  if (!ready || busy) return;
  busy = true;
  refresh.disabled = true;
  next.disabled = true;
  message.textContent = "Loading…";
  const args =
    view === "usage"
      ? { from: start.value, to: end.value }
      : view === "receipts"
        ? { limit: 20, ...(older && nextCursor ? { cursor: nextCursor } : {}) }
        : {};
  try {
    render(await app.callServerTool({ name: toolName, arguments: args }));
  } catch {
    message.textContent =
      "Could not refresh. Your session or host permission may have changed. Ask your assistant to run the report again.";
  } finally {
    busy = false;
    refresh.disabled = false;
    next.disabled = false;
  }
};
refresh.addEventListener("click", () => void load());
next.addEventListener("click", () => void load(true));
app.ontoolinput = ({ arguments: args }) => {
  currentArgs = record(args) ? args : {};
  if (view === "usage") {
    if (typeof currentArgs.from === "string") start.value = currentArgs.from;
    if (typeof currentArgs.to === "string") end.value = currentArgs.to;
  }
};
app.ontoolresult = render;
app.ontoolcancelled = () => {
  message.textContent = "Report canceled. Ask your assistant to retry.";
};
await app
  .connect()
  .then(() => {
    ready = true;
    refresh.disabled = false;
  })
  .catch(() => {
    message.textContent =
      "This host could not open the interactive view. Use the report in your assistant instead.";
  });
