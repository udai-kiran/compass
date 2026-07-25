import { test } from "node:test";
import assert from "node:assert/strict";
import { isoToDDMMYYYY } from "@compass/shared";
import { resolveDateInput } from "../../components/date-field-commit.ts";
import {
  acceptSavedDob,
  canSaveDob,
  commitDob,
  dobSavePayload,
  hasUnsavedDobEdit,
  reportDobValidity,
  resolveNameField,
  resolveProfileSave,
  syncDobFromServer,
  UNHYDRATED_DOB,
  type DobState,
} from "./profile-dob-state.ts";

const TODAY = "2026-07-25";

// --- unit tests for the transitions ------------------------------------------------

test("an unhydrated field cannot be saved", () => {
  assert.equal(canSaveDob(UNHYDRATED_DOB, false), false);
  // Even after an edit: without the GET we don't know what we'd be overwriting.
  assert.equal(canSaveDob(commitDob(UNHYDRATED_DOB, "1990-05-15"), false), false);
  assert.equal(canSaveDob(commitDob(UNHYDRATED_DOB, ""), false), false);
  assert.equal(hasUnsavedDobEdit(commitDob(UNHYDRATED_DOB, "1990-05-15")), false);
});

test("a pre-hydration edit is discarded when the stored value arrives", () => {
  // The field is disabled until hydrated, so this can only happen via a stray
  // programmatic commit — it must never win over the stored date.
  const early = commitDob(UNHYDRATED_DOB, "1990-05-15");
  const hydrated = syncDobFromServer(early, "1980-01-01");
  assert.equal(hydrated.value, "1980-01-01", "the stored value must win");
  assert.equal(canSaveDob(hydrated, false), true);
  assert.deepEqual(dobSavePayload(hydrated), { dateOfBirth: "1980-01-01" });
});

test("an invalid pre-hydration state does not block the stored value either", () => {
  const early = reportDobValidity(UNHYDRATED_DOB, { valid: false, message: "nope" });
  const hydrated = syncDobFromServer(early, "1980-01-01");
  assert.equal(hydrated.value, "1980-01-01");
  assert.equal(hydrated.valid, true);
  assert.equal(hydrated.error, undefined);
  assert.equal(hydrated.textInvalid, false);
});

test("hydrating with no stored date leaves an empty, saveable field", () => {
  const s = syncDobFromServer(UNHYDRATED_DOB, "");
  assert.equal(s.value, "");
  assert.equal(canSaveDob(s, false), true);
  assert.deepEqual(dobSavePayload(s), { dateOfBirth: null });
  assert.equal(hasUnsavedDobEdit(s), false);
});

test("a save in flight blocks further submits", () => {
  const s = syncDobFromServer(UNHYDRATED_DOB, "1990-05-15");
  assert.equal(canSaveDob(s, true), false);
  assert.equal(canSaveDob(s, false), true);
});

test("re-entering the stored value is not an unsaved edit", () => {
  // Tabbing through the field re-commits the same date on blur; that must not
  // freeze background syncing.
  const s = commitDob(syncDobFromServer(UNHYDRATED_DOB, "1990-05-15"), "1990-05-15");
  assert.equal(hasUnsavedDobEdit(s), false);
  const refetched = syncDobFromServer(s, "1970-12-31");
  assert.equal(refetched.value, "1970-12-31", "an untouched field keeps syncing");
});

test("a repeated identical server value is a no-op", () => {
  const s = syncDobFromServer(UNHYDRATED_DOB, "1990-05-15");
  assert.deepEqual(syncDobFromServer(s, "1990-05-15"), s);
});

test("a refetch keeps the baseline current while preserving an unsaved edit", () => {
  const hydrated = syncDobFromServer(UNHYDRATED_DOB, "1990-05-15");
  const edited = commitDob(hydrated, "1985-01-01");
  const refetched = syncDobFromServer(edited, "1970-12-31");
  assert.equal(refetched.value, "1985-01-01", "the edit survives");
  assert.equal(refetched.server, "1970-12-31", "but the baseline advances");
  // Reverting to what the server now holds clears the edit rather than stranding it.
  assert.equal(hasUnsavedDobEdit(commitDob(refetched, "1970-12-31")), false);
});

test("a refetch matching an unsaved edit adopts it as the new baseline", () => {
  const edited = commitDob(syncDobFromServer(UNHYDRATED_DOB, ""), "1990-05-15");
  const refetched = syncDobFromServer(edited, "1990-05-15");
  assert.equal(hasUnsavedDobEdit(refetched), false);
  assert.equal(refetched.value, "1990-05-15");
});

test("accepting a saved profile clears the edit it saved", () => {
  // The field still shows what was sent, so the response is authoritative.
  const sentState = commitDob(syncDobFromServer(UNHYDRATED_DOB, ""), "1990-05-15");
  const saved = acceptSavedDob(sentState, "1990-05-15", "1990-05-15");
  assert.deepEqual(saved, {
    server: "1990-05-15",
    value: "1990-05-15",
    valid: true,
    error: undefined,
    textInvalid: false,
  });
  assert.equal(hasUnsavedDobEdit(saved), false, "so later refetches keep syncing");
  assert.equal(canSaveDob(saved, false), true);
});

test("accepting a saved profile adopts a response that differs from what was sent", () => {
  const sentState = commitDob(syncDobFromServer(UNHYDRATED_DOB, ""), "1990-05-15");
  const saved = acceptSavedDob(sentState, "1990-05-15", "1970-12-31");
  assert.equal(saved.value, "1970-12-31", "the server is authoritative");
  assert.equal(hasUnsavedDobEdit(saved), false);
});

test("accepting a saved profile keeps an edit made while the request was in flight", () => {
  const hydrated = syncDobFromServer(UNHYDRATED_DOB, "");
  // Sent 1990-05-15, then the user typed something else before the response landed.
  const newer = commitDob(hydrated, "1985-01-01");
  const saved = acceptSavedDob(newer, "1990-05-15", "1990-05-15");
  assert.equal(saved.value, "1985-01-01", "the newer edit must not be discarded");
  assert.equal(saved.server, "1990-05-15", "but the baseline advances");
  assert.equal(canSaveDob(saved, false), true, "and it can still be saved");

  // Same for text that was typed into an invalid state meanwhile.
  const stillTyping = reportDobValidity(commitDob(hydrated, "1990-05-15"), {
    valid: false,
    message: "Enter a valid date in DD-MM-YYYY format",
  });
  const keptInvalid = acceptSavedDob(stillTyping, "1990-05-15", "1990-05-15");
  assert.equal(keptInvalid.textInvalid, true, "invalid text is not silently blessed");
  assert.equal(keptInvalid.valid, false);
  assert.equal(canSaveDob(keptInvalid, false), false);
});

test("clearing the field and saving it is accepted, not mistaken for an edit", () => {
  const hydrated = syncDobFromServer(UNHYDRATED_DOB, "1990-05-15");
  const cleared = commitDob(hydrated, "");
  assert.deepEqual(dobSavePayload(cleared), { dateOfBirth: null });
  const saved = acceptSavedDob(cleared, "", "");
  assert.equal(saved.value, "");
  assert.equal(saved.server, "");
  assert.equal(hasUnsavedDobEdit(saved), false);
});

test("syncing never clears an invalid-text flag while the text is still on screen", () => {
  // The field's text is only reset from its `value` prop, so a sync that leaves
  // `value` untouched must leave the validity state untouched too — otherwise
  // unparsable text on screen would be reported as valid.
  const invalid = reportDobValidity(syncDobFromServer(UNHYDRATED_DOB, "1990-05-15"), {
    valid: false,
    message: "Enter a valid date in DD-MM-YYYY format",
  });
  for (const server of ["1990-05-15", "1970-12-31", ""]) {
    const synced = syncDobFromServer(invalid, server);
    assert.equal(synced.value, "1990-05-15", `value must not move (server=${server})`);
    assert.equal(synced.textInvalid, true, `still invalid (server=${server})`);
    assert.equal(synced.valid, false);
    assert.equal(canSaveDob(synced, false), false, `Save must stay blocked (server=${server})`);
  }
});

/**
 * Drives the real production units: DateField's `resolveDateInput` (through the same
 * call order as `applyTextEvent`) and ProfilePanel's `DobState` transitions. There is
 * no DOM/React test environment in this repo (node --test only), so the JSX wiring
 * itself — which prop is passed where — is not covered; everything below the props
 * is the real code, not a mirror.
 */
function profileDobField(storedDob: string | null) {
  const max = TODAY;
  let state: DobState = UNHYDRATED_DOB;
  let pending = false;
  let localText = ""; // DateField's text state
  let syncedValue = ""; // what DateField's useEffect([value]) last saw
  // A GET can be in flight while the user saves. useUserProfileMutation cancels it
  // in onSuccess, so a request started before the write must not land after it.
  let inFlightGetCancelled = false;
  const saves: Array<{ dateOfBirth: string | null }> = [];

  /** DateField's `useEffect([value])`, which runs after the render that changed it. */
  const flushValueEffect = () => {
    if (state.value === syncedValue) return;
    syncedValue = state.value;
    localText = state.value ? isoToDDMMYYYY(state.value) : "";
  };

  /** ProfilePanel's render-time sync of `serverDob` into `dobState`. */
  const receiveServerDob = (server: string | null) => {
    if (server === null || server === state.server) return;
    state = syncDobFromServer(state, server);
    flushValueEffect();
  };

  /**
   * `disabled={!dobHydrated}` — a disabled input fires no change/blur events and its
   * calendar button can't be clicked. The field stays editable while saving.
   */
  const fieldDisabled = () => state.server === null;

  /** DateField.applyTextEvent — same order: setLocalText, onChange, onValidityChange. */
  const applyTextEvent = (text: string, event: "change" | "blur") => {
    if (fieldDisabled()) return;
    const result = resolveDateInput({
      text,
      committedValue: state.value,
      max,
      event,
      keepInvalid: true,
    });
    localText = result.text;
    if (result.commit !== null) state = commitDob(state, result.commit);
    state = reportDobValidity(
      state,
      result.valid ? { valid: true } : { valid: false, message: result.message },
    );
    flushValueEffect();
  };

  const isInRange = (iso: string) => !(max && iso > max);

  return {
    /** The profile GET resolves. */
    hydrate: () => receiveServerDob(storedDob ?? ""),
    /** A background refetch (focus/reconnect/stale) returns `next`. */
    refetch: (next: string | null) => receiveServerDob(next ?? ""),
    type: (text: string) => applyTextEvent(text, "change"),
    blur: () => applyTextEvent(localText, "blur"),
    /** Tab in and straight out again without typing. */
    focusAndBlur: () => applyTextEvent(localText, "blur"),
    /** Enter — DateField.handleKeyDown preventDefaults, then blurs. */
    pressEnter: () => {
      let defaultPrevented = false;
      // DateField.handleKeyDown: `if (e.key === "Enter") { e.preventDefault(); handleBlur(); }`
      const key = "Enter";
      if (key === "Enter") {
        defaultPrevented = true;
        applyTextEvent(localText, "blur");
      }
      return { defaultPrevented };
    },
    fieldDisabled,
    /** DateField.handleDayClick, including its range guard and callback order. */
    pickFromCalendar: (iso: string) => {
      if (fieldDisabled()) return;
      if (!isInRange(iso)) return;
      localText = isoToDDMMYYYY(iso);
      state = commitDob(state, iso);
      state = reportDobValidity(state, { valid: true });
      flushValueEffect();
    },
    saveDisabled: () => !canSaveDob(state, pending),
    clickSave: () => {
      if (!canSaveDob(state, pending)) return { submitted: false as const };
      saves.push(dobSavePayload(state));
      pending = true;
      return { submitted: true as const };
    },
    /** A GET starts (focus refetch, invalidation) and hasn't resolved yet. */
    startGet: () => {
      inFlightGetCancelled = false;
    },
    /**
     * That in-flight GET resolves with pre-save data. `cancelQueries` in the
     * mutation's onSuccess means a request cancelled by a save never reaches the
     * cache, so it cannot revert the field.
     */
    settleStaleGet: (value: string | null) => {
      if (inFlightGetCancelled) return;
      receiveServerDob(value ?? "");
    },
    /**
     * The PUT resolves. onSuccess cancels any in-flight GET, then caches the
     * response — which is the authoritative stored value, and may differ from what
     * was sent (e.g. another device wrote in between).
     */
    settleSave: (response?: string | null) => {
      pending = false;
      inFlightGetCancelled = true;
      const sent = saves[saves.length - 1]?.dateOfBirth ?? null;
      const profile = response === undefined ? sent : response;
      state = acceptSavedDob(state, sent ?? "", profile ?? "");
      flushValueEffect();
    },
    /** The PUT fails: the cache is untouched and the edit stays on screen. */
    failSave: () => {
      pending = false;
    },
    state: () => ({
      dob: state.value,
      dobValid: state.valid,
      dobError: state.error,
      dobHydrated: state.server !== null,
      localText,
    }),
    saves,
  };
}

// --- end-to-end sequences ---------------------------------------------------------

test("INTEGRATION: typing a valid DOB then clicking Save persists it", () => {
  const f = profileDobField(null);
  f.hydrate();
  f.type("15-05-1990");
  f.blur(); // clicking Save blurs the input first
  assert.equal(f.clickSave().submitted, true);
  assert.deepEqual(f.saves, [{ dateOfBirth: "1990-05-15" }]);
  assert.equal(f.state().localText, "15-05-1990");
});

test("INTEGRATION: the reported bug — blur-then-Save no longer wipes the typed date", () => {
  const f = profileDobField(null);
  f.hydrate();
  f.type("1990-05-15"); // ISO typed into a DD-MM-YYYY field
  f.blur();
  assert.equal(f.clickSave().submitted, false, "Save must be blocked, not send null");
  assert.deepEqual(f.saves, [], "nothing may be persisted");
  const s = f.state();
  assert.equal(s.localText, "1990-05-15", "the typed text stays on screen");
  assert.equal(s.dobValid, false);
  assert.equal(s.dobError, "Enter a valid date in DD-MM-YYYY format");
});

test("INTEGRATION: a bad edit cannot erase an already-stored DOB", () => {
  const f = profileDobField("1990-05-15");
  f.hydrate();
  assert.equal(f.state().localText, "15-05-1990");
  f.type("31-02-1990"); // impossible date
  f.blur();
  assert.equal(f.clickSave().submitted, false);
  assert.deepEqual(f.saves, []);
  assert.equal(f.state().dob, "1990-05-15", "the stored value is untouched");
});

test("INTEGRATION: correcting the date re-enables Save and persists the fix", () => {
  const f = profileDobField(null);
  f.hydrate();
  f.type("15-05-19");
  f.blur();
  assert.equal(f.clickSave().submitted, false);
  f.type("15-05-1990");
  f.blur();
  assert.equal(f.clickSave().submitted, true);
  assert.deepEqual(f.saves, [{ dateOfBirth: "1990-05-15" }]);
});

test("INTEGRATION: deliberately clearing the DOB still saves null", () => {
  const f = profileDobField("1990-05-15");
  f.hydrate();
  f.type("");
  f.blur();
  assert.equal(f.clickSave().submitted, true);
  assert.deepEqual(f.saves, [{ dateOfBirth: null }], "clearing must be possible");
});

test("INTEGRATION: pressing Enter commits a valid date the same way blur does", () => {
  const f = profileDobField(null);
  f.hydrate();
  f.type("15-05-1990");
  assert.equal(f.pressEnter().defaultPrevented, true, "no native form submit");
  assert.equal(f.clickSave().submitted, true);
  assert.deepEqual(f.saves, [{ dateOfBirth: "1990-05-15" }]);
});

test("INTEGRATION: Save is inert while a save is already in flight", () => {
  const f = profileDobField("1990-05-15");
  f.hydrate();
  assert.equal(f.clickSave().submitted, true);
  assert.equal(f.clickSave().submitted, false, "no duplicate submit while pending");
  assert.equal(f.saves.length, 1);
  f.settleSave();
  assert.equal(f.clickSave().submitted, true);
});

test("INTEGRATION: picking from the calendar leaves no stale text and saves", () => {
  const f = profileDobField(null);
  f.hydrate();
  f.type("15-0"); // half-typed, then the user opens the calendar instead
  f.pickFromCalendar("1990-05-15");
  assert.equal(f.state().localText, "15-05-1990", "stale half-typed text is replaced");
  assert.equal(f.state().dobValid, true, "the earlier invalid text is forgiven");
  assert.equal(f.clickSave().submitted, true);
  assert.deepEqual(f.saves, [{ dateOfBirth: "1990-05-15" }]);
});

test("INTEGRATION: the calendar ignores dates outside the allowed range", () => {
  const f = profileDobField(null);
  f.hydrate();
  f.pickFromCalendar("2027-01-01"); // beyond max=TODAY
  assert.equal(f.state().dob, "", "an out-of-range day click is a no-op");
  assert.equal(f.state().localText, "");
});

test("INTEGRATION: a future date is rejected with a bound-specific message", () => {
  const f = profileDobField(null);
  f.hydrate();
  f.type("26-07-2026");
  f.blur();
  assert.equal(f.clickSave().submitted, false);
  assert.equal(f.state().dobError, "Date must be on or before 25-07-2026");
});

test("INTEGRATION: Save is blocked until the stored DOB has been hydrated", () => {
  const f = profileDobField("1990-05-15");
  // No hydrate() yet: the GET hasn't resolved.
  assert.equal(f.state().dobHydrated, false);
  assert.equal(f.clickSave().submitted, false, "must not save an unhydrated field");
  assert.deepEqual(f.saves, [], "a premature save would have wiped the stored date");
  f.hydrate();
  assert.equal(f.clickSave().submitted, true);
  assert.deepEqual(f.saves, [{ dateOfBirth: "1990-05-15" }]);
});

test("INTEGRATION: interacting before the profile loads cannot destroy the stored DOB", () => {
  // The field is disabled until hydrated, and hydration overwrites anything that
  // somehow got in — so the stored date survives both the early edit and the Save
  // that follows it.
  for (const early of ["", "15-05-1990", "15-0"]) {
    const f = profileDobField("1980-01-01");
    f.type(early);
    f.blur();
    assert.equal(f.clickSave().submitted, false, `editing "${early}" must not unlock Save`);
    f.hydrate();
    assert.equal(
      f.state().dob,
      "1980-01-01",
      `hydration must restore the stored date after "${early}"`,
    );
    assert.equal(f.state().localText, "01-01-1980");
    assert.equal(f.clickSave().submitted, true);
    assert.deepEqual(
      f.saves,
      [{ dateOfBirth: "1980-01-01" }],
      `"${early}" must never be persisted`,
    );
  }
});

test("INTEGRATION: a calendar pick before the profile loads cannot destroy the stored DOB", () => {
  const f = profileDobField("1980-01-01");
  f.pickFromCalendar("1990-05-15");
  assert.equal(f.clickSave().submitted, false);
  assert.deepEqual(f.saves, []);
  f.hydrate();
  assert.equal(f.state().dob, "1980-01-01");
  assert.equal(f.clickSave().submitted, true);
  assert.deepEqual(f.saves, [{ dateOfBirth: "1980-01-01" }]);
});

test("INTEGRATION: a background refetch must not overwrite an invalid in-progress edit", () => {
  // React Query refetches ["user-profile"] on focus/reconnect/stale. Unguarded, a
  // changed server value re-seeded the field, so DateField's [value] effect swapped
  // the user's text for the server date while validity stayed false with a stale
  // error — visibly valid text, permanently disabled Save.
  const f = profileDobField("1990-05-15");
  f.hydrate();
  f.type("1975-03-09"); // ISO typed into a DD-MM-YYYY field
  f.blur();
  f.refetch("1975-03-09"); // e.g. saved on another device
  const s = f.state();
  assert.equal(s.localText, "1975-03-09", "the user's text must survive the refetch");
  assert.equal(s.dobValid, false);
  assert.equal(s.dobError, "Enter a valid date in DD-MM-YYYY format");
  assert.equal(f.clickSave().submitted, false, "Save stays blocked, not wedged-but-valid");
  // ...and the user can still recover without reloading the page.
  f.type("09-03-1975");
  f.blur();
  assert.equal(f.clickSave().submitted, true);
  assert.deepEqual(f.saves, [{ dateOfBirth: "1975-03-09" }]);
});

test("INTEGRATION: a refetch away and back again must not mark invalid text valid", () => {
  // A -> B -> A: the second refetch matches the field's committed value, so a naive
  // "value equals server, adopt it" reset would clear the invalid flag and enable
  // Save while unparsable text was still displayed, persisting a different date
  // than the one on screen.
  const f = profileDobField("1990-05-15");
  f.hydrate();
  f.type("1975-03-09"); // invalid: ISO in a DD-MM-YYYY field
  f.blur();
  f.refetch("1970-12-31"); // A -> B
  f.refetch("1990-05-15"); // B -> A, back to the field's committed value
  const s = f.state();
  assert.equal(s.localText, "1975-03-09", "the invalid text is still displayed");
  assert.equal(s.dobValid, false, "so it must still be reported invalid");
  assert.equal(s.dobError, "Enter a valid date in DD-MM-YYYY format");
  assert.equal(f.clickSave().submitted, false, "and Save must stay blocked");
  assert.deepEqual(f.saves, []);
});

test("INTEGRATION: a background refetch must not discard a valid unsaved edit", () => {
  const f = profileDobField("1990-05-15");
  f.hydrate();
  f.type("01-01-1985");
  f.blur();
  f.refetch("1970-12-31");
  assert.equal(f.state().dob, "1985-01-01", "the pending edit wins over refetched data");
  assert.equal(f.state().localText, "01-01-1985");
  assert.equal(f.clickSave().submitted, true);
  assert.deepEqual(f.saves, [{ dateOfBirth: "1985-01-01" }]);
});

test("INTEGRATION: an untouched field still adopts a changed server value", () => {
  // The edit guard must not freeze the field: with no local edit, refetched data
  // (or a clear made elsewhere) has to show up.
  const f = profileDobField("1990-05-15");
  f.hydrate();
  f.refetch("1970-12-31");
  assert.equal(f.state().dob, "1970-12-31");
  assert.equal(f.state().localText, "31-12-1970");
  f.refetch(null); // cleared on another device
  assert.equal(f.state().dob, "");
  assert.equal(f.state().localText, "");
});

test("INTEGRATION: tabbing through the field does not freeze later server updates", () => {
  const f = profileDobField("1990-05-15");
  f.hydrate();
  f.focusAndBlur(); // re-commits the same date; not an edit
  f.refetch("1970-12-31");
  assert.equal(f.state().dob, "1970-12-31");
  assert.equal(f.state().localText, "31-12-1970");
});

test("INTEGRATION: after a successful save the field syncs with the server again", () => {
  const f = profileDobField(null);
  f.hydrate();
  f.type("15-05-1990");
  f.blur();
  assert.equal(f.clickSave().submitted, true);
  f.settleSave(); // onSuccess caches the response, which now matches the edit
  assert.equal(f.state().dob, "1990-05-15");
  f.refetch("1970-12-31");
  assert.equal(f.state().dob, "1970-12-31", "no pending edit, so later updates apply");
  assert.equal(f.state().localText, "31-12-1970");
});

test("INTEGRATION: a failed save keeps the edit and stays retryable", () => {
  const f = profileDobField("1990-05-15");
  f.hydrate();
  f.type("01-01-1985");
  f.blur();
  assert.equal(f.clickSave().submitted, true);
  f.failSave();
  assert.equal(f.state().dob, "1985-01-01", "the edit is not rolled back");
  assert.equal(f.saveDisabled(), false, "the user can retry");
  // A refetch during the failed state still must not steal the edit...
  f.refetch("1990-05-15");
  assert.equal(f.state().dob, "1985-01-01");
  assert.equal(f.clickSave().submitted, true);
  assert.deepEqual(f.saves, [{ dateOfBirth: "1985-01-01" }, { dateOfBirth: "1985-01-01" }]);
});

test("INTEGRATION: a GET in flight when the save succeeds cannot revert the saved DOB", () => {
  // The GET was issued before the PUT, so its response predates the write. If it
  // landed afterwards it would overwrite the cache with the old date, the field
  // would visibly revert, and the next Save would persist the stale value.
  const f = profileDobField("1990-05-15");
  f.hydrate();
  f.type("01-01-1985");
  f.blur();
  f.startGet(); // e.g. window refocus kicks off a background refetch
  assert.equal(f.clickSave().submitted, true);
  f.settleSave(); // onSuccess cancels the in-flight GET, then caches the response
  assert.equal(f.state().dob, "1985-01-01");
  f.settleStaleGet("1990-05-15"); // the cancelled request resolves late
  assert.equal(f.state().dob, "1985-01-01", "the saved value must stand");
  assert.equal(f.state().localText, "01-01-1985");
  assert.equal(f.clickSave().submitted, true);
  assert.deepEqual(
    f.saves,
    [{ dateOfBirth: "1985-01-01" }, { dateOfBirth: "1985-01-01" }],
    "and a second Save must not persist stale data",
  );
});

test("INTEGRATION: an edit typed while a save is in flight is not discarded", () => {
  // The response replaces the field's value, so a naive "adopt the response" would
  // throw away whatever the user typed meanwhile. Locking the field for the whole
  // request would instead wedge it if the request never settles, so the field stays
  // editable and the success handler keeps the newer edit.
  const f = profileDobField("1990-05-15");
  f.hydrate();
  f.type("01-01-1985");
  f.blur();
  assert.equal(f.clickSave().submitted, true);
  assert.equal(f.fieldDisabled(), false, "still editable while saving");
  f.type("31-12-1970"); // changed their mind while the PUT was in flight
  f.blur();
  f.settleSave(); // the PUT for 1985-01-01 succeeds
  assert.equal(f.state().dob, "1970-12-31", "the newer edit survives");
  assert.equal(f.state().localText, "31-12-1970");
  assert.equal(f.saveDisabled(), false, "and can be saved");
  assert.equal(f.clickSave().submitted, true);
  assert.deepEqual(f.saves, [{ dateOfBirth: "1985-01-01" }, { dateOfBirth: "1970-12-31" }]);
});

test("INTEGRATION: invalid text typed while a save is in flight still blocks Save", () => {
  const f = profileDobField("1990-05-15");
  f.hydrate();
  f.type("01-01-1985");
  f.blur();
  assert.equal(f.clickSave().submitted, true);
  f.type("1985-01-01"); // ISO into a DD-MM-YYYY field
  f.blur();
  f.settleSave();
  assert.equal(f.state().localText, "1985-01-01", "the bad text is still shown");
  assert.equal(f.state().dobValid, false, "so Save stays blocked");
  assert.equal(f.clickSave().submitted, false);
  assert.deepEqual(f.saves, [{ dateOfBirth: "1985-01-01" }]);
});

test("INTEGRATION: a save never blocks the field, so a lost request cannot wedge it", () => {
  const f = profileDobField("1990-05-15");
  f.hydrate();
  f.type("01-01-1985");
  f.blur();
  assert.equal(f.clickSave().submitted, true);
  // The request never settles: no onSuccess, no onError yet.
  assert.equal(f.fieldDisabled(), false, "the field must remain usable");
  f.type("31-12-1970");
  f.blur();
  assert.equal(f.state().dob, "1970-12-31");
  // Save is disabled while pending, so the edit above can't be submitted yet. The
  // PUT is bounded by a timeout (see api.test.ts), so the request always settles:
  // the abort surfaces as a normal error and Save becomes usable again.
  assert.equal(f.saveDisabled(), true, "still pending, so Save is held");
  f.failSave(); // the timeout aborts the request -> onError
  assert.equal(f.saveDisabled(), false, "the timeout must restore Save, not wedge it");
  assert.equal(f.clickSave().submitted, true, "and the pending edit can be retried");
  assert.deepEqual(f.saves, [{ dateOfBirth: "1985-01-01" }, { dateOfBirth: "1970-12-31" }]);
});

test("INTEGRATION: a failed save leaves the field editable with the edit intact", () => {
  const f = profileDobField("1990-05-15");
  f.hydrate();
  f.type("01-01-1985");
  f.blur();
  assert.equal(f.clickSave().submitted, true);
  f.failSave();
  assert.equal(f.fieldDisabled(), false, "must not stay locked after an error");
  assert.equal(f.state().dob, "1985-01-01");
  f.type("31-12-1970");
  f.blur();
  assert.equal(f.state().dob, "1970-12-31", "and remains editable");
});

test("INTEGRATION: a save response differing from what was sent is adopted", () => {
  // The server is authoritative: if the response differs (another device wrote in
  // between), show that instead of leaving the field silently out of sync.
  const f = profileDobField("1990-05-15");
  f.hydrate();
  f.type("01-01-1985");
  f.blur();
  assert.equal(f.clickSave().submitted, true);
  f.settleSave("1970-12-31");
  assert.equal(f.state().dob, "1970-12-31");
  assert.equal(f.state().localText, "31-12-1970");
  assert.equal(f.saveDisabled(), false, "and the field stays usable");
  // Not wedged: later server updates still apply.
  f.refetch("1980-01-01");
  assert.equal(f.state().dob, "1980-01-01");
});

test("INTEGRATION: a refetch arriving before hydration behaves like the first load", () => {
  const f = profileDobField("1990-05-15");
  assert.equal(f.clickSave().submitted, false);
  f.refetch("1970-12-31");
  assert.equal(f.state().dobHydrated, true);
  assert.equal(f.state().localText, "31-12-1970");
  assert.equal(f.clickSave().submitted, true);
  assert.deepEqual(f.saves, [{ dateOfBirth: "1970-12-31" }]);
});

test("INTEGRATION: the Save button is disabled exactly when submitting is refused", () => {
  const f = profileDobField("1990-05-15");
  assert.equal(f.saveDisabled(), true, "unhydrated");
  f.hydrate();
  assert.equal(f.saveDisabled(), false);
  f.type("15-05-19");
  f.blur();
  assert.equal(f.saveDisabled(), true, "invalid");
  f.type("15-05-1990");
  f.blur();
  assert.equal(f.saveDisabled(), false);
  f.clickSave();
  assert.equal(f.saveDisabled(), true, "in flight");
  f.settleSave();
  assert.equal(f.saveDisabled(), false);
});

// --- one Save for two endpoints ----------------------------------------------------
//
// Regression tests for the defect found in production: the Profile section had two
// Save buttons. The one beside "Display name" called PATCH /api/auth/profile, which
// writes only the name, yet toasted the same "Profile updated" as the date-of-birth
// save. Pressing it after typing a date reported success and stored nothing — the
// server logs showed a 200 PATCH and no PUT at all.

const storedDob = (server: string): DobState => syncDobFromServer(UNHYDRATED_DOB, server);

test("saving a typed date of birth sends the date-of-birth request", () => {
  // The exact production scenario: no stored DOB, user types one, clicks Save.
  const typed = commitDob(storedDob(""), "1990-05-15");
  const intent = resolveProfileSave(typed, false);
  assert.equal(intent.saveDob, true, "the date of birth must actually be sent");
  assert.equal(intent.noop, false, "and it must not be mistaken for 'no changes'");
  assert.deepEqual(dobSavePayload(typed), { dateOfBirth: "1990-05-15" });
});

test("editing only the display name does not touch the stored date of birth", () => {
  const intent = resolveProfileSave(storedDob("1990-05-15"), true);
  assert.equal(intent.saveName, true);
  assert.equal(intent.saveDob, false, "an unchanged date must not be rewritten");
  assert.equal(intent.noop, false);
});

test("editing both fields sends both requests", () => {
  const both = commitDob(storedDob("1990-05-15"), "1985-01-01");
  assert.deepEqual(resolveProfileSave(both, true), {
    saveName: true,
    saveDob: true,
    noop: false,
  });
});

test("saving with nothing changed is a no-op, not a false success", () => {
  assert.deepEqual(resolveProfileSave(storedDob("1990-05-15"), false), {
    saveName: false,
    saveDob: false,
    noop: true,
  });
  // Same when there has never been a stored date of birth.
  assert.deepEqual(resolveProfileSave(storedDob(""), false), {
    saveName: false,
    saveDob: false,
    noop: true,
  });
});

test("clearing a stored date of birth is a real change", () => {
  const cleared = commitDob(storedDob("1990-05-15"), "");
  const intent = resolveProfileSave(cleared, false);
  assert.equal(intent.saveDob, true, "clearing must be sent, not treated as a no-op");
  assert.equal(intent.noop, false);
  assert.deepEqual(dobSavePayload(cleared), { dateOfBirth: null });
});

test("an unhydrated field never sends a date-of-birth write", () => {
  // Save is already refused before hydration; belt and braces so a stray commit
  // can't turn into a PUT that wipes the stored date.
  const intent = resolveProfileSave(commitDob(UNHYDRATED_DOB, "1990-05-15"), true);
  assert.equal(intent.saveDob, false);
  assert.equal(intent.saveName, true, "the name is independent of DOB hydration");
});

test("a date-of-birth edit still saves when the name was left alone", () => {
  // The name is only sent when dirty; that must not suppress the DOB request.
  const typed = commitDob(storedDob(""), "1990-05-15");
  assert.deepEqual(resolveProfileSave(typed, false), {
    saveName: false,
    saveDob: true,
    noop: false,
  });
});

// --- the display-name field --------------------------------------------------------

test("an untouched display name shows the stored value and is not dirty", () => {
  const f = resolveNameField(null, "Udai Kiran");
  assert.equal(f.value, "Udai Kiran", "the stored name is displayed");
  assert.equal(f.dirty, false);
  assert.equal(f.empty, false);
});

test("an untouched name is never dirty, even if the stored name has stray whitespace", () => {
  // Otherwise merely opening Settings would offer to silently rewrite the name.
  const f = resolveNameField(null, "  Udai Kiran  ");
  assert.equal(f.dirty, false, "the user has not touched anything");
  assert.equal(f.empty, false);
  // And an untouched, entirely blank stored name is still not an edit.
  assert.deepEqual(resolveNameField(null, "   "), {
    value: "   ",
    trimmed: "",
    empty: false,
    dirty: false,
  });
});

test("a renamed display name is dirty and submits trimmed", () => {
  const f = resolveNameField("  Udai K  ", "Udai Kiran");
  assert.equal(f.dirty, true);
  assert.equal(f.trimmed, "Udai K", "trailing whitespace is not persisted");
  assert.equal(f.empty, false);
});

test("padding the stored name with whitespace is not a change", () => {
  const f = resolveNameField("  Udai Kiran  ", "Udai Kiran");
  assert.equal(f.dirty, false, "trimmed equality means nothing to write");
  assert.equal(f.empty, false);
});

test("clearing the display name stays visibly empty and is refused", () => {
  // Regression: the field used to fall back to the stored name, so deleting the last
  // character snapped the old name back and the edit could not be seen or corrected.
  const f = resolveNameField("", "Udai Kiran");
  assert.equal(f.value, "", "the field must not snap back to the stored name");
  assert.equal(f.empty, true, "an empty name is invalid, not 'unchanged'");
  assert.equal(f.dirty, false, "and must never be sent to the API");
});

test("a whitespace-only display name is treated as empty", () => {
  const f = resolveNameField("   ", "Udai Kiran");
  assert.equal(f.empty, true);
  assert.equal(f.dirty, false);
  assert.equal(f.value, "   ", "but what was typed stays on screen");
});

test("naming a user who has no stored name yet", () => {
  const f = resolveNameField("Udai", "");
  assert.equal(f.dirty, true);
  assert.equal(f.trimmed, "Udai");
});

// --- the single Save button's gate -------------------------------------------------
//
// The Profile section has one Save for two endpoints. Each field must gate only
// itself: a rename must go through even when the profile GET failed or the date text
// is half-typed, and neither field may be blocked by the other's problems.

/** Mirrors the component's submit gate. */
function canSubmit(opts: {
  dob: DobState;
  nameTyped: string | null;
  storedName: string;
  dobSaving?: boolean;
  nameSaving?: boolean;
}): boolean {
  const { dob, nameTyped, storedName, dobSaving = false, nameSaving = false } = opts;
  const nameField = resolveNameField(nameTyped, storedName);
  const dobOk = canSaveDob(dob, dobSaving);
  const dobDirty = dobOk && resolveProfileSave(dob, false).saveDob;
  const saving = dobSaving || nameSaving;
  return (
    !saving &&
    !nameField.empty &&
    (nameField.dirty || dobDirty || (dob.server !== null && dob.valid))
  );
}

test("a rename is not blocked by a date of birth that never loaded", () => {
  // Regression: the submit guard used the DOB gate for both fields, so a failed
  // profile GET made it impossible to change your own display name.
  assert.equal(
    canSubmit({ dob: UNHYDRATED_DOB, nameTyped: "New Name", storedName: "Old" }),
    true,
  );
});

test("a rename is not blocked by half-typed date text", () => {
  const invalid = reportDobValidity(storedDob("1990-05-15"), {
    valid: false,
    message: "Enter a valid date in DD-MM-YYYY format",
  });
  assert.equal(canSubmit({ dob: invalid, nameTyped: "New Name", storedName: "Old" }), true);
});

test("an invalid date of birth alone still blocks Save", () => {
  const invalid = reportDobValidity(storedDob("1990-05-15"), {
    valid: false,
    message: "Enter a valid date in DD-MM-YYYY format",
  });
  assert.equal(canSubmit({ dob: invalid, nameTyped: null, storedName: "Old" }), false);
});

test("an empty display name blocks Save even with a valid date of birth", () => {
  const typed = commitDob(storedDob(""), "1990-05-15");
  assert.equal(canSubmit({ dob: typed, nameTyped: "", storedName: "Old" }), false);
});

test("Save is blocked while either request is in flight", () => {
  const typed = commitDob(storedDob(""), "1990-05-15");
  assert.equal(canSubmit({ dob: typed, nameTyped: "New", storedName: "Old" }), true);
  assert.equal(
    canSubmit({ dob: typed, nameTyped: "New", storedName: "Old", dobSaving: true }),
    false,
    "a second click must not duplicate the date-of-birth write",
  );
  assert.equal(
    canSubmit({ dob: typed, nameTyped: "New", storedName: "Old", nameSaving: true }),
    false,
    "nor the display-name write",
  );
});

test("a typed date of birth is submittable with the name untouched", () => {
  // The production scenario end to end: nothing stored, a date typed, name alone.
  const typed = commitDob(storedDob(""), "1990-05-15");
  assert.equal(canSubmit({ dob: typed, nameTyped: null, storedName: "Udai Kiran" }), true);
  assert.deepEqual(resolveProfileSave(typed, false), {
    saveName: false,
    saveDob: true,
    noop: false,
  });
});
