// @zavon/merge3 — a three-way merge of ordered trees. Twin of kit/go/merge3;
// both replay the vectors in contract/merge3. See index.d.ts and the
// package comment in go/merge3/merge3.go for the rules.

export const ROOT = "~";
export const KIND_FIELD = "field";
export const KIND_DELETE = "delete";
export const KIND_MOVE = "move";
export const KIND_ORDER = "order";

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const sortedKeys = (o) => (o ? Object.keys(o).sort(cmp) : []);
function cmp(x, y) {
  // Code point order, which is the byte order of UTF-8 and so Go's.
  if (x === y) return 0;
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (x.charCodeAt(i) !== y.charCodeAt(i)) return x.codePointAt(i) - y.codePointAt(i);
  }
  return x.length - y.length;
}
const encoder = new TextEncoder();
const utf8 = (s) => encoder.encode(s);

// ---- canonical JSON -------------------------------------------------------

/** Canonical JSON: object keys sorted, no spaces; the same text Go writes. */
export function canonical(v) {
  const out = [];
  write(out, v);
  return out.join("");
}

function write(out, v) {
  if (v === null || v === undefined) return void out.push("null");
  switch (typeof v) {
    case "boolean":
      return void out.push(v ? "true" : "false");
    case "number":
      return void out.push(Number.isFinite(v) ? JSON.stringify(v) : "null");
    case "string":
      return void out.push(quote(v));
    case "object":
      if (Array.isArray(v)) {
        out.push("[");
        v.forEach((e, i) => {
          if (i) out.push(",");
          write(out, e);
        });
        return void out.push("]");
      }
      out.push("{");
      sortedKeys(v)
        .filter((k) => v[k] !== undefined)
        .forEach((k, i) => {
          if (i) out.push(",");
          out.push(quote(k), ":");
          write(out, v[k]);
        });
      return void out.push("}");
    default:
      return void out.push("null");
  }
}

const ESC = { '"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t" };
function quote(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ESC[ch]) out += ESC[ch];
    else if (c < 0x20) out += "\\u00" + c.toString(16).padStart(2, "0");
    else out += ch;
  }
  return out + '"';
}

// ---- SHA-256 (so the package needs no platform crypto) ---------------------

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

/** Hex SHA-256 of a string's UTF-8 bytes. */
export function sha256(s) {
  const msg = utf8(s);
  const len = msg.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(total - 4, bits >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}

// ---- units ------------------------------------------------------------------

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** The unit as written: an empty key, fields or slots map left out. */
export function unitValue(u) {
  const m = { kind: u.kind ?? "" };
  if (u.key) m.key = u.key;
  if (u.fields && Object.keys(u.fields).length) m.fields = clone(u.fields);
  if (u.slots && Object.keys(u.slots).length) {
    m.slots = {};
    for (const s of Object.keys(u.slots)) m.slots[s] = u.slots[s].map(unitValue);
  }
  return m;
}

/** Validate a tree: keys unique and not reserved, slots hold units. Throws. */
export function validate(root) {
  const seen = new Set();
  const walk = (u, path) => {
    if (u === null || typeof u !== "object" || Array.isArray(u)) throw new Error(`merge3: ${path}: not a unit`);
    if (typeof u.kind !== "string") throw new Error(`merge3: ${path}: kind is not a string`);
    if (u.key !== undefined && u.key !== "") {
      if (typeof u.key !== "string") throw new Error(`merge3: ${path}: key is not a string`);
      if (u.key.startsWith("~")) throw new Error(`merge3: ${path}: key "${u.key}" begins with the reserved "~"`);
      if (seen.has(u.key)) throw new Error(`merge3: ${path}: key "${u.key}" appears twice`);
      seen.add(u.key);
    }
    if (u.fields !== undefined && (u.fields === null || typeof u.fields !== "object" || Array.isArray(u.fields)))
      throw new Error(`merge3: ${path}: fields is not an object`);
    if (u.slots !== undefined) {
      if (u.slots === null || typeof u.slots !== "object" || Array.isArray(u.slots))
        throw new Error(`merge3: ${path}: slots is not an object`);
      for (const s of sortedKeys(u.slots)) {
        if (!Array.isArray(u.slots[s])) throw new Error(`merge3: ${path}.${s}: a slot is a list`);
        u.slots[s].forEach((k, i) => walk(k, `${path}.${s}[${i}]`));
      }
    }
  };
  walk(root, "root");
}

/** True when validate would not throw. */
export function isValid(root) {
  try {
    validate(root);
    return true;
  } catch {
    return false;
  }
}

const unitHash = (u) => sha256(canonical(unitValue(u))).slice(0, 16);

function index(u, base) {
  const s = { nodes: new Map(), rootKey: u.key ?? "", sigs: new Map() };
  add(s, u, ROOT, null, base);
  return s;
}

function add(s, u, key, place, base) {
  const n = {
    key,
    kind: u.kind ?? "",
    fields: clone(u.fields ?? {}),
    slots: {},
    place,
    synthetic: key.startsWith("~"),
    hash: "",
  };
  if (n.synthetic && key !== ROOT) n.hash = unitHash(u);
  s.nodes.set(key, n);
  for (const name of sortedKeys(u.slots)) {
    const kids = u.slots[name];
    const keys = assign(key, name, kids, base);
    n.slots[name] = keys;
    kids.forEach((kid, i) => add(s, kid, keys[i], { parent: key, slot: name }, base));
  }
}

function assign(parent, slot, kids, base) {
  const keys = new Array(kids.length).fill("");
  const loose = [];
  const hashes = [];
  kids.forEach((k, i) => {
    if (k.key) keys[i] = k.key;
    else {
      loose.push(i);
      hashes[i] = unitHash(k);
    }
  });
  const prefix = `~${parent}/${slot}/`;
  if (!base) {
    for (const i of loose) keys[i] = prefix + i;
    return keys;
  }
  const bn = base.nodes.get(parent);
  const cands = bn ? (bn.slots[slot] ?? []).filter((c) => base.nodes.get(c).synthetic) : [];
  const claimed = new Set();
  const rest = [];
  for (const i of loose) {
    const found = cands.find((c) => !claimed.has(c) && base.nodes.get(c).hash === hashes[i]);
    if (found !== undefined) {
      claimed.add(found);
      keys[i] = found;
    } else rest.push(i);
  }
  const q = cands.filter((c) => !claimed.has(c));
  for (const [x, y] of lcs(rest.length, q.length, (x, y) => (kids[rest[x]].kind ?? "") === base.nodes.get(q[y]).kind))
    keys[rest[x]] = q[y];
  const count = new Map();
  for (const i of rest) {
    if (keys[i] === "") {
      const n = count.get(hashes[i]) ?? 0;
      count.set(hashes[i], n + 1);
      keys[i] = `${prefix}+${hashes[i]}#${n}`;
    }
  }
  return keys;
}

function lcs(n, m, eq) {
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = eq(i, j) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(i, j) && dp[i][j] === dp[i + 1][j + 1] + 1) {
      out.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

function sig(s, k) {
  const memo = s.sigs.get(k);
  if (memo !== undefined) return memo;
  const n = s.nodes.get(k);
  let text = canonical({ k: n.kind, f: n.fields, s: n.slots });
  for (const name of sortedKeys(n.slots)) for (const c of n.slots[name]) text += sig(s, c);
  const v = sha256(text);
  s.sigs.set(k, v);
  return v;
}

const samePlace = (x, y) => x.parent === y.parent && x.slot === y.slot;
const placeValue = (p) => ({ parent: p.parent, slot: p.slot });

function isAncestor(s, anc, k) {
  let p = s.nodes.get(k).place?.parent;
  while (p !== undefined) {
    if (p === anc) return true;
    if (p === ROOT) return false;
    p = s.nodes.get(p).place?.parent;
  }
  return false;
}

const list = (s, parent, slot) => s.nodes.get(parent)?.slots[slot] ?? [];

// ---- the merge --------------------------------------------------------------

const absent = { ok: false };
const val = (v) => ({ ok: true, v });
const same = (x, y) => x.ok === y.ok && (!x.ok || canonical(x.v) === canonical(y.v));

function three(o, a, b) {
  if (same(a, o)) return [b, false];
  if (same(b, o)) return [a, false];
  if (same(a, b)) return [a, false];
  return [a, true];
}

function fieldVal(n, path) {
  if (!n) return absent;
  if (path === "@kind") return val(n.kind);
  return own(n.fields, path) ? val(n.fields[path]) : absent;
}

const placeVal = (n) => (n ? val(placeValue(n.place)) : absent);

function toPlace(v) {
  if (v && typeof v === "object" && typeof v.parent === "string" && typeof v.slot === "string")
    return { parent: v.parent, slot: v.slot };
  return null;
}

class Merger {
  constructor(base, a, b, dec, opts) {
    this.o = index(base, null);
    this.a = index(a, this.o);
    this.b = index(b, this.o);
    this.dec = dec ?? {};
    this.opts = opts ?? {};
    this.conflicts = new Map();
    this.keep = new Map();
    this.units = new Map();
    this.dups = [];
    this.err = null;
  }

  fail(msg) {
    if (!this.err) this.err = new Error("merge3: " + msg);
  }

  conflict(c) {
    if (!this.conflicts.has(c.id)) this.conflicts.set(c.id, c);
  }

  decision(id) {
    return own(this.dec, id) ? this.dec[id] : undefined;
  }

  touched(s, k) {
    return sig(s, k) !== sig(this.o, k) || !samePlace(s.nodes.get(k).place, this.o.nodes.get(k).place);
  }

  survives(k) {
    const memo = this.keep.get(k);
    if (memo !== undefined) return memo;
    const v = this.decide(k);
    this.keep.set(k, v);
    return v;
  }

  decide(k) {
    if (k === ROOT) return true;
    const inO = this.o.nodes.has(k);
    const inA = this.a.nodes.has(k);
    const inB = this.b.nodes.has(k);
    if (!inA && !inB) return false;
    if (inA && inB) return true;
    if (!inO) return true;
    const [have, lack, deleter] = inA ? [this.a, this.b, "b"] : [this.b, this.a, "a"];
    let r = k;
    for (;;) {
      const p = this.o.nodes.get(r).place.parent;
      if (lack.nodes.has(p)) break;
      r = p;
    }
    if (r !== k && isAncestor(have, r, k)) return this.survives(r);
    if (!this.touched(have, k)) return false;
    const id = `${KIND_DELETE}:${k}`;
    this.conflict({ id, kind: KIND_DELETE, key: k, side: deleter });
    const d = this.decision(id);
    if (!d) return true;
    if (d.choice === deleter) return false;
    if (d.choice === "manual") {
      if (typeof d.value !== "boolean") {
        this.fail(`${id}: manual needs true (keep) or false (delete)`);
        return true;
      }
      return d.value;
    }
    return true;
  }

  mergeValue(k, path, on, an, bn) {
    const o = fieldVal(on, path);
    const a = fieldVal(an, path);
    const b = fieldVal(bn, path);
    const [v, clash] = three(o, a, b);
    if (!clash) return v;
    const id = `${KIND_FIELD}:${k}:${path}`;
    this.conflict(withSides({ id, kind: KIND_FIELD, key: k, path }, o, a, b));
    const d = this.decision(id);
    if (!d) return a;
    switch (d.choice) {
      case "b":
        return b;
      case "manual":
        if (path === "@kind") {
          if (typeof d.value === "string") return val(d.value);
          this.fail(`${id}: a kind is a string`);
          return a;
        }
        return val(clone(d.value));
      case "both":
        this.dups.push({ id, kind: KIND_FIELD, key: k, path, value: b.v, has: b.ok });
    }
    return a;
  }

  moveConflict(k) {
    const id = `${KIND_MOVE}:${k}`;
    const o = placeVal(this.o.nodes.get(k));
    const a = placeVal(this.a.nodes.get(k));
    const b = placeVal(this.b.nodes.get(k));
    this.conflict(withSides({ id, kind: KIND_MOVE, key: k, path: "@parent" }, o, a, b));
    return id;
  }

  decidedPlace(id, k) {
    const d = this.decision(id);
    if (!d) return null;
    switch (d.choice) {
      case "a":
      case "both":
        return this.a.nodes.get(k)?.place ?? null;
      case "b":
        return this.b.nodes.get(k)?.place ?? null;
      case "manual": {
        const p = toPlace(d.value);
        if (!p) this.fail(`${id}: manual needs {parent, slot}`);
        return p;
      }
    }
    return null;
  }

  run() {
    const keys = new Set();
    for (const s of [this.o, this.a, this.b]) for (const k of s.nodes.keys()) keys.add(k);
    const all = [...keys].sort(cmp);
    const alive = all.filter((k) => this.survives(k));
    if (this.err) throw this.err;
    const decided = new Set();
    for (const k of alive) {
      const on = this.o.nodes.get(k);
      const an = this.a.nodes.get(k);
      const bn = this.b.nodes.get(k);
      const u = { kind: "", fields: {}, place: null, names: new Set() };
      this.units.set(k, u);
      if (an && bn) {
        const paths = new Set();
        for (const n of [on, an, bn]) if (n) for (const p of Object.keys(n.fields)) paths.add(p);
        for (const p of [...paths].sort(cmp)) {
          const v = this.mergeValue(k, p, on, an, bn);
          if (v.ok) u.fields[p] = clone(v.v);
        }
        const kv = this.mergeValue(k, "@kind", on, an, bn);
        u.kind = typeof kv.v === "string" ? kv.v : "";
        const names = new Set();
        for (const n of [on, an, bn]) if (n) for (const s of Object.keys(n.slots)) names.add(s);
        for (const s of names) {
          const has = (n) => !!n && own(n.slots, s);
          const pa = has(an);
          const pb = has(bn);
          const po = has(on);
          if (pa === po ? pb : pa) u.names.add(s);
        }
        if (k !== ROOT) {
          const [v, clash] = three(placeVal(on), placeVal(an), placeVal(bn));
          u.place = toPlace(v.v);
          if (clash) {
            const id = this.moveConflict(k);
            const p = this.decidedPlace(id, k);
            if (p) {
              u.place = p;
              decided.add(k);
              if (this.decision(id).choice === "both")
                this.dups.push({ id, kind: KIND_MOVE, key: k, place: bn.place });
            }
          }
        }
      } else {
        const n = an ?? bn;
        u.kind = n.kind;
        u.fields = clone(n.fields);
        for (const s of Object.keys(n.slots)) u.names.add(s);
        u.place = n.place;
      }
    }
    if (this.err) throw this.err;
    const live = new Set(alive);
    this.settlePlaces(alive, live, decided);
    if (this.err) throw this.err;
    const group = new Map();
    for (const k of alive) {
      if (!live.has(k) || k === ROOT) continue;
      const p = this.units.get(k).place;
      if (!group.has(p.parent)) group.set(p.parent, {});
      const g = group.get(p.parent);
      (g[p.slot] ??= []).push(k);
    }
    const order = new Map();
    for (const k of alive) {
      if (!live.has(k)) continue;
      const u = this.units.get(k);
      const g = group.get(k) ?? {};
      for (const s of Object.keys(g)) u.names.add(s);
      const o = {};
      for (const s of [...u.names].sort(cmp)) o[s] = this.orderSlot(k, s, g[s] ?? []);
      order.set(k, o);
    }
    if (this.err) throw this.err;
    const ids = this.duplicate(order, live);
    const rootKey = this.a.rootKey === this.o.rootKey ? this.b.rootKey : this.a.rootKey;
    const build = (k) => {
      const u = this.units.get(k);
      const out = { kind: u.kind };
      if (k === ROOT) {
        if (rootKey) out.key = rootKey;
      } else if (!k.startsWith("~")) out.key = k;
      if (Object.keys(u.fields).length) out.fields = u.fields;
      const o = order.get(k);
      if (Object.keys(o).length) {
        out.slots = {};
        for (const s of Object.keys(o)) out.slots[s] = o[s].map(build);
      }
      return out;
    };
    const tree = build(ROOT);
    const conflicts = [...this.conflicts.keys()].sort(cmp).map((id) => this.conflicts.get(id));
    return { tree, conflicts, ids };
  }

  settlePlaces(alive, live, decided) {
    const tried = new Set(decided);
    for (let iter = 0; iter <= 4 * alive.length + 4; iter++) {
      let changed = false;
      for (const k of alive) {
        if (!live.has(k) || k === ROOT) continue;
        const u = this.units.get(k);
        if (live.has(u.place.parent)) continue;
        let moved = false;
        for (const s of [this.a, this.b, this.o]) {
          const n = s.nodes.get(k);
          if (n && live.has(n.place.parent)) {
            u.place = n.place;
            moved = true;
            break;
          }
        }
        if (!moved) live.delete(k);
        changed = true;
      }
      for (const k of alive) {
        if (!live.has(k) || k === ROOT) continue;
        const cycle = this.cycleFrom(k, live);
        if (!cycle) continue;
        // First a decision (or A, the tentative side) for a move not yet
        // settled; then A's place; then the ancestor's, whose edges cannot
        // make a cycle.
        let fixed = false;
        for (let pass = 0; pass < 3 && !fixed; pass++) {
          for (const c of cycle) {
            const on = this.o.nodes.get(c);
            const an = this.a.nodes.get(c);
            const bn = this.b.nodes.get(c);
            if (!on || !((an && !samePlace(an.place, on.place)) || (bn && !samePlace(bn.place, on.place)))) continue;
            const id = this.moveConflict(c);
            const u = this.units.get(c);
            let target = u.place;
            if (pass === 0) {
              if (tried.has(c)) continue;
              tried.add(c);
              const p = this.decidedPlace(id, c);
              if (p) target = p;
              else if (an) target = an.place;
            } else if (pass === 1) target = an ? an.place : on.place;
            else target = on.place;
            if (!samePlace(target, u.place)) {
              u.place = target;
              fixed = true;
            }
          }
        }
        if (!fixed) throw new Error(`merge3: the moves around "${k}" cannot be settled`);
        changed = true;
        break;
      }
      if (!changed) return;
    }
    throw new Error("merge3: places did not settle");
  }

  cycleFrom(k, live) {
    const pos = new Map();
    const path = [];
    for (let cur = k; cur !== ROOT; cur = this.units.get(cur).place.parent) {
      if (pos.has(cur)) return path.slice(pos.get(cur)).sort(cmp);
      pos.set(cur, path.length);
      path.push(cur);
      if (!live.has(cur)) return null;
    }
    return null;
  }

  orderSlot(parent, slot, set) {
    const inSet = new Set(set);
    const lo = list(this.o, parent, slot);
    const la = list(this.a, parent, slot);
    const lb = list(this.b, parent, slot);
    const mo = new Set(lo);
    const ma = new Set(la);
    const mb = new Set(lb);
    const common = new Set(set.filter((k) => mo.has(k) && ma.has(k) && mb.has(k)));
    const project = (l) => l.filter((k) => common.has(k));
    const po = project(lo);
    const pa = project(la);
    const pb = project(lb);
    const eq = (x, y) => x.length === y.length && x.every((k, i) => k === y[i]);
    let seq;
    if (eq(pa, po)) seq = pb;
    else if (eq(pb, po)) seq = pa;
    else if (eq(pa, pb)) seq = pa;
    else {
      seq = pa;
      const id = `${KIND_ORDER}:${parent}:${slot}`;
      this.conflict({ id, kind: KIND_ORDER, key: parent, path: slot, base: po, a: pa, b: pb });
      const d = this.decision(id);
      if (d?.choice === "b") seq = pb;
      else if (d?.choice === "manual") {
        const arr = d.value;
        const seen = new Set();
        const valid =
          Array.isArray(arr) &&
          arr.length === pa.length &&
          arr.every((s) => {
            const ok = typeof s === "string" && common.has(s) && !seen.has(s);
            seen.add(s);
            return ok;
          });
        if (!valid) this.fail(`${id}: manual needs the keys ${JSON.stringify(pa)} in some order`);
        else seq = [...arr];
      }
    }
    const out = seq.map((key) => ({ key, src: "c" }));
    const placed = new Set(seq);
    const insert = (l, src, skip) => {
      l.forEach((k, i) => {
        if (!inSet.has(k) || placed.has(k)) return;
        let pos = 0;
        for (let j = i - 1; j >= 0; j--) {
          if (placed.has(l[j])) {
            pos = out.findIndex((x) => x.key === l[j]) + 1;
            break;
          }
        }
        while (pos < out.length && skip.includes(out[pos].src)) pos++;
        out.splice(pos, 0, { key: k, src });
        placed.add(k);
      });
    };
    insert(la, "a", "");
    insert(lb, "b", "a");
    insert(lo, "o", "ab");
    const rest = set.filter((k) => !placed.has(k)).sort(cmp);
    return [...out.map((x) => x.key), ...rest];
  }

  duplicate(order, live) {
    const ids = {};
    if (!this.dups.length) return ids;
    this.dups.sort((x, y) => cmp(x.id, y.id));
    const taken = (k) => this.units.has(k);
    const mint =
      this.opts.mintKey ??
      ((old, taken) => {
        let k = old + "~b";
        for (let n = 2; taken(k); n++) k = old + "~b" + n;
        return k;
      });
    const copy = (k, place) => {
      const nk = mint(k, taken);
      if (!nk || taken(nk) || nk === ROOT) throw new Error(`merge3: the key minted for a copy of "${k}" is empty or taken`);
      if (!k.startsWith("~")) ids[k] = nk;
      const src = this.units.get(k);
      this.units.set(nk, { kind: src.kind, fields: clone(src.fields), place, names: new Set(src.names) });
      live.add(nk);
      const o = {};
      order.set(nk, o);
      for (const s of sortedKeys(order.get(k))) o[s] = order.get(k)[s].map((c) => copy(c, { parent: nk, slot: s }));
      return nk;
    };
    for (const d of this.dups) {
      if (!live.has(d.key)) continue;
      const u = this.units.get(d.key);
      if (d.kind === KIND_FIELD) {
        const nk = copy(d.key, u.place);
        const c = this.units.get(nk);
        if (d.path === "@kind") c.kind = typeof d.value === "string" ? d.value : "";
        else if (d.has) c.fields[d.path] = clone(d.value);
        else delete c.fields[d.path];
        const l = order.get(u.place.parent)[u.place.slot];
        l.splice(l.indexOf(d.key) + 1, 0, nk);
      } else {
        if (!live.has(d.place.parent) || samePlace(d.place, u.place)) continue;
        const nk = copy(d.key, d.place);
        const po = order.get(d.place.parent);
        const l = (po[d.place.slot] ??= []);
        const bl = list(this.b, d.place.parent, d.place.slot);
        let pos = 0;
        const i = bl.indexOf(d.key);
        for (let j = i - 1; i >= 0 && j >= 0; j--) {
          const x = l.indexOf(bl[j]);
          if (x >= 0) {
            pos = x + 1;
            break;
          }
        }
        l.splice(pos, 0, nk);
        this.units.get(d.place.parent).names.add(d.place.slot);
      }
    }
    return ids;
  }
}

function withSides(c, o, a, b) {
  if (o.ok) c.base = o.v;
  if (a.ok) c.a = a.v;
  if (b.ok) c.b = b.v;
  return c;
}

/**
 * Merge a and b, two edits of base. Returns the merged tree (each conflict
 * tentatively settled), the conflicts sorted by id, and resolve().
 */
export function merge3(base, a, b) {
  for (const t of [base, a, b]) validate(t);
  const snap = [clone(base), clone(a), clone(b)];
  const out = new Merger(...snap, null, null).run();
  const result = { tree: out.tree, conflicts: out.conflicts };
  Object.defineProperty(result, "resolve", {
    enumerable: false,
    value: (decisions, options) => resolve(result, decisions, options),
  });
  Object.defineProperty(result, "inputs", { enumerable: false, value: snap });
  return result;
}

/** Settle the conflicts named in decisions and rebuild the tree. Throws on a refused decision. */
export function resolve(result, decisions = {}, options = {}) {
  const byId = new Map(result.conflicts.map((c) => [c.id, c]));
  for (const id of Object.keys(decisions)) {
    const c = byId.get(id);
    const d = decisions[id];
    if (!c) throw new Error(`merge3: no conflict "${id}"`);
    switch (d?.choice) {
      case "a":
      case "b":
        break;
      case "manual":
        if (!own(d, "value")) throw new Error(`merge3: ${id}: manual needs a value`);
        break;
      case "both":
        if (c.kind === KIND_ORDER) throw new Error(`merge3: ${id}: an order has no "both"`);
        if (c.kind === KIND_FIELD) {
          if (!options.duplicateAsUnits)
            throw new Error(`merge3: ${id}: a field has no "both"; duplicate the unit or decide by hand`);
          if (c.key === ROOT) throw new Error(`merge3: ${id}: the root cannot be duplicated`);
        }
        break;
      default:
        throw new Error(`merge3: ${id}: unknown choice "${d?.choice}"`);
    }
  }
  const out = new Merger(...result.inputs, decisions, options).run();
  return { tree: out.tree, ids: out.ids, conflicts: out.conflicts.filter((c) => !own(decisions, c.id)) };
}
