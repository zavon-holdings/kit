// @zavon/tour: a spotlight tour for React.
//
// Tours are data (`Tour`, `TourStep`); a step points at an element by its
// `data-tour` value. `TourProvider` runs them for an app — the first-run
// start, "seen" through a `TourStore`, and `useTours()` for a Help menu —
// and `Spotlight` draws one. The package holds no fetch code and names no
// service: a host keeps "seen" on its own server by passing a store.
export { Spotlight, nextShowable, DEFAULT_LABELS, type SpotlightProps, type TourLabels, type CloseReason } from "./Spotlight.js";
export { TourProvider, useTours, type TourProviderProps, type TourContextValue } from "./TourProvider.js";
export * from "./tour.js";
export * from "./storage.js";
export * from "./geometry.js";
