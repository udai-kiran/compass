/**
 * State machine for the Settings → Profile date-of-birth field.
 *
 * Kept out of the component (and free of React) because the bug this fixes was one
 * of ordering, not rendering: clicking Save blurs the input first, and a background
 * refetch of ["user-profile"] can land at any moment. Every transition is a pure
 * function here so `profile-dob-state.test.ts` can pin the sequences directly
 * instead of mirroring component internals.
 */

export interface DobState {
  /**
   * The stored value as last seen from the server ("" = no DOB stored), or `null`
   * before the profile GET resolves. Doubles as the hydration flag: the field must
   * not be saved while this is `null`, or the empty initial value would overwrite
   * the stored date of birth.
   */
  server: string | null;
  /** The committed ISO value of the field ("" = empty). What Save would persist. */
  value: string;
  /** False while the typed text can't be parsed — blocks Save. */
  valid: boolean;
  /** Validation message shown under the field while `valid` is false. */
  error?: string;
  /**
   * True once the text has been typed into an unparsable state. Such text is never
   * committed, so `value` alone cannot reveal it, yet a refetch must not silently
   * replace text the user is still fixing.
   */
  textInvalid: boolean;
}

export const UNHYDRATED_DOB: DobState = {
  server: null,
  value: "",
  valid: true,
  textInvalid: false,
};

/** Is the field showing something other than the stored value? */
export function hasUnsavedDobEdit(state: DobState): boolean {
  if (state.server === null) return false;
  return state.textInvalid || state.value !== state.server;
}

/**
 * Fold a fresh server value (initial load or background refetch) into the state.
 *
 * An unsaved edit always wins: adopting the server value there would both discard
 * the user's input and leave the displayed date inconsistent with the validity
 * state, leaving Save disabled with no way to recover. An edit equal to the
 * incoming value is not unsaved (the usual case right after a successful save), so
 * the baseline advances and later refetches keep syncing.
 */
export function syncDobFromServer(state: DobState, server: string): DobState {
  if (hasUnsavedDobEdit(state)) {
    // Advance the baseline only. Nothing else may be touched: DateField's text is
    // reset from its `value` prop, so clearing `textInvalid` here while leaving
    // `value` alone would mark unparsable text on screen as valid and let Save
    // persist a different date than the one displayed.
    return { ...state, server };
  }
  return { server, value: server, valid: true, error: undefined, textInvalid: false };
}

/** DateField committed a value (typing a valid date, a calendar pick, or clearing). */
export function commitDob(state: DobState, value: string): DobState {
  return { ...state, value };
}

/**
 * The PUT succeeded and returned the stored profile.
 *
 * `sent` is what this save submitted. If the field still shows it, adopt the
 * response — that makes the server authoritative even when the two differ (another
 * device wrote in between), rather than leaving the field silently out of sync.
 * If the user has typed something else while the request was in flight, keep their
 * edit and only advance the baseline; discarding it would lose data, and locking the
 * field for the whole request instead would wedge it if the request never settles.
 */
export function acceptSavedDob(state: DobState, sent: string, server: string): DobState {
  if (state.value !== sent || state.textInvalid) {
    return { ...state, server };
  }
  return { server, value: server, valid: true, error: undefined, textInvalid: false };
}

/** DateField reported on the typed text. */
export function reportDobValidity(
  state: DobState,
  report: { valid: boolean; message?: string },
): DobState {
  return {
    ...state,
    valid: report.valid,
    error: report.message,
    textInvalid: !report.valid,
  };
}

/** Save is refused until the stored value is known, the text parses, and no save is in flight. */
export function canSaveDob(state: DobState, pending: boolean): boolean {
  return state.server !== null && state.valid && !pending;
}

/** The request body for PUT /api/profile — an empty field means "no date of birth". */
export function dobSavePayload(state: DobState): { dateOfBirth: string | null } {
  return { dateOfBirth: state.value || null };
}

/**
 * What one click of the Profile section's Save must actually send.
 *
 * The section spans two endpoints — `PATCH /api/auth/profile` (display name) and
 * `PUT /api/profile` (date of birth). They were previously two buttons whose
 * success toasts were both "Profile updated", so pressing the one beside the name
 * reported success while the typed date of birth was never sent anywhere. Deciding
 * both requests here keeps that honest: a field is written only when it changed, and
 * "nothing changed" is distinguishable from "saved".
 */
export interface ProfileSaveIntent {
  /** Send `PATCH /api/auth/profile`. */
  saveName: boolean;
  /** Send `PUT /api/profile`. */
  saveDob: boolean;
  /** Neither field changed — tell the user rather than firing a no-op request. */
  noop: boolean;
}

export function resolveProfileSave(state: DobState, nameDirty: boolean): ProfileSaveIntent {
  // `server` is `null` only before the GET resolves, and Save is already refused
  // then; treat it as "no stored value" so the comparison stays total.
  const stored = state.server || null;
  const saveDob = state.server !== null && dobSavePayload(state).dateOfBirth !== stored;
  return { saveName: nameDirty, saveDob, noop: !nameDirty && !saveDob };
}

/**
 * State of the display-name input.
 *
 * `typed` is `null` while untouched, so the field shows the stored name; an empty
 * string is a real edit and must stay visibly empty rather than snapping back to the
 * stored value mid-keystroke. The API rejects an empty name, so that is surfaced as
 * invalid instead of being silently dropped.
 */
export interface NameFieldState {
  /** What the input should display. */
  value: string;
  /** Trimmed value to submit. */
  trimmed: string;
  /** Edited to empty — blocks Save with a message. */
  empty: boolean;
  /** Differs from the stored name, so it needs writing. */
  dirty: boolean;
}

export function resolveNameField(typed: string | null, stored: string): NameFieldState {
  const value = typed ?? stored;
  const trimmed = value.trim();
  const empty = typed !== null && trimmed === "";
  // An untouched field is never dirty. Comparing the trimmed edit against the raw
  // stored name would otherwise mark a stored name that has stray whitespace as
  // changed without the user touching it, and silently rewrite it on the next save.
  const dirty = typed !== null && !empty && trimmed !== stored.trim();
  return { value, trimmed, empty, dirty };
}
