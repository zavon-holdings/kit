import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as conditions from "@zavon/conditions";
import { compile } from "@zavon/workflow-graph";
import { NODE_KINDS, edgeRole } from "../catalogue.js";
import { BUILT_IN_INSPECTORS } from "./inspectors.js";
import { SHARED_WHATSAPP_TEMPLATES, SmsInspector, WhatsAppInspector, smsParts, smsProblems, whatsAppProblems } from "./MessageInspectors.js";
import type { Graph, GraphNode } from "../types.js";

// Send a WhatsApp: a notification core sends from the shared number. One way
// on; its editor offers the shared templates (the contract's list), a line per
// parameter after the organisation's name, and who it goes to.

function Harness({ onConfig }: { onConfig: (c: Record<string, unknown>) => void }) {
  const [config, setConfig] = useState<Record<string, unknown>>({ to: [] });
  const node: GraphNode = { id: "tell", type: "whatsapp", config };
  return (
    <WhatsAppInspector
      node={node}
      readOnly={false}
      onChange={(c) => {
        setConfig(c);
        onConfig(c);
      }}
    />
  );
}

describe("the Send a WhatsApp node", () => {
  test("offers exactly the contract's shared templates", () => {
    const v = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "..", "..", "contract", "whatsapp", "shared-templates.json"), "utf8"));
    expect(SHARED_WHATSAPP_TEMPLATES).toEqual(v.templates);
    expect(NODE_KINDS.find((k) => k.type === "whatsapp")?.group).toBe("Messages");
    expect(edgeRole("whatsapp", 1)).toBe("sequence");
    expect(BUILT_IN_INSPECTORS.whatsapp).toBe(WhatsAppInspector);
  });

  test("compiles to a notification core sends itself", () => {
    const g: Graph = {
      format: "workflow.graph/1",
      nodes: [
        { id: "start", type: "start" },
        { id: "tell", type: "whatsapp", config: { template: "zavon_update", params: ["hello"], to: [{ subject: true }] } },
        { id: "done", type: "end" },
      ],
      edges: [
        { from: "start", to: "tell" },
        { from: "tell", to: "done" },
      ],
    };
    const step = compile(g, { conditions: { parse: conditions.parse, fields: conditions.fields } }).steps?.find((s) => s.code === "tell");
    expect(step?.kind).toBe("notification");
    expect(step?.config).toMatchObject({ channel: "whatsapp", via: "core", template: "zavon_update" });
  });

  test("its editor writes the template, its line and the people", async () => {
    const user = userEvent.setup();
    let last: Record<string, unknown> = {};
    render(<Harness onConfig={(c) => (last = c)} />);
    await user.selectOptions(screen.getByLabelText("Template"), "zavon_reminder");
    await user.type(screen.getByLabelText("Line 1"), "the camp starts tomorrow");
    await user.click(screen.getByLabelText("The Record's Person"));
    await user.type(screen.getByLabelText("Numbers (one per line, +27…)"), "+27820000001");
    expect(last).toMatchObject({ template: "zavon_reminder", params: ["the camp starts tomorrow"], to: [{ subject: true }, { people: [{ phone: "+27820000001" }] }] });
    expect(whatsAppProblems(last)).toEqual([]);
    expect(screen.getByText(/A reminder from <the organisation>: the camp starts tomorrow/)).toBeTruthy();
  });
});

function SmsHarness({ onConfig }: { onConfig: (c: Record<string, unknown>) => void }) {
  const [config, setConfig] = useState<Record<string, unknown>>({ to: [] });
  return (
    <SmsInspector
      node={{ id: "text", type: "sms", config }}
      readOnly={false}
      onChange={(c) => {
        setConfig(c);
        onConfig(c);
      }}
    />
  );
}

describe("the SMS by SMSPortal node", () => {
  test("compiles to a notification through the property's SMSPortal account, SMS or WhatsApp", () => {
    const g = (config: Record<string, unknown>): Graph => ({
      format: "workflow.graph/1",
      nodes: [
        { id: "start", type: "start" },
        { id: "text", type: "sms", config },
        { id: "done", type: "end" },
      ],
      edges: [
        { from: "start", to: "text" },
        { from: "text", to: "done" },
      ],
    });
    const opts = { conditions: { parse: conditions.parse, fields: conditions.fields } };
    const sms = compile(g({ body_text: "Hi", to: [{ subject: true }] }), opts).steps?.find((s) => s.code === "text");
    expect(sms?.config).toMatchObject({ channel: "sms", via: "core", provider: "smsportal", body_text: "Hi" });
    const wa = compile(g({ channel: "whatsapp", template: "camp", params: ["a"], to: [{ subject: true }] }), opts).steps?.find((s) => s.code === "text");
    expect(wa?.config).toMatchObject({ channel: "whatsapp", via: "core", provider: "smsportal", template: "camp" });
    expect(BUILT_IN_INSPECTORS.sms).toBe(SmsInspector);
    expect(edgeRole("sms", 1)).toBe("sequence");
  });

  test("its editor counts an SMS's parts and switches to the account's WhatsApp", async () => {
    const user = userEvent.setup();
    let last: Record<string, unknown> = {};
    render(<SmsHarness onConfig={(c) => (last = c)} />);
    await user.type(screen.getByLabelText("Message"), "x".repeat(161));
    expect(screen.getByText(/161 characters · 2 parts/)).toBeTruthy();
    expect(smsParts("x".repeat(160))).toBe(1);
    await user.selectOptions(screen.getByLabelText("Channel"), "whatsapp");
    await user.type(screen.getByLabelText("Template"), "camp_reminder");
    await user.click(screen.getByRole("button", { name: "Add a Parameter" }));
    await user.type(screen.getByLabelText("Parameter 1"), "Thandi");
    await user.type(screen.getByLabelText("Numbers (one per line, +27…)"), "+27820000001");
    expect(last).toMatchObject({ channel: "whatsapp", template: "camp_reminder", params: ["Thandi"] });
    expect(last.body_text).toBeUndefined();
    expect(smsProblems(last)).toEqual([]);
  });
});
