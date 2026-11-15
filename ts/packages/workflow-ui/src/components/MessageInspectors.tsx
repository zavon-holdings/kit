"use client";

import { useState } from "react";
import type { InspectorProps } from "../types.js";

/**
 * The phone messages core sends itself (a notification with via core):
 * "Send a WhatsApp" on Zavon's shared number. The organisation's name is
 * the template's first variable and core fills it; the step gives the rest.
 * Only people who agreed to WhatsApp are messaged — the time a var carries
 * (consented_at) or their own preferences — and anybody who cannot be
 * reached that way gets the email instead, when there is an address.
 */

/** The shared number's templates a workflow may send (kit contract/whatsapp/shared-templates.json). */
export const SHARED_WHATSAPP_TEMPLATES: readonly { name: string; params: number; body: string }[] = Object.freeze([
  { name: "zavon_reminder", params: 1, body: "A reminder from {{1}}: {{2}}. Tap Open to see it in Zavon." },
  { name: "zavon_task", params: 1, body: "You have a new task from {{1}}: {{2}}. Tap Open to see it in Zavon." },
  { name: "zavon_update", params: 1, body: "An update from {{1}}: {{2}}. Tap Open for the details in Zavon." },
]);

type Source = { subject?: boolean; var?: string; people?: { phone?: string; email?: string; name?: string }[] } & Record<string, unknown>;

/** Who a message goes to: the subject, a var holding people, and numbers typed in; other sources kept. */
export function Recipients({ value, onChange, legend = "Recipients" }: { value: Source[] | undefined; onChange: (to: Source[]) => void; legend?: string }) {
  const to = value ?? [];
  const subject = to.some((s) => s.subject);
  const varSrc = to.find((s) => typeof s.var === "string");
  const typed = to.filter((s) => Array.isArray(s.people)).flatMap((s) => s.people ?? []);
  const others = to.filter((s) => !s.subject && typeof s.var !== "string" && !Array.isArray(s.people));
  const [phones, setPhones] = useState(typed.map((p) => p.phone ?? p.email ?? "").join("\n"));
  const write = (patch: { subject?: boolean; varPath?: string; list?: string }) => {
    const out: Source[] = [...others];
    if (patch.subject ?? subject) out.push({ subject: true });
    const v = patch.varPath ?? varSrc?.var ?? "";
    if (v) out.push({ var: v });
    const list = (patch.list ?? phones)
      .split(/[\n,]/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (list.length) out.push({ people: list.map((x) => (x.includes("@") ? { email: x } : { phone: x })) });
    onChange(out);
  };
  return (
    <div className="zwf-group" role="group" aria-label={legend}>
      <p className="zwf-subheading">{legend}</p>
      <label className="zwf-check">
        <input type="checkbox" checked={subject} onChange={(e) => write({ subject: e.target.checked })} />
        <span>The Record&apos;s Person</span>
      </label>
      <label className="zwf-field">
        <span>People in a Var</span>
        <input value={varSrc?.var ?? ""} spellCheck={false} placeholder="vars.attendees" onChange={(e) => write({ varPath: e.target.value })} />
      </label>
      <label className="zwf-field">
        <span>Numbers (one per line, +27…)</span>
        <textarea
          rows={2}
          value={phones}
          spellCheck={false}
          onChange={(e) => {
            setPhones(e.target.value);
            write({ list: e.target.value });
          }}
        />
      </label>
      {others.length > 0 && (
        <p className="zwf-muted">
          And {others.length} other source{others.length === 1 ? "" : "s"} of people (a role, a permission or an app&apos;s list), kept as set.
        </p>
      )}
      <p className="zwf-muted">A var holds numbers, or people with phone, email and consented_at (when they agreed to be messaged).</p>
    </div>
  );
}

type WhatsAppConfig = {
  template?: string;
  params?: string[];
  to?: Source[];
  subject?: string;
  body_text?: string;
  link?: { url: string; label?: string };
} & Record<string, unknown>;

/** What is not yet right about a Send a WhatsApp node, in words. */
export function whatsAppProblems(c: WhatsAppConfig): string[] {
  const out: string[] = [];
  const t = SHARED_WHATSAPP_TEMPLATES.find((x) => x.name === c.template);
  if (!t) out.push("Choose one of the shared number's templates.");
  else if ((c.params ?? []).length !== t.params || (c.params ?? []).some((p) => !p.trim())) out.push(`The template takes ${t.params} line(s) after the organisation's name.`);
  if (!(c.to ?? []).length) out.push("Name who the message goes to.");
  return out;
}

export function WhatsAppInspector({ node, onChange, readOnly }: InspectorProps) {
  const config = (node.config ?? {}) as WhatsAppConfig;
  const set = (patch: Partial<WhatsAppConfig>) => {
    const next: Record<string, unknown> = { ...config, ...patch };
    for (const k of ["subject", "body_text"]) if (next[k] === "") delete next[k];
    if (next.link && !(next.link as { url: string }).url) delete next.link;
    onChange(next);
  };
  const template = SHARED_WHATSAPP_TEMPLATES.find((t) => t.name === config.template);
  const params = config.params ?? [];
  const preview = template
    ? template.body.replace("{{1}}", "<the organisation>").replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 2] || `<line ${Number(n) - 1}>`)
    : "";
  const problems = whatsAppProblems(config);
  return (
    <fieldset className="zwf-group" disabled={readOnly}>
      <legend>Send a WhatsApp</legend>
      <p className="zwf-muted">
        From Zavon&apos;s shared number, for an organisation without its own. Each message costs credits from the organisation&apos;s wallet. People who said STOP, or
        never agreed to WhatsApp, get the email instead.
      </p>
      <label className="zwf-field">
        <span>Template</span>
        <select
          value={config.template ?? ""}
          onChange={(e) => {
            const t = SHARED_WHATSAPP_TEMPLATES.find((x) => x.name === e.target.value);
            set({ template: e.target.value || undefined, params: t ? Array.from({ length: t.params }, (_, i) => params[i] ?? "") : [] });
          }}
        >
          <option value="">Choose a Template</option>
          {SHARED_WHATSAPP_TEMPLATES.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {template &&
        params.map((p, i) => (
          <label key={i} className="zwf-field">
            <span>Line {i + 1}</span>
            <input value={p} placeholder="{{vars.event}} starts tomorrow" onChange={(e) => set({ params: params.map((x, k) => (k === i ? e.target.value : x)) })} />
          </label>
        ))}
      {preview && <p className="zwf-says">{preview}</p>}
      <Recipients value={config.to} onChange={(to) => set({ to })} />
      <label className="zwf-field">
        <span>Email Subject</span>
        <input value={config.subject ?? ""} placeholder="The email sent instead, when WhatsApp cannot be" onChange={(e) => set({ subject: e.target.value })} />
      </label>
      <label className="zwf-field">
        <span>Open Link</span>
        <input value={config.link?.url ?? ""} spellCheck={false} placeholder="https://…" onChange={(e) => set({ link: { ...(config.link ?? {}), url: e.target.value } })} />
      </label>
      {problems.length > 0 && (
        <ul className="zwf-problems" aria-label="Not Ready Yet">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
