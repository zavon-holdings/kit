import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as conditions from "@zavon/conditions";
import { compile } from "@zavon/workflow-graph";
import { FIXED_OUTCOMES, NODE_KINDS, edgeRole, isMoney } from "../catalogue.js";
import { BUILT_IN_INSPECTORS, SignatureInspector, signatureProblems } from "./inspectors.js";
import type { Graph, GraphNode } from "../types.js";

// A signature request: a copy of a document in Signatures sent to the people
// the step names, and a wait — signed, declined or lapsed.

function Harness({ onConfig }: { onConfig: (c: Record<string, unknown>) => void }) {
  const [config, setConfig] = useState<Record<string, unknown>>({ template: "", signers: {}, deadline: { value: 14, unit: "days" } });
  const node: GraphNode = { id: "lease", type: "signature", config };
  return (
    <SignatureInspector
      node={node}
      readOnly={false}
      onChange={(c) => {
        setConfig(c);
        onConfig(c);
      }}
    />
  );
}

describe("the Signature Request node", () => {
  test("is a People node whose ways out are its outcomes", () => {
    expect(NODE_KINDS.find((k) => k.type === "signature")?.group).toBe("People");
    expect(FIXED_OUTCOMES.signature).toEqual(["signed", "declined", "lapsed"]);
    expect(edgeRole("signature", 1)).toBe("routes");
    expect(isMoney("signature")).toBe(true);
    expect(BUILT_IN_INSPECTORS.signature).toBe(SignatureInspector);
  });

  test("compiles to core's own call and a wait on its events", () => {
    const g: Graph = {
      format: "workflow.graph/1",
      nodes: [
        { id: "start", type: "start" },
        { id: "lease", type: "signature", config: { template: "3f2c9a1e-6b7d-4c1a-9e0f-5a8b7c6d5e4f", signers: { tenant: { email: "{{vars.email}}" } }, deadline: { value: 14, unit: "days" } } },
        { id: "done", type: "end", config: { outcome: "signed" } },
        { id: "late", type: "end", config: { outcome: "lapsed" } },
      ],
      edges: [
        { from: "start", to: "lease" },
        { from: "lease", to: "done", label: "signed" },
        { from: "lease", to: "late", label: "lapsed", default: true },
      ],
    };
    const steps = compile(g, { conditions: { parse: conditions.parse, fields: conditions.fields } }).steps ?? [];
    expect(steps.find((s) => s.code === "lease--send")?.config).toMatchObject({ action: "core.signature.request" });
    expect(steps.find((s) => s.code === "lease--wait")?.config).toMatchObject({
      event: ["core.signature.signed", "core.signature.declined", "core.signature.lapsed"],
      match: { event_field: "reference", var: "signature.lease.reference" },
    });
  });

  test("says what core refuses at the save, as kit's contract marks", () => {
    const v = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "..", "..", "contract", "esign", "signature-step.json"), "utf8"));
    expect(signatureProblems(v.input)).toEqual([]);
    for (const r of v.refused) expect(signatureProblems(r.input).length > 0, r.why).toBe(r.editor);
  });

  test("its editor names the template and who signs", async () => {
    const user = userEvent.setup();
    let last: Record<string, unknown> = {};
    render(<Harness onConfig={(c) => (last = c)} />);
    expect(screen.getByText("Name the request in Signatures to send a copy of.")).toBeTruthy();
    await user.type(screen.getByLabelText("Template (the request's uid in Signatures)"), "3f2c9a1e-6b7d-4c1a-9e0f-5a8b7c6d5e4f");
    await user.click(screen.getByRole("button", { name: "Add a Signer" }));
    await user.type(screen.getByLabelText("Signer 1 Key"), "tenant");
    await user.type(screen.getByLabelText("Signer 1 Email"), "laila@client.test");
    await user.click(screen.getByLabelText("Remind Signers on the platform's schedule"));
    expect(last).toMatchObject({ template: "3f2c9a1e-6b7d-4c1a-9e0f-5a8b7c6d5e4f", signers: { tenant: { email: "laila@client.test" } }, remind_signers: true });
    expect(signatureProblems(last)).toEqual([]);
    expect(signatureProblems({ template: "x", signers: { Tenant: {} } })).toHaveLength(2);
  });
});
