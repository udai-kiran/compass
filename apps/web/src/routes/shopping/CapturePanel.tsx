import { useRef, useState } from "react";
import {
  type ParsedShoppingItem,
  type ShoppingListWithItems,
  DisplayUnitSchema,
  ShoppingListWithItemsSchema,
  convertToBaseQuantity,
} from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import { apiGet } from "../../lib/api.ts";
import { useCapabilities } from "../../lib/settings-queries.ts";
import { useParseText, useParseImage, useShoppingListMutations } from "../../lib/shopping-queries.ts";

type Tab = "text" | "photo";

/** A parsed item being reviewed by the user before committing. */
interface DraftItem {
  /** Unique id within this session (not a DB id). */
  key: string;
  rawText: string;
  /** Display-unit quantity string, e.g. "1.5" (kg, litre) or "500" (g, ml, piece). */
  quantityDisplay: string;
  /** Display unit — may be "kg", "g", "litre", "ml", or "piece". */
  unitDisplay: string;
}

function parsedToDraft(item: ParsedShoppingItem, idx: number): DraftItem {
  // Prefer the display unit if quantityBase is set; fall back to empty inputs.
  const unitDisplay = item.unit ?? "";
  const quantityDisplay = item.quantityBase !== null ? String(item.quantityBase) : "";
  return {
    key: `${idx}-${item.rawText}`,
    rawText: item.rawText,
    quantityDisplay,
    unitDisplay,
  };
}

interface Props {
  listId: string;
  onClose: () => void;
  onItemsAdded: () => void;
}

export function CapturePanel({ listId, onClose, onItemsAdded }: Props) {
  const { data: caps } = useCapabilities();
  const aiEnabled = caps?.aiEnabled ?? true; // optimistic until loaded

  const [tab, setTab] = useState<Tab>("text");
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<DraftItem[] | null>(null);
  const [addProgress, setAddProgress] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const parseText = useParseText();
  const parseImage = useParseImage();
  const { addItem, canonicalize } = useShoppingListMutations();

  // ── Step 1 handlers ────────────────────────────────────────────────────────

  function handleParseText() {
    if (!text.trim()) return;
    parseText.mutate(
      { text: text.trim(), sourceKind: "freetext" },
      {
        onSuccess: (res) => {
          if (!res.available) {
            toast(res.message ?? "AI is not configured. Set up a provider in Settings → AI.", "error");
            return;
          }
          if (res.items.length === 0) {
            toast(res.message ?? "No items found in the text. Try rephrasing.", "error");
            return;
          }
          setDrafts(res.items.map(parsedToDraft));
        },
        onError: (e) => toast(e instanceof Error ? e.message : "Parse failed", "error"),
      },
    );
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    parseImage.mutate(file, {
      onSuccess: (res) => {
        if (!res.available) {
          toast(res.message ?? "AI is not configured or does not support vision.", "error");
          return;
        }
        if (res.items.length === 0) {
          toast(res.message ?? "Could not extract items from the photo. Try a clearer image.", "error");
          return;
        }
        setDrafts(res.items.map(parsedToDraft));
        // Reset the file input so the same file can be reselected.
        if (fileRef.current) fileRef.current.value = "";
      },
      onError: (e) => toast(e instanceof Error ? e.message : "Image parse failed", "error"),
    });
  }

  // ── Step 2 handlers ────────────────────────────────────────────────────────

  function updateDraft(key: string, patch: Partial<DraftItem>) {
    setDrafts((prev) => prev?.map((d) => (d.key === key ? { ...d, ...patch } : d)) ?? null);
  }

  function removeDraft(key: string) {
    setDrafts((prev) => {
      const next = (prev ?? []).filter((d) => d.key !== key);
      return next.length === 0 ? null : next;
    });
  }

  async function handleAddToList() {
    if (!drafts || drafts.length === 0) return;
    let added = 0;
    const total = drafts.length;
    // Track item IDs so we can fire-and-forget canonicalize after all items are added.
    const addedItemIds: string[] = [];
    // Pre-populate with existing item IDs so we don't re-canonicalize pre-existing items.
    const existingList = await apiGet(`/api/shopping/lists/${listId}`, ShoppingListWithItemsSchema);
    const seenItemIds = new Set(existingList.items.map((i) => i.id));

    for (const draft of drafts) {
      // Convert display unit to base unit if quantityDisplay is set.
      let quantityBase: number | null = null;
      let unit: "g" | "ml" | "piece" | null = null;
      const qRaw = draft.quantityDisplay.trim();
      const uRaw = draft.unitDisplay.trim();
      if (qRaw && uRaw) {
        const parseResult = DisplayUnitSchema.safeParse(uRaw);
        if (parseResult.success) {
          try {
            const converted = convertToBaseQuantity(qRaw, parseResult.data);
            quantityBase = converted.quantityBase;
            unit = converted.unit;
          } catch {
            // Invalid quantity string — leave null (item added without quantity).
          }
        }
      }

      try {
        const result = await new Promise<ShoppingListWithItems>((resolve, reject) => {
          addItem.mutate(
            {
              listId,
              body: {
                rawText: draft.rawText,
                catalogItemId: null,
                quantityBase,
                unit,
              },
            },
            {
              onSuccess: (res) => resolve(res),
              onError: (e) => reject(e),
            },
          );
        });
        // Identify the newly added item by diffing against previously seen IDs.
        for (const itm of result.items) {
          if (!seenItemIds.has(itm.id)) {
            addedItemIds.push(itm.id);
          }
          seenItemIds.add(itm.id);
        }
        added++;
        setAddProgress(`Added ${added}/${total} items…`);
      } catch (e) {
        toast(
          `Added ${added} of ${total} items — stopped at error: ${e instanceof Error ? e.message : "unknown error"}`,
          "error",
        );
        onItemsAdded();
        return;
      }
    }
    setAddProgress(null);
    toast(`Added ${added} item${added === 1 ? "" : "s"} to the list.`, "success");
    // Fire-and-forget canonicalize for each added item (best-effort, non-blocking).
    for (const itemId of addedItemIds) {
      canonicalize.mutate({ listId, itemId });
    }
    onItemsAdded();
  }

  const isParsing = parseText.isPending || parseImage.isPending;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="card mt-4 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-700">
          {drafts ? "Review parsed items" : "Capture items"}
        </h3>
        <button
          onClick={onClose}
          aria-label="Close capture panel"
          className="text-slate-400 hover:text-slate-600"
        >
          ✕
        </button>
      </div>

      {/* Step 1 — text or photo input */}
      {!drafts && (
        <div>
          {/* Tab toggle */}
          <div className="mb-3 flex gap-2">
            <button
              onClick={() => setTab("text")}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === "text" ? "bg-brand-600 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}
            >
              Paste text
            </button>
            <button
              onClick={() => setTab("photo")}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === "photo" ? "bg-brand-600 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}
            >
              Photo
            </button>
          </div>

          {!aiEnabled && (
            <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              AI is not configured. Go to Settings → AI to set up a provider before using capture.
            </p>
          )}

          {tab === "text" && (
            <div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                placeholder={"Milk 2 pcs\nEggs 1 dozen\nBread"}
                className="input w-full font-mono text-xs"
                disabled={!aiEnabled}
              />
              <button
                onClick={handleParseText}
                disabled={!aiEnabled || !text.trim() || isParsing}
                className="btn-primary mt-2 disabled:opacity-50"
              >
                {isParsing ? "Parsing…" : "Parse"}
              </button>
            </div>
          )}

          {tab === "photo" && (
            <div>
              <label
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500 ${!aiEnabled ? "cursor-not-allowed opacity-50" : "hover:bg-slate-100"}`}
              >
                {isParsing ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" aria-hidden="true" />
                    Parsing image…
                  </span>
                ) : (
                  <>
                    <span>Tap to take a photo or choose a file</span>
                    <span className="text-xs text-slate-400">JPEG, PNG, WebP accepted</span>
                  </>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  className="sr-only"
                  disabled={!aiEnabled || isParsing}
                  onChange={handleFileChange}
                />
              </label>
            </div>
          )}
        </div>
      )}

      {/* Step 2 — review parsed drafts */}
      {drafts && (
        <div>
          <ul className="mb-3 divide-y divide-slate-100">
            {drafts.map((draft) => (
              <li key={draft.key} className="flex items-center gap-2 py-2">
                <input
                  value={draft.rawText}
                  onChange={(e) => updateDraft(draft.key, { rawText: e.target.value })}
                  className="input flex-1 text-sm"
                  aria-label="Item name"
                />
                <input
                  value={draft.quantityDisplay}
                  onChange={(e) => updateDraft(draft.key, { quantityDisplay: e.target.value })}
                  className="input w-20 text-sm"
                  placeholder="Qty"
                  aria-label="Quantity"
                />
                <select
                  value={draft.unitDisplay}
                  onChange={(e) => updateDraft(draft.key, { unitDisplay: e.target.value })}
                  className="input w-24 text-sm"
                  aria-label="Unit"
                >
                  <option value="">—</option>
                  <option value="piece">piece</option>
                  <option value="g">g</option>
                  <option value="kg">kg</option>
                  <option value="ml">ml</option>
                  <option value="litre">litre</option>
                </select>
                <button
                  onClick={() => removeDraft(draft.key)}
                  aria-label={`Remove ${draft.rawText}`}
                  className="shrink-0 text-slate-400 hover:text-red-600"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          {addProgress && (
            <p className="mb-2 text-xs text-slate-500">{addProgress}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => void handleAddToList()}
              disabled={drafts.length === 0 || addItem.isPending}
              className="btn-primary disabled:opacity-50"
            >
              {addItem.isPending
                ? "Adding…"
                : `Add ${drafts.length} item${drafts.length === 1 ? "" : "s"} to list`}
            </button>
            <button
              onClick={() => setDrafts(null)}
              className="btn-secondary"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
