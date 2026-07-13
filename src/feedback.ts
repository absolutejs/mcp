// The feedback surface every MCP server needs and none of them have.
//
// A connected AI client (Claude, Cursor) gives a server NO way to render UI —
// there is no button to click, no form to fill. So when a user says "that was
// wrong" or "this is broken", the only path back to the server's team is the
// model itself relaying it through a tool call. Every MCP server hits this the
// moment it has real users, and every one of them will hand-roll the same two
// tools.
//
// These are those two tools, with the storage left to the host. Spread them
// into your registry and append FEEDBACK_INSTRUCTIONS to `instructions` — that
// sentence is the load-bearing part: without it a model apologises to the user
// and the signal dies where it was spoken.
import type { McpToolRegistry } from "./types";

export type McpFeedbackRating = "bad" | "good";

export type McpProblemReport = {
  /** What the user expected instead. */
  expected?: string;
  /** What is broken, in the user's words. */
  problem: string;
  /** How to reproduce it. */
  steps?: string;
  /** Where it happened — a page, a feature, a tool name. */
  where?: string;
};

export type McpFeedbackReport = {
  rating: McpFeedbackRating;
  /** Why — in the USER's words, not the model's summary. */
  reason: string;
  /** The tool the feedback is about, if it was about one. */
  tool?: string;
};

/** Where feedback goes. Both handlers return the sentence the model relays back
 *  to the user, so the host controls what it promises them (a ticket id, an
 *  SLA, a thank-you). Returning nothing is fine — a default is used. */
export type McpFeedbackStore<Caller> = {
  reportProblem: (input: {
    caller: Caller;
    report: McpProblemReport;
  }) => Promise<string | void> | string | void;
  submitFeedback: (input: {
    caller: Caller;
    feedback: McpFeedbackReport;
  }) => Promise<string | void> | string | void;
};

/** Append to your server's `instructions`. Without this the model treats a
 *  complaint as something to apologise for rather than something to report. */
export const FEEDBACK_INSTRUCTIONS =
  "FEEDBACK: you are the user's only channel back to this server's team — there are no buttons in this client. If the user says something was wrong, unhelpful, or not what they asked for, call submit_feedback with their reason in their own words; if something is outright broken, call report_problem. Do this INSTEAD of only apologising, and tell them you've passed it on. Log the good as well as the bad.";

const asText = (input: unknown, key: string) => {
  if (typeof input !== "object" || input === null) return undefined;
  const value = Reflect.get(input, key);

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
};

const isRating = (value: unknown): value is McpFeedbackRating =>
  value === "good" || value === "bad";

/** The two tools, bound to one caller. Call inside your `tools` factory:
 *
 *  ```ts
 *  tools: ({ caller }) => ({
 *    ...myTools(caller),
 *    ...feedbackTools({ caller, store }),
 *  })
 *  ```
 */
export const feedbackTools = <Caller>(config: {
  caller: Caller;
  store: McpFeedbackStore<Caller>;
}): McpToolRegistry => ({
  report_problem: {
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
      title: "Report a problem",
    },
    description:
      "Report a bug or broken behaviour on the user's behalf. Use when the user says something is broken, wrong, or not working — confirm the details with them first, then file it. Reports as THIS user's account.",
    handler: async (args) => {
      const problem = asText(args, "problem");
      if (!problem) return "Tell me what's broken and I'll report it.";
      const reply = await config.store.reportProblem({
        caller: config.caller,
        report: {
          expected: asText(args, "expected"),
          problem,
          steps: asText(args, "steps"),
          where: asText(args, "where"),
        },
      });

      return reply ?? "Reported. Tell the user it's been filed with the team.";
    },
    inputSchema: {
      properties: {
        expected: {
          description: "What the user expected to happen",
          type: "string",
        },
        problem: {
          description: "What is broken, in the user's words — one sentence",
          type: "string",
        },
        steps: { description: "How to reproduce it", type: "string" },
        where: {
          description: "Where it happened (page, feature, or tool)",
          type: "string",
        },
      },
      required: ["problem"],
      type: "object",
    },
  },
  submit_feedback: {
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
      title: "Pass on feedback",
    },
    description:
      "Record the user's verdict on how this is going — call whenever they say a result was wrong, unhelpful, or missed what they asked for (rating 'bad'), or that something worked well (rating 'good'). Pass their reason in their OWN words. This is the only way feedback from this client reaches the team, so use it rather than only apologising.",
    handler: async (args) => {
      const rating = Reflect.get(args ?? {}, "rating");
      const reason = asText(args, "reason");
      if (!isRating(rating) || !reason) {
        return "Provide the rating ('good' or 'bad') and the user's reason.";
      }
      const reply = await config.store.submitFeedback({
        caller: config.caller,
        feedback: { rating, reason, tool: asText(args, "tool") },
      });

      return (
        reply ??
        (rating === "bad"
          ? "Passed on to the team, with the user's reason attached."
          : "Logged as positive feedback.")
      );
    },
    inputSchema: {
      properties: {
        rating: {
          description: "'good' or 'bad'",
          enum: ["good", "bad"],
          type: "string",
        },
        reason: {
          description: "What was wrong (or right), in the user's own words",
          type: "string",
        },
        tool: {
          description: "The tool this is about, if it was about one",
          type: "string",
        },
      },
      required: ["rating", "reason"],
      type: "object",
    },
  },
});
