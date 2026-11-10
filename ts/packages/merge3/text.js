// Text merging: a field named in merge3's `text` option whose ancestor and
// both edits are strings is merged token by token. Twin of
// kit/go/merge3/text.go (its comment has the rules); both replay
// contract/merge3/text-*.json and contract/merge3/text/tokens.json.

/** Past this (the product of two token counts, a common start and end set aside) the middle is one chunk. */
export const MAX_TEXT_CELLS = 1 << 20;

/** Pairs of indexes along a longest common subsequence; ties skip from the first sequence. */
export function lcs(n, m, eq) {
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

const WORD = /^[\p{L}\p{N}\p{M}]$/u;
const SPACE = /^[ \t\f\v\p{Zs}\p{Zl}\p{Zp}]$/u;
const tokenClass = (ch) => (WORD.test(ch) ? 1 : SPACE.test(ch) ? 2 : 0);

/** A string split as the text merge splits it. */
export function tokens(s) {
  const out = [];
  let cur = "";
  let cls = -1;
  for (const ch of s) {
    const c = tokenClass(ch);
    if (cur && c !== 0 && c === cls) {
      cur += ch;
      continue;
    }
    if (cur) out.push(cur);
    cur = ch;
    cls = c;
  }
  if (cur) out.push(cur);
  return out;
}

function matchTo(x, y) {
  const out = new Array(x.length).fill(-1);
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) {
    out[p] = p;
    p++;
  }
  let s = 0;
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) {
    out[x.length - 1 - s] = y.length - 1 - s;
    s++;
  }
  const xm = x.slice(p, x.length - s);
  const ym = y.slice(p, y.length - s);
  if (!xm.length || !ym.length || xm.length * ym.length > MAX_TEXT_CELLS) return out;
  for (const [i, j] of lcs(xm.length, ym.length, (i, j) => xm[i] === ym[j])) out[p + i] = p + j;
  return out;
}

function sides(c) {
  switch (c.op) {
    case "same":
      return [c.text, c.text, c.text];
    case "a":
      return [c.base, c.a, c.base];
    case "b":
      return [c.base, c.base, c.b];
    case "both":
      return [c.base, c.text, c.text];
  }
  return [c.base, c.a, c.b];
}

const changedBy = (c, side) => c.op === "conflict" || c.op === "both" || c.op === side;

function classify(o, a, b) {
  if (a === o && b === o) return { op: "same", text: o };
  if (a === o) return { op: "b", base: o, b };
  if (b === o) return { op: "a", base: o, a };
  if (a === b) return { op: "both", base: o, text: a };
  return { op: "conflict", base: o, a, b };
}

const onlySpaces = (s) => [...s].every((ch) => tokenClass(ch) === 2);

function absorbSpaces(chunks) {
  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const prev = out[out.length - 1];
    const next = chunks[i + 1];
    if (
      c.op === "same" &&
      prev &&
      next &&
      prev.op !== "same" &&
      next.op !== "same" &&
      onlySpaces(c.text) &&
      ((changedBy(prev, "a") && changedBy(next, "a")) || (changedBy(prev, "b") && changedBy(next, "b")))
    ) {
      const [po, pa, pb] = sides(prev);
      const [no, na, nb] = sides(next);
      out[out.length - 1] = classify(po + c.text + no, pa + c.text + na, pb + c.text + nb);
      i++;
      continue;
    }
    out.push(c);
  }
  return out;
}

/**
 * Merge two edits of a string, token by token: { chunks, conflict }. A
 * chunk is {op:"same",text}, {op:"a",base,a}, {op:"b",base,b},
 * {op:"both",base,text} or {op:"conflict",base,a,b}.
 */
export function mergeText(base, a, b) {
  const o = tokens(base);
  const ta = tokens(a);
  const tb = tokens(b);
  const ma = matchTo(o, ta);
  const mb = matchTo(o, tb);
  const chunks = [];
  const add = (c) => {
    const last = chunks[chunks.length - 1];
    if (c.op === "same" && last?.op === "same") last.text += c.text;
    else chunks.push(c);
  };
  const join = (t) => t.join("");
  let i = 0;
  let ja = 0;
  let jb = 0;
  for (;;) {
    const start = i;
    while (i < o.length && ma[i] === ja && mb[i] === jb) {
      i++;
      ja++;
      jb++;
    }
    if (i > start) add({ op: "same", text: join(o.slice(start, i)) });
    if (i === o.length && ja === ta.length && jb === tb.length) break;
    let k = i;
    while (k < o.length && (ma[k] < 0 || mb[k] < 0)) k++;
    let ea = ta.length;
    let eb = tb.length;
    if (k < o.length) {
      ea = ma[k];
      eb = mb[k];
    }
    add(classify(join(o.slice(i, k)), join(ta.slice(ja, ea)), join(tb.slice(jb, eb))));
    i = k;
    ja = ea;
    jb = eb;
  }
  const merged = absorbSpaces(chunks);
  return { chunks: merged, conflict: merged.some((c) => c.op === "conflict") };
}

/** The merge written out, each clash chosen with pick: "a", "b" or "both" (A's then B's). */
export function joinText(chunks, pick = "a") {
  let out = "";
  for (const c of chunks) {
    if (c.op === "same" || c.op === "both") out += c.text;
    else if (c.op === "a") out += c.a;
    else if (c.op === "b") out += c.b;
    else out += pick === "b" ? c.b : pick === "both" ? c.a + c.b : c.a;
  }
  return out;
}
