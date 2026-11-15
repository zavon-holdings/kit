import { useState } from "react";
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as conditions from "@zavon/conditions";
import { compile } from "@zavon/workflow-graph";
import { FALLBACK_OUTCOME, FIXED_OUTCOMES, NODE_KINDS, edgeRole } from "../catalogue.js";
import { BUILT_IN_INSPECTORS, EmailReplyInspector, emailReplyProblems } from "./inspectors.js";
import type { Graph, GraphNode } from "../types.js";

// Email and Await Reply: an email whose replies come back to the record, and
// a wait — replied, or no_reply when nothing comes back in time.

function Harness({ onConfig }: { onConfig: (c: Record<string, unknown>) => void }) {
  const [config, setConfig] = useState<Record<string, unknown>>({ to: "", subject: "", body: "", wait: { value: 3, unit: "days" } });
  const node: GraphNode = { id: "ask", type: "email_reply", config };
  return (
    <EmailReplyInspector
      node={node}
      readOnly={false}
      onChange={(c) => {
        setConfig(c);
        onConfig(c);
      }}
    />
  );
}

describe("the Email and Await Reply node", () => {
  test("is a Messages node whose silence is its default way", () => {
    expect(NODE_KINDS.find((k) => k.type === "email_reply")?.group).toBe("Messages");
    expect(FIXED_OUTCOMES.email_reply).toEqual(["replied", "no_reply"]);
    expect(FALLBACK_OUTCOME.email_reply).toBe("no_reply");
    expect(edgeRole("email_reply", 1)).toBe("routes");
    expect(BUILT_IN_INSPECTORS.email_reply).toBe(EmailReplyInspector);
  });

  test("compiles to core's own call and a wait that times out at the wait itself", () => {
    const g: Graph = {
      format: "workflow.graph/1",
      nodes: [
        { id: "start", type: "start" },
        { id: "ask", type: "email_reply", config: { to: "{{vars.email}}", subject: "Your booking", body: "How many?", wait: { value: 3, unit: "days" } } },
        { id: "done", type: "end", config: { outcome: "replied" } },
        { id: "quiet", type: "end", config: { outcome: "no_reply" } },
      ],
      edges: [
        { from: "start", to: "ask" },
        { from: "ask", to: "done", label: "replied" },
        { from: "ask", to: "quiet", label: "no_reply", default: true },
      ],
    };
    const steps = compile(g, { conditions: { parse: conditions.parse, fields: conditions.fields } }).steps ?? [];
    expect(steps.find((s) => s.code === "ask--email")?.config).toMatchObject({ action: "core.email.await_reply" });
    expect(steps.find((s) => s.code === "ask--wait")?.config).toMatchObject({
      event: ["core.email.replied"],
      match: { event_field: "reference", var: "email_reply.ask.reference" },
      timeout: { value: 3, unit: "days" },
    });
  });

  test("its editor writes the email and says what is missing", async () => {
    const user = userEvent.setup();
    let last: Record<string, unknown> = {};
    render(<Harness onConfig={(c) => (last = c)} />);
    expect(screen.getByText("Say whom the email is to.")).toBeTruthy();
    await user.type(screen.getByLabelText("To (an address, or a run value: {{vars.email}})"), "guest@example.test");
    await user.type(screen.getByLabelText("Subject"), "Your booking");
    await user.type(screen.getByLabelText("Message"), "How many guests?");
    expect(last).toMatchObject({ to: "guest@example.test", subject: "Your booking", body: "How many guests?" });
    expect(emailReplyProblems(last)).toEqual([]);
    expect(emailReplyProblems({ to: "the guest", subject: "x", body: "y" })).toHaveLength(1);
  });
});
