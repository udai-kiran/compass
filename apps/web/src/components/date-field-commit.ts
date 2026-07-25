import { ddmmyyyyToISO, isoToDDMMYYYY } from "@compass/shared";

/**
 * Pure decision logic behind `DateField`'s text input.
 *
 * Kept out of the component (and free of React) so the "what happens to the
 * value the user typed" contract is unit-testable — this repo runs `node --test`
 * with no DOM harness, so component-level assertions aren't available.
 */

/** Which input event is being resolved. */
export type DateInputEvent = "change" | "blur";

export interface DateInputResolution {
  /**
   * ISO `YYYY-MM-DD` to push to the parent, `""` to clear it, or `null` for
   * "don't touch the parent's value".
   */
  commit: string | null;
  /** Text the field should display after this event. */
  text: string;
  /** Whether the field currently holds something the parent can save. */
  valid: boolean;
  /** Human-readable reason, only set when `valid` is false. */
  message?: string;
  /**
   * Whether `onValidityChange` should fire for this event. False only while typing
   * in a field that hasn't opted in — those have never reported per keystroke, and
   * starting to would change the callback contract for existing call sites.
   */
  report: boolean;
}

export interface ResolveDateInputArgs {
  /** Raw text currently in the input. */
  text: string;
  /** Last ISO value the parent committed (`""` when empty). */
  committedValue: string;
  /** Inclusive ISO lower bound, if the field has one. */
  min?: string;
  /** Inclusive ISO upper bound, if the field has one. */
  max?: string;
  event: DateInputEvent;
  /**
   * Opt-in (`commitOnValidChange`) behaviour: commit valid dates as they are
   * typed and surface invalid input instead of discarding it on blur.
   */
  keepInvalid: boolean;
}

function isInRange(iso: string, min?: string, max?: string): boolean {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}

const FORMAT_MESSAGE = "Enter a valid date in DD-MM-YYYY format";

/** Explain why `text` was rejected: bad format, or a real date outside [min, max]. */
export function dateValidationMessage(parsed: string | null, min?: string, max?: string): string {
  if (!parsed) return FORMAT_MESSAGE;
  if (max && parsed > max) return `Date must be on or before ${isoToDDMMYYYY(max)}`;
  if (min && parsed < min) return `Date must be on or after ${isoToDDMMYYYY(min)}`;
  return FORMAT_MESSAGE;
}

/**
 * Decide what to display, what to commit, and whether the field is valid.
 *
 * The important case is invalid text on blur. Historically the field reverted to
 * the last committed value *and* reported itself valid, so a parent that saved on
 * click sent `null` and the typed date vanished with no feedback. Fields that opt
 * in via `keepInvalid` now retain the text and report the failure, so the parent
 * can block its Save button and explain the problem instead of losing data.
 */
export function resolveDateInput({
  text,
  committedValue,
  min,
  max,
  event,
  keepInvalid,
}: ResolveDateInputArgs): DateInputResolution {
  // Fields that haven't opted in only tell their parent on blur, so typing must
  // neither commit nor report anything — it just updates the text on screen.
  if (event === "change" && !keepInvalid) {
    return { commit: null, text, valid: true, report: false };
  }

  const trimmed = text.trim();

  // Empty means "clear it" — always a valid, committable state.
  if (trimmed === "") {
    return { commit: "", text: event === "blur" ? "" : text, valid: true, report: true };
  }

  const parsed = ddmmyyyyToISO(trimmed);
  if (parsed && isInRange(parsed, min, max)) {
    // Normalise the display only once the user has left the field, so
    // reformatting never fights with in-progress typing.
    return {
      commit: parsed,
      text: event === "blur" ? isoToDDMMYYYY(parsed) : text,
      valid: true,
      report: true,
    };
  }

  if (keepInvalid) {
    return {
      commit: null,
      text,
      valid: false,
      message: dateValidationMessage(parsed, min, max),
      report: true,
    };
  }

  // Legacy behaviour for fields that haven't opted in: on blur, drop the bad
  // text and fall back to the committed value; while typing, leave it alone.
  return {
    commit: null,
    text: event === "blur" ? (committedValue ? isoToDDMMYYYY(committedValue) : "") : text,
    valid: true,
    report: true,
  };
}
