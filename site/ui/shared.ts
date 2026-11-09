// Small helpers the page modules share: the current language, messages kept in the markup, and frame waits.
// VERIFIED: script-written results follow a language switch (site e2e: "-mal kleiner" becomes "times smaller").
import { fill, type Locale } from "../lib/format.js";

let current: Locale = "en";
const listeners = new Set<(locale: Locale) => void>();

export const locale = (): Locale => current;
/** Called by main.ts after defuss-i18n switched the markup, so script-written text follows. */
export function localeChanged(next: Locale): void {
  current = next;
  for (const listener of listeners) listener(next);
}
export function onLocale(listener: (locale: Locale) => void): void {
  listeners.add(listener);
}

/**
 * A message from the hidden `[data-msg]` targets: the markup is the catalog (defuss-i18n), so the text is read
 * when it is needed and is always in the current language.
 */
export function msg(key: string, values: Record<string, string | number> = {}): string {
  const element = document.querySelector(`[data-msg="${key}"]`);
  return fill(element?.textContent?.trim() ?? key, values);
}

export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`missing element ${selector}`);
  return element;
};

/** Resolves after the browser painted: a status line shows before work that blocks the thread. */
export const painted = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Counts a number up to its value in the element (unless motion is reduced); `format` renders each frame. */
export function countUp(element: HTMLElement, to: number, format: (n: number) => string, ms = 500): void {
  if (reducedMotion()) {
    element.textContent = format(to);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    // a frame's timestamp can precede the start taken with performance.now(): clamp to 0..1
    const t = Math.min(1, Math.max(0, (now - start) / ms));
    element.textContent = format(to * (1 - (1 - t) ** 3));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Reads a stored value; storage can be missing or blocked (private windows, previews). */
export function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // a per-visitor convenience only
  }
}

/** Sets which button of a single-select toggle group is pressed (its script clears it on a second click). */
export function press(group: Element, value: string): void {
  for (const button of group.querySelectorAll<HTMLButtonElement>(".toggle")) {
    button.setAttribute("aria-pressed", String(button.value === value));
  }
}
