import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import {
  projectActionReview,
  projectActionJob,
  type ActionReview,
} from "../src/actionWorkflow";
const app = new App(
  { name: "Action review and progress", version: "1.0.0" },
  {},
  { autoResize: true },
);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
const root = el("main"),
  status = el("p", "Waiting for the assistant…"),
  output = el("section"),
  refresh = el("button", "Refresh"),
  reviewButton = el("button", "Review approval"),
  confirm = el("button", "Approve and queue"),
  cancel = el("button", "Cancel review"),
  warning = el("p");
status.setAttribute("role", "status");
root.append(
  el("h1", "Action and progress"),
  status,
  output,
  refresh,
  reviewButton,
  warning,
  confirm,
  cancel,
);
document.body.append(root);
let review: ActionReview | null = null,
  actionId: string | null = null,
  view: "review" | "job" = "job",
  pending = false,
  ready = false,
  busy = false;
const controls = () => {
  refresh.disabled = !ready || !actionId || busy;
  reviewButton.hidden = !review;
  reviewButton.disabled = !ready || busy;
  confirm.hidden = !pending;
  cancel.hidden = !pending;
  confirm.disabled = busy;
  cancel.disabled = busy;
};
const clear = () => {
  pending = false;
  warning.textContent = "";
  controls();
};
const render = (result: unknown) => {
  review = null;
  clear();
  output.replaceChildren();
  try {
    if (
      !result ||
      typeof result !== "object" ||
      !("structuredContent" in result) ||
      ("isError" in result && result.isError)
    )
      throw Error("Unavailable");
    const data = result.structuredContent;
    if (data && typeof data === "object" && "revision" in data) {
      review = projectActionReview(data);
      actionId = review.actionId;
      view = "review";
      output.append(
        el("h2", review.title),
        el("p", `To: ${review.recipients.join(", ")}`),
        el("h3", review.subject),
        el("pre", review.body),
        el("p", review.consequence),
        el("p", `Approval expires: ${review.expiresAt}`),
      );
      status.textContent =
        "Read the full message and consequences before approving.";
    } else {
      const job = projectActionJob(data);
      actionId = job.actionId;
      view = "job";
      output.append(
        el("h2", job.title),
        el("p", `Status: ${job.status}`),
        el("p", job.summary),
      );
      status.textContent =
        "Saved job status. Refresh reads only; it never restarts work.";
    }
  } catch {
    status.textContent =
      "Result unavailable. Refresh saved status before taking any further action.";
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
    review = null;
    view = "job";
    clear();
    output.replaceChildren();
    status.textContent =
      "Outcome not confirmed. Refresh job status; do not repeat approval or create a replacement action.";
  } finally {
    busy = false;
    controls();
  }
};
refresh.onclick = () => {
  clear();
  if (actionId)
    void call(view === "review" ? "get_action_review" : "get_action_job", {
      actionId,
    });
};
reviewButton.onclick = () => {
  if (!review || busy) return;
  if (Date.parse(review.expiresAt) <= Date.now()) {
    status.textContent = "This review expired. Refresh before proceeding.";
    clear();
    return;
  }
  pending = true;
  warning.textContent =
    "Approving queues this exact message to the recipients shown above. It can send outside this service. Cancel to leave it unapproved.";
  controls();
};
cancel.onclick = clear;
confirm.onclick = () => {
  if (!pending || !review || busy) return;
  if (Date.parse(review.expiresAt) <= Date.now()) {
    clear();
    status.textContent = "Approval expired. Refresh the review.";
    return;
  }
  const args = { actionId: review.actionId, expectedRevision: review.revision };
  view = "job";
  void call("confirm_action_review", args);
};
app.ontoolresult = render;
app.ontoolcancelled = () => {
  review = null;
  clear();
  output.replaceChildren();
  status.textContent = "Canceled. Refresh saved status to recover.";
};
const theme = (ctx: ReturnType<typeof app.getHostContext>) => {
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
};
app.onhostcontextchanged = theme;
controls();
await app
  .connect()
  .then(() => {
    ready = true;
    theme(app.getHostContext());
    controls();
  })
  .catch(() => {
    status.textContent = "Use the assistant's review and status tools instead.";
  });
