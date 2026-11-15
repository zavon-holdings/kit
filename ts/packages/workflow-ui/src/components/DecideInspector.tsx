"use client";

import { useContext, useState } from "react";
import type { InspectorProps } from "../types.js";
import { EditorContext } from "./context.js";
import { fieldSuggestions } from "../fields.js";

/**
 * The Decide node (core.ai.decide): the record's fields the step may read —
 * and nothing else is sent — and one to eight typed questions, each with the
 * confidence below which a person decides instead. Who that person is is the
 * step's review; a decision always names one, because the step never
 * guesses. Amounts, dates and counts belong in a condition, not a question.
 */

export type DecideQuestionType = "choice" | "score" | "noul";

export type DecideOption = { key: string; label: string; description?: string };

export type DecideQuestion = {
  key: string;
  type: DecideQuestionType;
  text: string;
  threshold?: number;
  options?: DecideOption[];
  levels?: string[];
  yes?: string;
  no?: string;
};

export type DecideField = { path: string; label?: string };

type PeopleSource = { people?: { email: string; name?: string }[] } & Record<string, unknown>;

export type DecideConfig = {
  fields?: DecideField[];
  questions?: DecideQuestion[];
  sensitive?: boolean;
  review?: { assignees?: PeopleSource[] } & Record<string, unknown>;
};

/** Decide's limits, core's (app/workflow/decide.go). */
export const DECIDE_LIMITS = Object.freeze({ questions: 8, fields: 40, minLevels: 2, maxLevels: 10, options: 255 });

/** The threshold a new question starts with: the value TypeSafe's guidance starts from, edited per question. */
export const NEW_THRESHOLD = 0.7;

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const RESERVED = new Set(["accepted", "review", "reviewed", "decision", "questions"]);

/** What is not yet right about a Decide node, in words; empty when it can be saved. */
export function decideProblems(c: DecideConfig): string[] {
  const out: string[] = [];
  const fields = c.fields ?? [];
  const qs = c.questions ?? [];
  if (fields.length < 1 || fields.length > DECIDE_LIMITS.fields) out.push(`Name 1 to ${DECIDE_LIMITS.fields} fields of the record to read.`);
  if (qs.length < 1 || qs.length > DECIDE_LIMITS.questions) out.push(`Ask 1 to ${DECIDE_LIMITS.questions} questions.`);
  const keys = new Set<string>();
  qs.forEach((q, i) => {
    const n = i + 1;
    if (!KEY.test(q.key)) out.push(`Question ${n}: its key is a lower-case word (letters, digits and _).`);
    else if (RESERVED.has(q.key)) out.push(`Question ${n}: "${q.key}" is the step's own word.`);
    else if (keys.has(q.key)) out.push(`Question ${n}: the key "${q.key}" is used twice.`);
    keys.add(q.key);
    if (!q.text.trim()) out.push(`Question ${n}: say what it asks.`);
    if (typeof q.threshold !== "number" || q.threshold < 0 || q.threshold > 1) out.push(`Question ${n}: its threshold is between 0 and 1.`);
    if (q.type === "choice" && ((q.options ?? []).length < 2 || (q.options ?? []).some((o) => !o.key.trim() || !o.label.trim())))
      out.push(`Question ${n}: a choice has at least 2 options, each with a key and a label.`);
    if (q.type === "score") {
      const levels = q.levels ?? [];
      if (levels.length < DECIDE_LIMITS.minLevels || levels.length > DECIDE_LIMITS.maxLevels || levels.some((l) => !l.trim()))
        out.push(`Question ${n}: a score describes ${DECIDE_LIMITS.minLevels} to ${DECIDE_LIMITS.maxLevels} levels, low to high.`);
    }
    if (q.type === "noul" && !!(q.yes ?? "").trim() !== !!(q.no ?? "").trim()) out.push(`Question ${n}: say what yes and no each mean, or neither.`);
  });
  const reviewers = (c.review?.assignees ?? []).length;
  if (reviewers === 0) out.push("Name who confirms an answer the AI is not sure of.");
  return out;
}

/** A fresh question of a type: its parts started, its threshold set. */
export function newQuestion(type: DecideQuestionType, taken: string[]): DecideQuestion {
  let key = "question";
  for (let i = 2; taken.includes(key); i++) key = `question_${i}`;
  const base = { key, type, text: "", threshold: NEW_THRESHOLD };
  if (type === "choice") return { ...base, options: [{ key: "", label: "" }, { key: "", label: "" }] };
  if (type === "score") return { ...base, levels: ["", "", ""] };
  return base;
}

function retype(q: DecideQuestion, type: DecideQuestionType): DecideQuestion {
  const { options: _o, levels: _l, yes: _y, no: _n, ...rest } = q;
  const fresh = newQuestion(type, []);
  return { ...rest, type, options: fresh.options, levels: fresh.levels };
}

export function DecideInspector({ node, onChange, readOnly }: InspectorProps) {
  // Inside the Builder it offers the graph's fields; on its own (a host's
  // form, a test) it offers none.
  const ed = useContext(EditorContext);
  const config = (node.config ?? {}) as DecideConfig;
  const set = (patch: Partial<DecideConfig>) => onChange(clean({ ...config, ...patch }));
  const fields = config.fields ?? [];
  const questions = config.questions ?? [];
  const setQuestion = (i: number, q: DecideQuestion) => set({ questions: questions.map((x, k) => (k === i ? q : x)) });
  const suggestions = ed ? fieldSuggestions(ed.graph, ed.sample) : [];
  const listID = `zwf-decide-paths-${node.id}`;

  const sources = config.review?.assignees ?? [];
  const others = sources.filter((s) => !(Array.isArray(s.people) && Object.keys(s).length === 1));
  const named = sources.filter((s) => Array.isArray(s.people) && Object.keys(s).length === 1).flatMap((s) => s.people ?? []);
  const [reviewText, setReviewText] = useState(named.map((p) => p.email).join("\n"));
  const writeReviewers = (value: string) => {
    setReviewText(value);
    const emails = value
      .split(/[\n,]/)
      .map((e) => e.trim())
      .filter(Boolean);
    const people = emails.map((email) => named.find((p) => p.email === email) ?? { email });
    set({ review: { ...(config.review ?? {}), assignees: people.length ? [...others, { people }] : others } });
  };
  const problems = decideProblems(config);

  return (
    <fieldset className="zwf-group" disabled={readOnly}>
      <legend>Decide With AI</legend>
      <p className="zwf-muted">
        AI reads only the fields named here and answers each question with a confidence. Below a question&apos;s threshold, or when AI is not available, a person decides
        instead: the step never guesses. Amounts, dates and counts belong in a condition, not a question.
      </p>

      <div className="zwf-group" role="group" aria-label="Fields to Read">
        <p className="zwf-subheading">Fields to Read</p>
        <datalist id={listID}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {fields.map((f, i) => (
          <div key={i} className="zwf-row">
            <label className="zwf-field">
              <span>Field {i + 1}</span>
              <input
                value={f.path}
                list={listID}
                spellCheck={false}
                placeholder="subject.vars.summary"
                onChange={(e) => set({ fields: fields.map((x, k) => (k === i ? { ...x, path: e.target.value } : x)) })}
              />
            </label>
            <label className="zwf-field">
              <span>Field {i + 1}: Label</span>
              <input value={f.label ?? ""} onChange={(e) => set({ fields: fields.map((x, k) => (k === i ? { ...x, label: e.target.value || undefined } : x)) })} />
            </label>
            <button type="button" className="zwf-button zwf-quiet" onClick={() => set({ fields: fields.filter((_, k) => k !== i) })}>
              Remove Field {i + 1}
            </button>
          </div>
        ))}
        {fields.length < DECIDE_LIMITS.fields && (
          <button type="button" className="zwf-button" onClick={() => set({ fields: [...fields, { path: "" }] })}>
            Add a Field
          </button>
        )}
      </div>

      {questions.map((q, i) => (
        <fieldset key={i} className="zwf-group">
          <legend>Question {i + 1}</legend>
          <div className="zwf-row">
            <label className="zwf-field">
              <span>Question {i + 1}: Key</span>
              <input value={q.key} spellCheck={false} onChange={(e) => setQuestion(i, { ...q, key: e.target.value })} />
            </label>
            <label className="zwf-field">
              <span>Question {i + 1}: Type</span>
              <select value={q.type} onChange={(e) => setQuestion(i, retype(q, e.target.value as DecideQuestionType))}>
                <option value="choice">Choice (one of a set)</option>
                <option value="score">Score (a level on a scale)</option>
                <option value="noul">Yes or No</option>
              </select>
            </label>
            <label className="zwf-field">
              <span>Question {i + 1}: Threshold</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={q.threshold ?? ""}
                onChange={(e) => setQuestion(i, { ...q, threshold: e.target.value === "" ? undefined : Number(e.target.value) })}
              />
            </label>
          </div>
          <label className="zwf-field">
            <span>Question {i + 1}: Words</span>
            <input value={q.text} placeholder="Which panel should review this application?" onChange={(e) => setQuestion(i, { ...q, text: e.target.value })} />
          </label>
          {q.type === "choice" && (
            <div className="zwf-group" role="group" aria-label={`Question ${i + 1}: Options`}>
              {(q.options ?? []).map((o, j) => (
                <div key={j} className="zwf-row">
                  <label className="zwf-field">
                    <span>Option {j + 1}: Key</span>
                    <input value={o.key} spellCheck={false} onChange={(e) => setQuestion(i, { ...q, options: (q.options ?? []).map((x, k) => (k === j ? { ...x, key: e.target.value } : x)) })} />
                  </label>
                  <label className="zwf-field">
                    <span>Option {j + 1}: Label</span>
                    <input value={o.label} onChange={(e) => setQuestion(i, { ...q, options: (q.options ?? []).map((x, k) => (k === j ? { ...x, label: e.target.value } : x)) })} />
                  </label>
                  <label className="zwf-field">
                    <span>Option {j + 1}: Description</span>
                    <input
                      value={o.description ?? ""}
                      onChange={(e) => setQuestion(i, { ...q, options: (q.options ?? []).map((x, k) => (k === j ? { ...x, description: e.target.value || undefined } : x)) })}
                    />
                  </label>
                  <button type="button" className="zwf-button zwf-quiet" onClick={() => setQuestion(i, { ...q, options: (q.options ?? []).filter((_, k) => k !== j) })}>
                    Remove Option {j + 1}
                  </button>
                </div>
              ))}
              {(q.options ?? []).length < DECIDE_LIMITS.options && (
                <button type="button" className="zwf-button" onClick={() => setQuestion(i, { ...q, options: [...(q.options ?? []), { key: "", label: "" }] })}>
                  Add an Option
                </button>
              )}
            </div>
          )}
          {q.type === "score" && (
            <>
              <label className="zwf-field">
                <span>Question {i + 1}: Levels (one per line, lowest first)</span>
                <textarea
                  rows={Math.max(3, (q.levels ?? []).length)}
                  value={(q.levels ?? []).join("\n")}
                  placeholder={"It can wait for the next round\nIt should be decided this month\nIt must be decided this week"}
                  onChange={(e) => setQuestion(i, { ...q, levels: e.target.value.split("\n") })}
                />
              </label>
              <p className="zwf-muted">Describe what each level looks like, not a number. The answer is the level, counted from 1.</p>
            </>
          )}
          {q.type === "noul" && (
            <div className="zwf-row">
              <label className="zwf-field">
                <span>Question {i + 1}: What Yes Means</span>
                <input value={q.yes ?? ""} onChange={(e) => setQuestion(i, { ...q, yes: e.target.value || undefined })} />
              </label>
              <label className="zwf-field">
                <span>Question {i + 1}: What No Means</span>
                <input value={q.no ?? ""} onChange={(e) => setQuestion(i, { ...q, no: e.target.value || undefined })} />
              </label>
            </div>
          )}
          <p className="zwf-muted">
            A condition reads it as steps.{node.id}.output.{q.key || "<key>"}.answer
            {q.type === "noul" ? " (yes or no)" : q.type === "score" ? " (a level from 1)" : " (an option's key)"}.
          </p>
          <button type="button" className="zwf-button zwf-quiet" onClick={() => set({ questions: questions.filter((_, k) => k !== i) })}>
            Remove Question {i + 1}
          </button>
        </fieldset>
      ))}
      {questions.length < DECIDE_LIMITS.questions && (
        <button
          type="button"
          className="zwf-button"
          onClick={() =>
            set({
              questions: [
                ...questions,
                newQuestion(
                  "noul",
                  questions.map((q) => q.key),
                ),
              ],
            })
          }
        >
          Add a Question
        </button>
      )}

      <label className="zwf-field">
        <span>Confirmed By (one email address per line)</span>
        <textarea rows={2} value={reviewText} spellCheck={false} onChange={(e) => writeReviewers(e.target.value)} />
      </label>
      {others.length > 0 && (
        <p className="zwf-muted">
          And {others.length} other source{others.length === 1 ? "" : "s"} of people (a role, a permission or an app&apos;s list), kept as set.
        </p>
      )}

      <label className="zwf-check">
        <input type="checkbox" checked={!!config.sensitive} onChange={(e) => set({ sensitive: e.target.checked || undefined })} />
        <span>Send Sensitive Answers</span>
      </label>
      <p className="zwf-muted">
        Off, a form&apos;s sensitive answers are sent as &quot;(withheld)&quot;. On, they are sent, and only a credential that may read them itself can save this workflow.
      </p>

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

/** Drops what the step does not store: an empty optional part. */
function clean(c: DecideConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { ...c };
  if (!c.sensitive) delete out.sensitive;
  return out;
}
