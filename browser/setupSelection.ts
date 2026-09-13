import { App } from "@modelcontextprotocol/ext-apps";
import {
  projectSetupSelection,
  type SetupSelection,
  type SetupConfirmation,
} from "../src/setupSelection";
const app = new App(
  { name: "Business selection", version: "1.0.0" },
  {},
  { autoResize: true },
);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
const root = el("main");
document.body.append(root);
root.append(el("h1", "Choose your active business"));
const status = el("p", "Waiting for setup options…");
status.setAttribute("role", "status");
const label = el("label", "Business");
const select = el("select");
label.append(select);
const refresh = el("button", "Refresh options"),
  review = el("button", "Review change"),
  confirm = el("button", "Confirm selection"),
  cancel = el("button", "Cancel review");
const summary = el("p");
root.append(
  status,
  label,
  refresh,
  review,
  summary,
  confirm,
  cancel,
  el(
    "p",
    "This changes the active business across the service. No credits are charged and nothing is sent.",
  ),
);
let state: SetupSelection | null = null,
  pending: SetupConfirmation | null = null,
  ready = false,
  busy = false;
const controls = () => {
  select.disabled = !state || busy;
  refresh.disabled = !ready || busy;
  review.disabled = !ready || !state || busy;
  confirm.hidden = !pending;
  cancel.hidden = !pending;
  confirm.disabled = busy;
  cancel.disabled = busy;
};
const clearReview = () => {
  pending = null;
  summary.textContent = "";
  controls();
};
const render = (result: unknown) => {
  state = null;
  clearReview();
  select.replaceChildren();
  try {
    if (
      !result ||
      typeof result !== "object" ||
      !("structuredContent" in result) ||
      ("isError" in result && result.isError)
    )
      throw Error("Unavailable");
    state = projectSetupSelection(result.structuredContent);
    const all = el("option", "All businesses");
    all.value = "";
    select.append(all);
    for (const item of state.options) {
      const option = el("option", item.label);
      option.value = item.id;
      select.append(option);
    }
    select.value = state.selectedId ?? "";
    status.textContent =
      "Current selection loaded. Review a change before confirming.";
  } catch {
    status.textContent =
      "Setup is unavailable or changed. Refresh options before reviewing again.";
  }
  controls();
};
const call = async (name: string, args: Record<string, unknown>) => {
  if (!ready || busy) return;
  busy = true;
  controls();
  try {
    render(await app.callServerTool({ name, arguments: args }));
  } catch {
    state = null;
    clearReview();
    select.replaceChildren();
    status.textContent =
      "The result could not be confirmed. Refresh options to check current state; do not repeat the old confirmation.";
  } finally {
    busy = false;
    controls();
  }
};
select.addEventListener("change", clearReview);
refresh.addEventListener("click", () => {
  clearReview();
  void call("get_setup_options", {});
});
review.addEventListener("click", () => {
  if (!state || busy) return;
  pending = {
    expectedRevision: state.revision,
    selectedId: select.value || null,
  };
  summary.textContent = `Change the active business to ${state.options.find((option) => option.id === pending!.selectedId)?.label ?? "All businesses"}? This approval applies only to the setup revision you just reviewed.`;
  controls();
});
cancel.addEventListener("click", clearReview);
confirm.addEventListener("click", () => {
  if (pending && !busy) void call("confirm_setup_selection", { ...pending });
});
app.ontoolresult = render;
app.ontoolcancelled = () => {
  state = null;
  clearReview();
  select.replaceChildren();
  status.textContent = "Canceled. Refresh options to recover.";
};
controls();
await app
  .connect()
  .then(() => {
    ready = true;
    controls();
  })
  .catch(() => {
    status.textContent =
      "Use the assistant's setup options and explicit confirmation tools instead.";
  });
