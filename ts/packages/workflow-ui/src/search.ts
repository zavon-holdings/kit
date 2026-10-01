/**
 * Finding a node by what somebody remembers about it: its name, its id, its
 * type, or something in its settings (a template, an action, an address).
 * Best matches first: a name that starts with the words, then a name or id
 * that contains them, then the type, then the settings.
 */
import { typeLabel } from "./catalogue.js";
import type { Graph } from "./types.js";

export type Found = { id: string; name: string; type: string; where: "name" | "id" | "type" | "settings" };

export function searchNodes(g: Graph, query: string, limit = 20): Found[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { found: Found; score: number; at: number }[] = [];
  g.nodes.forEach((n, at) => {
    const name = (n.name ?? (n.type === "start" ? "Start" : n.id)).trim();
    const lname = name.toLowerCase();
    const type = typeLabel(n.type).toLowerCase();
    let score = 0;
    let where: Found["where"] = "name";
    if (lname.startsWith(q)) score = 5;
    else if (lname.includes(q)) score = 4;
    else if (n.id.includes(q)) {
      score = 3;
      where = "id";
    } else if (type.includes(q) || n.type.includes(q)) {
      score = 2;
      where = "type";
    } else if (n.config && JSON.stringify(n.config).toLowerCase().includes(q)) {
      score = 1;
      where = "settings";
    }
    if (score) scored.push({ found: { id: n.id, name, type: n.type, where }, score, at });
  });
  scored.sort((a, b) => b.score - a.score || a.at - b.at);
  return scored.slice(0, limit).map((s) => s.found);
}
