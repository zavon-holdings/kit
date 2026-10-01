"use client";

import { createElement, forwardRef, type HTMLAttributes, type ReactNode } from "react";

/**
 * A heading at a level relative to where the host put the editor. The host
 * says which level the editor's own headings start at (`headingLevel`, 2 by
 * default, under the page's h1); a sub-heading is one deeper. Hard-coding
 * h3 in a component every app mounts somewhere different skips levels on
 * one page or another, and screen readers navigate by them.
 */
export const Heading = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement> & { level: number; children: ReactNode }>(function Heading(
  { level, children, ...rest },
  ref,
) {
  const n = Math.min(6, Math.max(1, Math.round(level)));
  return createElement(`h${n}`, { ...rest, ref }, children);
});
