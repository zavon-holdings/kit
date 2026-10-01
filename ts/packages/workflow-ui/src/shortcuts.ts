/**
 * The editor's keyboard shortcuts: one table, read by the key handler and
 * by the sheet that lists them, so the sheet can never describe a key that
 * does something else.
 */

export type ShortcutAction =
  | "undo"
  | "redo"
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "remove"
  | "select-all"
  | "clear-selection"
  | "find"
  | "shortcuts"
  | "nudge-left"
  | "nudge-right"
  | "nudge-up"
  | "nudge-down";

export type Shortcut = {
  action: ShortcutAction;
  /** How the keys are written on the sheet; "Mod" is Ctrl, or ⌘ on a Mac. */
  keys: string[];
  does: string;
  group: "Editing" | "Selecting" | "Moving" | "Help";
};

export const SHORTCUTS: readonly Shortcut[] = Object.freeze([
  { action: "undo", keys: ["Mod+Z"], does: "Undo the last change", group: "Editing" },
  { action: "redo", keys: ["Mod+Shift+Z", "Mod+Y"], does: "Redo what was undone", group: "Editing" },
  { action: "copy", keys: ["Mod+C"], does: "Copy the selected nodes", group: "Editing" },
  { action: "cut", keys: ["Mod+X"], does: "Cut the selected nodes", group: "Editing" },
  { action: "paste", keys: ["Mod+V"], does: "Paste nodes copied here or in another workflow", group: "Editing" },
  { action: "duplicate", keys: ["Mod+D"], does: "Duplicate the selected nodes", group: "Editing" },
  { action: "remove", keys: ["Delete", "Backspace"], does: "Remove the selected nodes (never the start)", group: "Editing" },
  { action: "select-all", keys: ["Mod+A"], does: "Select every node", group: "Selecting" },
  { action: "clear-selection", keys: ["Escape"], does: "Select nothing", group: "Selecting" },
  { action: "find", keys: ["Mod+F", "/"], does: "Find a node", group: "Selecting" },
  { action: "nudge-left", keys: ["Shift+ArrowLeft"], does: "Move the selected nodes left", group: "Moving" },
  { action: "nudge-right", keys: ["Shift+ArrowRight"], does: "Move the selected nodes right", group: "Moving" },
  { action: "nudge-up", keys: ["Shift+ArrowUp"], does: "Move the selected nodes up", group: "Moving" },
  { action: "nudge-down", keys: ["Shift+ArrowDown"], does: "Move the selected nodes down", group: "Moving" },
  { action: "shortcuts", keys: ["?"], does: "Show these shortcuts", group: "Help" },
]);

/** Keys that also work on the canvas and the list, and so are not repeated above. */
export const NAVIGATION_KEYS: readonly { keys: string[]; does: string }[] = Object.freeze([
  { keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"], does: "Move between nodes, along their edges" },
  { keys: ["Enter", "Space"], does: "Open the focused node's settings" },
  { keys: ["Shift+Click", "Mod+Click"], does: "Add a node to the selection" },
  { keys: ["Shift+Drag"], does: "Select the nodes inside a box" },
]);

type KeyLike = { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };

/** The action a key press asks for, or null. `mac` decides whether Mod is ⌘. */
export function shortcutFor(e: KeyLike, mac = false): ShortcutAction | null {
  const mod = mac ? !!e.metaKey : !!e.ctrlKey;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.altKey) return null;
  if (mod) {
    if (k === "z") return e.shiftKey ? "redo" : "undo";
    if (k === "y" && !e.shiftKey) return "redo";
    if (e.shiftKey) return null;
    switch (k) {
      case "c":
        return "copy";
      case "x":
        return "cut";
      case "v":
        return "paste";
      case "d":
        return "duplicate";
      case "a":
        return "select-all";
      case "f":
        return "find";
    }
    return null;
  }
  if (e.ctrlKey || e.metaKey) return null;
  if (e.shiftKey) {
    switch (k) {
      case "ArrowLeft":
        return "nudge-left";
      case "ArrowRight":
        return "nudge-right";
      case "ArrowUp":
        return "nudge-up";
      case "ArrowDown":
        return "nudge-down";
      case "?":
        return "shortcuts";
    }
    return null;
  }
  switch (k) {
    case "Delete":
    case "Backspace":
      return "remove";
    case "Escape":
      return "clear-selection";
    case "/":
      return "find";
    case "?":
      return "shortcuts";
  }
  return null;
}

/** "Mod+Shift+Z" as the person's keyboard writes it. */
export function keyWords(keys: string, mac = false): string {
  return keys
    .split("+")
    .map((k) => (k === "Mod" ? (mac ? "⌘" : "Ctrl") : k === "ArrowLeft" ? "←" : k === "ArrowRight" ? "→" : k === "ArrowUp" ? "↑" : k === "ArrowDown" ? "↓" : k))
    .join(mac ? "" : "+");
}

/** Whether a key press came from somewhere that types: those keys are the field's, not the editor's. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
}
