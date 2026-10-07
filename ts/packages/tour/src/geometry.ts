// Where the hole and the tooltip go. Pure, so it is tested without a layout.
import type { Placement } from "./tour.js";

export type Box = { top: number; left: number; width: number; height: number };
export type Size = { width: number; height: number };

/** The cut-out: the target's box grown by `pad`, kept inside the viewport. */
export function holeFor(target: Box, viewport: Size, pad = 8): Box {
  const top = Math.max(0, target.top - pad);
  const left = Math.max(0, target.left - pad);
  const bottom = Math.min(viewport.height, target.top + target.height + pad);
  const right = Math.min(viewport.width, target.left + target.width + pad);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export type Spot = { top: number; left: number; placement: Exclude<Placement, "auto"> };

const ORDER: Exclude<Placement, "auto">[] = ["bottom", "right", "top", "left"];

/**
 * The tooltip's top-left beside `hole`: the preferred side when it fits, else
 * the first side that does (bottom, right, top, left), else below and clamped
 * into the viewport. Always inside the viewport by `gap` where it can be.
 */
export function placeTooltip(hole: Box, tip: Size, viewport: Size, preferred: Placement = "auto", gap = 12): Spot {
  const fits = (p: Exclude<Placement, "auto">) => {
    switch (p) {
      case "bottom":
        return hole.top + hole.height + gap + tip.height <= viewport.height - gap;
      case "top":
        return hole.top - gap - tip.height >= gap;
      case "right":
        return hole.left + hole.width + gap + tip.width <= viewport.width - gap;
      case "left":
        return hole.left - gap - tip.width >= gap;
    }
  };
  const tries = preferred === "auto" ? ORDER : [preferred, ...ORDER.filter((p) => p !== preferred)];
  const placement = tries.find(fits) ?? "bottom";
  let top: number;
  let left: number;
  switch (placement) {
    case "bottom":
      top = hole.top + hole.height + gap;
      left = hole.left + hole.width / 2 - tip.width / 2;
      break;
    case "top":
      top = hole.top - gap - tip.height;
      left = hole.left + hole.width / 2 - tip.width / 2;
      break;
    case "right":
      top = hole.top + hole.height / 2 - tip.height / 2;
      left = hole.left + hole.width + gap;
      break;
    case "left":
      top = hole.top + hole.height / 2 - tip.height / 2;
      left = hole.left - gap - tip.width;
      break;
  }
  const clamp = (v: number, size: number, max: number) => Math.min(Math.max(v, gap), Math.max(gap, max - size - gap));
  return { top: clamp(top, tip.height, viewport.height), left: clamp(left, tip.width, viewport.width), placement };
}
