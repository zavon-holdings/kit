// Property tests over random documents from a seeded generator (the same
// shape as the Go twin's): one side unchanged takes the other; the same
// edit on both sides is that edit; conflicts are the same either way
// round; disjoint edits merge cleanly and losslessly; nothing kept by a
// side is lost; every combination of decisions gives a valid tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { merge3, canonical, validate } from "./index.js";

function prng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { int: (n) => Math.floor(next() * n), pick: (a) => a[Math.floor(next() * a.length)] };
}

const KINDS = ["text", "heading", "image", "quote"];
const WORDS = ["alpha", "beta", "gamma", "delta", "", "long text with spaces"];
const clone = (v) => JSON.parse(JSON.stringify(v));

function generator(seed) {
  const r = prng(seed);
  let next = 0;
  const key = () => `u${++next}`;
  const leaf = (keyed) => {
    const u = { kind: r.pick(KINDS), fields: {} };
    if (keyed) u.key = key();
    if (r.int(4) > 0) u.fields.text = r.pick(WORDS);
    if (r.int(3) === 0) u.fields.level = r.int(4);
    return u;
  };
  const block = (depth) => {
    if (depth < 2 && r.int(4) === 0) {
      const u = { key: key(), kind: "group", fields: { title: r.pick(WORDS) }, slots: { items: [] } };
      for (let i = r.int(4); i > 0; i--) u.slots.items.push(block(depth + 1));
      return u;
    }
    return leaf(r.int(5) > 0);
  };
  const tree = () => {
    const root = { key: "doc", kind: "document", fields: { title: "Draft" }, slots: { body: [] } };
    for (let i = 1 + r.int(7); i > 0; i--) root.slots.body.push(block(0));
    return root;
  };
  return { r, key, leaf, tree };
}

function refs(root) {
  const out = [{ u: root, parent: null }];
  const walk = (p) => {
    for (const s of Object.keys(p.slots ?? {}).sort())
      p.slots[s].forEach((c, i) => {
        out.push({ u: c, parent: p, slot: s, index: i });
        walk(c);
      });
  };
  walk(root);
  return out;
}

const within = (anc, u) => anc === u || Object.values(anc.slots ?? {}).some((l) => l.some((c) => within(c, u)));

function edit(g, t, tag, n) {
  t = clone(t);
  const { r } = g;
  for (; n > 0; n--) {
    const rs = refs(t);
    const p = r.pick(rs);
    switch (r.int(8)) {
      case 0:
      case 1:
        p.u.fields ??= {};
        p.u.fields[r.pick(["text", "level", "note"])] = tag + r.int(3);
        break;
      case 2: {
        const k = Object.keys(p.u.fields ?? {})[0];
        if (k !== undefined) delete p.u.fields[k];
        break;
      }
      case 3:
        if (p.parent) p.parent.slots[p.slot].splice(p.index, 1);
        break;
      case 4:
        if (p.u.slots) {
          const l = p.u.slots[Object.keys(p.u.slots).sort()[0]];
          const nu = g.leaf(r.int(4) > 0);
          if (nu.key) nu.key = tag + nu.key;
          l.splice(r.int(l.length + 1), 0, nu);
        }
        break;
      case 5:
        if (p.parent && p.u.key) {
          const targets = rs.filter((x) => x.u.slots && !within(p.u, x.u));
          const dest = r.pick(targets).u;
          p.parent.slots[p.slot].splice(p.index, 1);
          const l = dest.slots[Object.keys(dest.slots).sort()[0]];
          l.splice(r.int(l.length + 1), 0, p.u);
        }
        break;
      case 6:
        if (p.u.slots) {
          const l = p.u.slots[Object.keys(p.u.slots).sort()[0]];
          for (let i = l.length - 1; i > 0; i--) {
            const j = r.int(i + 1);
            [l[i], l[j]] = [l[j], l[i]];
          }
        }
        break;
      case 7:
        if (p.parent && p.u.kind !== "group" && r.int(3) === 0) p.u.kind = r.pick(KINDS);
        break;
    }
  }
  return t;
}

const c = (u) => canonical(u);
const conflictSet = (cs) => cs.map((x) => `${x.id}/${x.kind}`).sort().join(",");
const keysOf = (u) => new Set(refs(u).map((x) => x.u.key).filter(Boolean));

// The same choices the Go twin's property test makes.
function choices(cf) {
  const out = [{ choice: "a" }, { choice: "b" }];
  switch (cf.kind) {
    case "field":
      if (cf.path !== "@kind" && cf.key !== "~") out.push({ choice: "both" }, { choice: "manual", value: "manual" });
      break;
    case "delete":
      out.push({ choice: "both" }, { choice: "manual", value: false });
      break;
    case "move":
      out.push({ choice: "both" });
      if (cf.a) out.push({ choice: "manual", value: cf.a });
      break;
    case "order":
      out.push({ choice: "manual", value: [...cf.a].reverse() });
      break;
  }
  return out;
}

const SEEDS = 600;

test("one side unchanged takes the other; the same edit on both is that edit", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const g = generator(seed);
    const o = g.tree();
    const a = edit(g, o, "a", 1 + g.r.int(5));
    const b = edit(g, o, "b", 1 + g.r.int(5));
    for (const [x, y, want, name] of [
      [a, o, a, "merge(o,a,o)"],
      [o, b, b, "merge(o,o,b)"],
      [a, a, a, "merge(o,a,a)"],
    ]) {
      const r = merge3(o, x, y);
      assert.equal(c(r.tree), c(merge3(want, want, want).tree), `${name} seed ${seed}`);
      assert.equal(r.conflicts.length, 0, `${name} seed ${seed}`);
    }
  }
});

test("conflicts are the same either way round, nothing kept is lost, keys stay unique", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const g = generator(seed);
    const o = g.tree();
    const a = edit(g, o, "a", 1 + g.r.int(5));
    const b = edit(g, o, "b", 1 + g.r.int(5));
    const ab = merge3(o, a, b);
    const ba = merge3(o, b, a);
    assert.equal(conflictSet(ab.conflicts), conflictSet(ba.conflicts), `seed ${seed}`);
    validate(ab.tree);
    const [ko, ka, kb, km] = [keysOf(o), keysOf(a), keysOf(b), keysOf(ab.tree)];
    for (const k of ka) if ((kb.has(k) || !ko.has(k)) && !km.has(k)) assert.fail(`lost ${k} from a, seed ${seed}`);
    for (const k of kb) if ((ka.has(k) || !ko.has(k)) && !km.has(k)) assert.fail(`lost ${k} from b, seed ${seed}`);
    for (const k of km) if (!ka.has(k) && !kb.has(k)) assert.fail(`invented ${k}, seed ${seed}`);
    // A unit one side deleted and the other changed is kept.
    const deleteKeys = ab.conflicts.filter((x) => x.kind === "delete").map((x) => x.key);
    for (const k of deleteKeys) if (!k.startsWith("~")) assert.ok(km.has(k), `delete conflict ${k} kept, seed ${seed}`);
  }
});

test("every combination of decisions gives a valid tree", () => {
  let resolved = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const g = generator(seed);
    const o = g.tree();
    const a = edit(g, o, "a", 1 + g.r.int(6));
    const b = edit(g, o, "b", 1 + g.r.int(6));
    const r = merge3(o, a, b);
    if (!r.conflicts.length) continue;
    const opts = r.conflicts.map(choices);
    let total = 1;
    for (const x of opts) total = Math.min(total * x.length, 65);
    const tries = Math.min(total, 64);
    for (let n = 0; n < tries; n++) {
      const decisions = {};
      let x = n;
      r.conflicts.forEach((cf, i) => {
        const pick = total > 64 ? g.r.int(opts[i].length) : x % opts[i].length;
        x = Math.floor(x / opts[i].length);
        decisions[cf.id] = opts[i][pick];
      });
      const out = r.resolve(decisions, { duplicateAsUnits: true });
      validate(out.tree);
      const ks = keysOf(out.tree);
      for (const [old, nk] of Object.entries(out.ids)) assert.ok(ks.has(old) || ks.has(nk), `ids ${old}→${nk}, seed ${seed}`);
      resolved++;
    }
  }
  assert.ok(resolved > 500, `only ${resolved} resolutions exercised`);
});

test("disjoint edits merge with no conflicts and lose nothing", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const g = generator(seed);
    const o = g.tree();
    const a = clone(o);
    const b = clone(o);
    const edits = [];
    const deleted = [];
    refs(a).forEach((x, i) => {
      if (!x.u.key || !x.parent) return;
      if (i % 2 === 0 && g.r.int(2) === 0) {
        (x.u.fields ??= {}).note = "a" + x.u.key;
        edits.push([x.u.key, "a" + x.u.key]);
      } else if (i % 2 === 0 && !x.u.slots && g.r.int(4) === 0) deleted.push(x.u.key);
    });
    refs(b).forEach((x, i) => {
      if (!x.u.key || !x.parent || i % 2 === 0 || g.r.int(2) === 0) return;
      (x.u.fields ??= {}).note = "b" + x.u.key;
      edits.push([x.u.key, "b" + x.u.key]);
    });
    for (const k of deleted) {
      const x = refs(a).find((y) => y.u.key === k);
      x.parent.slots[x.slot].splice(x.index, 1);
    }
    const added = [];
    for (const [t, tag] of [
      [a, "a"],
      [b, "b"],
    ]) {
      for (let n = g.r.int(3); n > 0; n--) {
        const host = g.r.pick(refs(t).filter((x) => x.u.slots)).u;
        const l = host.slots[Object.keys(host.slots).sort()[0]];
        const nu = { key: tag + g.key(), kind: "text", fields: { text: tag } };
        l.splice(g.r.int(l.length + 1), 0, nu);
        added.push(nu.key);
      }
    }
    if (g.r.int(2) === 0) a.slots.body.reverse();
    const r = merge3(o, a, b);
    assert.equal(r.conflicts.length, 0, `seed ${seed}: ${conflictSet(r.conflicts)}`);
    const byKey = new Map(refs(r.tree).map((x) => [x.u.key, x.u]));
    for (const [k, v] of edits) assert.equal(byKey.get(k)?.fields?.note, v, `edit of ${k}, seed ${seed}`);
    for (const k of added) assert.ok(byKey.has(k), `addition ${k}, seed ${seed}`);
    for (const k of deleted) assert.ok(!byKey.has(k), `deletion ${k}, seed ${seed}`);
  }
});
