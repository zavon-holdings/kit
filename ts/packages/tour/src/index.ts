// @zavon/tour: a spotlight tour for React.
//
// Tours are data (`Tour`, `TourStep`); a step points at an element by its
// `data-tour` value. `TourProvider` runs them for an app — the first-run
// start, "seen" through a `TourStore`, and `useTours()` for a Help menu —
// and `Spotlight` draws one. It names no service: a host keeps progress on
// its own server with `createServerTourStore` (1.1), handing in its own
// fetch and address, and lists "What's new" with `createAnnouncementsClient`
// and `useWhatsNew` — the drawing of both is the host's.
export { Spotlight, nextShowable, DEFAULT_LABELS, type SpotlightProps, type TourLabels, type CloseReason } from "./Spotlight.js";
export { TourProvider, useTours, type TourProviderProps, type TourContextValue } from "./TourProvider.js";
export * from "./tour.js";
export * from "./storage.js";
export * from "./serverStore.js";
export * from "./announcements.js";
export * from "./geometry.js";
