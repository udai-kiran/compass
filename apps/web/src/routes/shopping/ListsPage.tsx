import { useState } from "react";
import {
  type ShoppingList,
  type ShoppingListItem,
  DisplayUnitSchema,
  convertToBaseQuantity,
} from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import { PageLoading, PageError, EmptyState } from "../../components/States.tsx";
import {
  useShoppingLists,
  useShoppingList,
  useShoppingListMutations,
  useShoppingCatalog,
} from "../../lib/shopping-queries.ts";
import { CapturePanel } from "./CapturePanel.tsx";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusLabel(status: ShoppingList["status"]) {
  return status === "archived" ? "Archived" : "Active";
}

function itemStatusLabel(status: ShoppingListItem["status"]) {
  return status === "bought" ? "Bought" : status === "dropped" ? "Dropped" : "Pending";
}

function formatQty(item: ShoppingListItem) {
  if (item.quantityBase === null || item.unit === null) return null;
  return `${item.quantityBase} ${item.unit}`;
}

// ─── Inline item editor ───────────────────────────────────────────────────────

interface ItemEditorProps {
  listId: string;
  item: ShoppingListItem;
  onDone: () => void;
}

function ItemEditor({ listId, item, onDone }: ItemEditorProps) {
  const [rawText, setRawText] = useState(item.rawText);
  const [qtyDisplay, setQtyDisplay] = useState(
    item.quantityBase !== null ? String(item.quantityBase) : "",
  );
  const [unitDisplay, setUnitDisplay] = useState(item.unit ?? "");
  const [status, setStatus] = useState<ShoppingListItem["status"]>(item.status);
  const { updateItem } = useShoppingListMutations();

  function handleSave() {
    if (!rawText.trim()) {
      toast("Item name must not be empty", "error");
      return;
    }
    // Resolve display-unit quantities to base quantities.
    let quantityBase: number | null = null;
    let unit: "g" | "ml" | "piece" | null = null;
    const qRaw = qtyDisplay.trim();
    const uRaw = unitDisplay.trim();
    if (qRaw && uRaw) {
      const parseResult = DisplayUnitSchema.safeParse(uRaw);
      if (parseResult.success) {
        try {
          const c = convertToBaseQuantity(qRaw, parseResult.data);
          quantityBase = c.quantityBase;
          unit = c.unit;
        } catch {
          toast("Invalid quantity — leave quantity blank or correct it.", "error");
          return;
        }
      } else {
        toast("Unknown unit — select a valid unit.", "error");
        return;
      }
    }

    updateItem.mutate(
      {
        listId,
        itemId: item.id,
        body: {
          rawText: rawText.trim(),
          catalogItemId: item.catalogItemId,
          quantityBase,
          unit,
          status,
        },
      },
      {
        onSuccess: () => onDone(),
        onError: (e) => toast(e instanceof Error ? e.message : "Save failed", "error"),
      },
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3">
      <input
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        className="input text-sm"
        placeholder="Item name"
        autoFocus
      />
      <div className="flex gap-2">
        <input
          value={qtyDisplay}
          onChange={(e) => setQtyDisplay(e.target.value)}
          className="input w-24 text-sm"
          placeholder="Qty"
        />
        <select
          value={unitDisplay}
          onChange={(e) => setUnitDisplay(e.target.value)}
          className="input w-28 text-sm"
        >
          <option value="">— unit —</option>
          <option value="piece">piece</option>
          <option value="g">g</option>
          <option value="kg">kg</option>
          <option value="ml">ml</option>
          <option value="litre">litre</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ShoppingListItem["status"])}
          className="input flex-1 text-sm"
        >
          <option value="pending">Pending</option>
          <option value="bought">Bought</option>
          <option value="dropped">Dropped</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={updateItem.isPending}
          className="btn-primary disabled:opacity-50"
        >
          {updateItem.isPending ? "Saving…" : "Save"}
        </button>
        <button onClick={onDone} className="btn-secondary">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Item row ─────────────────────────────────────────────────────────────────

interface ItemRowProps {
  listId: string;
  item: ShoppingListItem;
  items: ShoppingListItem[];
  isEditing: boolean;
  onEdit: () => void;
  onDoneEdit: () => void;
}

function ItemRow({ listId, item, items, isEditing, onEdit, onDoneEdit }: ItemRowProps) {
  const { updateItem, removeItem, reorder, canonicalize } = useShoppingListMutations();
  const { data: catalogData } = useShoppingCatalog();
  const [ambiguousCandidates, setAmbiguousCandidates] = useState<string[] | null>(null);

  if (isEditing) {
    return <ItemEditor listId={listId} item={item} onDone={onDoneEdit} />;
  }

  function handleCanonicalize() {
    canonicalize.mutate(
      { listId, itemId: item.id },
      {
        onSuccess: (result) => {
          if (result.match.status === "matched") {
            toast("Linked to catalog item.", "success");
          } else if (result.match.status === "ambiguous") {
            setAmbiguousCandidates(result.match.candidateIds);
          } else {
            toast("No catalog match found.", "success");
          }
        },
        onError: (e) => toast(e instanceof Error ? e.message : "Canonicalize failed", "error"),
      },
    );
  }

  function handleMarkBought() {
    updateItem.mutate(
      {
        listId,
        itemId: item.id,
        body: {
          rawText: item.rawText,
          catalogItemId: item.catalogItemId,
          quantityBase: item.quantityBase,
          unit: item.unit,
          status: "bought",
        },
      },
      {
        onError: (e) => toast(e instanceof Error ? e.message : "Update failed", "error"),
      },
    );
  }

  function handleDelete() {
    removeItem.mutate(
      { listId, itemId: item.id },
      {
        onError: (e) => toast(e instanceof Error ? e.message : "Delete failed", "error"),
      },
    );
  }

  function handleMove(direction: "up" | "down") {
    const idx = items.findIndex((i) => i.id === item.id);
    if (idx < 0) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= items.length) return;
    const ordered = [...items];
    const spliced = ordered.splice(idx, 1);
    const moved = spliced[0];
    if (!moved) return;
    ordered.splice(newIdx, 0, moved);
    reorder.mutate(
      { listId, body: { orderedIds: ordered.map((i) => i.id) } },
      {
        onError: (e) => toast(e instanceof Error ? e.message : "Reorder failed", "error"),
      },
    );
  }

  const qty = formatQty(item);
  const isBusy =
    updateItem.isPending || removeItem.isPending || reorder.isPending || canonicalize.isPending;

  return (
    <>
      <div className="flex items-center gap-2 py-2">
        {/* Reorder buttons */}
        <div className="flex flex-col">
          <button
            onClick={() => handleMove("up")}
            disabled={isBusy}
            aria-label="Move item up"
            className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"
          >
            ▲
          </button>
          <button
            onClick={() => handleMove("down")}
            disabled={isBusy}
            aria-label="Move item down"
            className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"
          >
            ▼
          </button>
        </div>

        {/* Item content */}
        <button
          onClick={onEdit}
          className="min-w-0 flex-1 text-left text-sm text-slate-700 hover:text-brand-700"
        >
          <span className={item.status === "bought" ? "line-through text-slate-400" : ""}>
            {item.rawText}
          </span>
          {qty && (
            <span className="ml-1 text-xs text-slate-400">{qty}</span>
          )}
        </button>

        {/* Status badge */}
        <span
          className={`badge shrink-0 text-xs ${
            item.status === "bought"
              ? "bg-emerald-100 text-emerald-700"
              : item.status === "dropped"
                ? "bg-slate-100 text-slate-500"
                : "bg-sky-100 text-sky-700"
          }`}
        >
          {itemStatusLabel(item.status)}
        </span>

        {/* Actions */}
        {item.catalogItemId === null && item.status === "pending" && (
          <button
            onClick={handleCanonicalize}
            disabled={isBusy}
            aria-label="Link to catalog"
            className="shrink-0 text-xs text-slate-400 hover:text-brand-600 disabled:opacity-40"
          >
            {canonicalize.isPending ? "…" : "🔗 Link"}
          </button>
        )}
        {item.status !== "bought" && (
          <button
            onClick={handleMarkBought}
            disabled={isBusy}
            aria-label="Mark as bought"
            className="shrink-0 text-xs font-medium text-emerald-600 hover:underline disabled:opacity-40"
          >
            Bought
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={isBusy}
          aria-label={`Delete ${item.rawText}`}
          className="shrink-0 text-slate-400 hover:text-red-600 disabled:opacity-40"
        >
          ✕
        </button>
      </div>

      {/* Ambiguous catalog candidates */}
      {ambiguousCandidates && ambiguousCandidates.length > 0 && (
        <div className="ml-8 pb-2 text-xs text-slate-500">
          <p className="mb-1 font-medium text-slate-600">Multiple matches — which one?</p>
          <ul className="space-y-1">
            {ambiguousCandidates.map((candidateId) => {
              const name =
                catalogData?.find((c) => c.id === candidateId)?.canonicalName ?? candidateId;
              return (
                <li key={candidateId} className="flex items-center gap-2">
                  <span>{name}</span>
                  <button
                    onClick={() =>
                      setAmbiguousCandidates(
                        (prev) => prev?.filter((c) => c !== candidateId) ?? null,
                      )
                    }
                    className="text-slate-400 hover:text-red-600"
                    aria-label={`Dismiss ${name}`}
                  >
                    not this
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

// ─── Add item form ────────────────────────────────────────────────────────────

interface AddItemFormProps {
  listId: string;
  onDone: () => void;
}

function AddItemForm({ listId, onDone }: AddItemFormProps) {
  const [rawText, setRawText] = useState("");
  const [qtyDisplay, setQtyDisplay] = useState("");
  const [unitDisplay, setUnitDisplay] = useState("");
  const { addItem } = useShoppingListMutations();

  function handleAdd() {
    if (!rawText.trim()) return;
    let quantityBase: number | null = null;
    let unit: "g" | "ml" | "piece" | null = null;
    const qRaw = qtyDisplay.trim();
    const uRaw = unitDisplay.trim();
    if (qRaw && uRaw) {
      const parseResult = DisplayUnitSchema.safeParse(uRaw);
      if (parseResult.success) {
        try {
          const c = convertToBaseQuantity(qRaw, parseResult.data);
          quantityBase = c.quantityBase;
          unit = c.unit;
        } catch {
          toast("Invalid quantity — leave quantity blank or enter a valid number.", "error");
          return;
        }
      }
    }
    addItem.mutate(
      {
        listId,
        body: {
          rawText: rawText.trim(),
          catalogItemId: null,
          quantityBase,
          unit,
        },
      },
      {
        onSuccess: () => {
          setRawText("");
          setQtyDisplay("");
          setUnitDisplay("");
          onDone();
        },
        onError: (e) => toast(e instanceof Error ? e.message : "Add failed", "error"),
      },
    );
  }

  return (
    <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
      <input
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleAdd();
          if (e.key === "Escape") onDone();
        }}
        className="input flex-1 text-sm"
        placeholder="Add item…"
        autoFocus
      />
      <input
        value={qtyDisplay}
        onChange={(e) => setQtyDisplay(e.target.value)}
        className="input w-20 text-sm"
        placeholder="Qty"
      />
      <select
        value={unitDisplay}
        onChange={(e) => setUnitDisplay(e.target.value)}
        className="input w-24 text-sm"
      >
        <option value="">— unit —</option>
        <option value="piece">piece</option>
        <option value="g">g</option>
        <option value="kg">kg</option>
        <option value="ml">ml</option>
        <option value="litre">litre</option>
      </select>
      <button
        onClick={handleAdd}
        disabled={!rawText.trim() || addItem.isPending}
        className="btn-primary disabled:opacity-50"
      >
        {addItem.isPending ? "Adding…" : "Add"}
      </button>
      <button onClick={onDone} className="btn-secondary">
        Cancel
      </button>
    </div>
  );
}

// ─── List detail (right panel) ────────────────────────────────────────────────

interface ListDetailProps {
  listId: string;
}

function ListDetail({ listId }: ListDetailProps) {
  const { data: list, isLoading, isError, error, refetch } = useShoppingList(listId);
  const { update, remove } = useShoppingListMutations();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showCapture, setShowCapture] = useState(false);

  if (isLoading) return <PageLoading label="Loading list…" />;
  if (isError || !list)
    return (
      <PageError
        message={error instanceof Error ? error.message : "Could not load list."}
        onRetry={() => void refetch()}
      />
    );

  function handleStartRename() {
    setNameValue(list!.name);
    setEditingName(true);
  }

  function handleSaveName() {
    if (!nameValue.trim()) return;
    update.mutate(
      {
        id: list!.id,
        body: {
          name: nameValue.trim(),
          note: list!.note,
          status: list!.status,
        },
      },
      {
        onSuccess: () => setEditingName(false),
        onError: (e) => toast(e instanceof Error ? e.message : "Rename failed", "error"),
      },
    );
  }

  function handleArchive() {
    update.mutate(
      {
        id: list!.id,
        body: {
          name: list!.name,
          note: list!.note,
          status: list!.status === "archived" ? "active" : "archived",
        },
      },
      {
        onError: (e) => toast(e instanceof Error ? e.message : "Archive failed", "error"),
      },
    );
  }

  function handleDelete() {
    if (!confirm(`Delete "${list!.name}"? This cannot be undone.`)) return;
    remove.mutate(list!.id, {
      onError: (e) => toast(e instanceof Error ? e.message : "Delete failed", "error"),
    });
  }

  const isBusy = update.isPending || remove.isPending;

  return (
    <div>
      {/* List header */}
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {editingName ? (
            <div className="flex gap-2">
              <input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") setEditingName(false);
                }}
                className="input flex-1 text-base font-semibold"
                autoFocus
              />
              <button
                onClick={handleSaveName}
                disabled={update.isPending}
                className="btn-primary disabled:opacity-50"
              >
                {update.isPending ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setEditingName(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={handleStartRename}
              className="text-left text-base font-semibold text-slate-800 hover:text-brand-700"
              aria-label="Rename list"
            >
              {list.name}
            </button>
          )}
          <span
            className={`mt-1 inline-block badge text-xs ${
              list.status === "archived"
                ? "bg-slate-100 text-slate-500"
                : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {statusLabel(list.status)}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 gap-2">
          <button
            onClick={handleArchive}
            disabled={isBusy}
            className="btn-secondary text-xs disabled:opacity-50"
          >
            {list.status === "archived" ? "Unarchive" : "Archive"}
          </button>
          <button
            onClick={handleDelete}
            disabled={isBusy}
            className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Delete
          </button>
          <button
            onClick={() => setShowCapture((v) => !v)}
            className="btn-secondary text-xs"
          >
            {showCapture ? "Hide capture" : "📷 Capture"}
          </button>
        </div>
      </div>

      {/* Capture panel */}
      {showCapture && (
        <CapturePanel
          listId={listId}
          onClose={() => setShowCapture(false)}
          onItemsAdded={() => setShowCapture(false)}
        />
      )}

      {/* Items */}
      {list.items.length === 0 && !showAddItem ? (
        <EmptyState
          title="No items yet"
          hint="Add items manually or use Capture to parse text or a photo."
          action={
            <button onClick={() => setShowAddItem(true)} className="btn-primary">
              Add item
            </button>
          }
        />
      ) : (
        <div className="divide-y divide-slate-100">
          {list.items.map((item) => (
            <ItemRow
              key={item.id}
              listId={listId}
              item={item}
              items={list.items}
              isEditing={editingItemId === item.id}
              onEdit={() => {
                setShowAddItem(false);
                setEditingItemId(item.id);
              }}
              onDoneEdit={() => setEditingItemId(null)}
            />
          ))}

          {showAddItem ? (
            <AddItemForm listId={listId} onDone={() => setShowAddItem(false)} />
          ) : (
            <div className="pt-3">
              <button
                onClick={() => {
                  setEditingItemId(null);
                  setShowAddItem(true);
                }}
                className="btn-secondary text-sm"
              >
                + Add item
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Lists page ───────────────────────────────────────────────────────────────

export function ListsPage() {
  const { data: lists, isLoading, isError, error, refetch } = useShoppingLists();
  const { create } = useShoppingListMutations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");

  if (isLoading) return <PageLoading label="Loading lists…" />;
  if (isError)
    return (
      <PageError
        message={error instanceof Error ? error.message : "Could not load shopping lists."}
        onRetry={() => void refetch()}
      />
    );

  function handleCreate() {
    if (!newName.trim()) return;
    create.mutate(
      { name: newName.trim(), note: null },
      {
        onSuccess: (created) => {
          setNewName("");
          setShowCreate(false);
          setSelectedId(created.id);
        },
        onError: (e) => toast(e instanceof Error ? e.message : "Create failed", "error"),
      },
    );
  }

  const active = (lists ?? []).filter((l) => l.status === "active");
  const archived = (lists ?? []).filter((l) => l.status === "archived");

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-slate-800">Shopping Lists</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Manage your shopping lists, add items, and capture from text or photos.
        </p>
      </header>

      <div className="flex gap-4">
        {/* Left sidebar — list of lists */}
        <aside className="card w-64 shrink-0 p-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Lists
            </span>
            <button
              onClick={() => {
                setShowCreate(true);
                setNewName("");
              }}
              className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
            >
              + New
            </button>
          </div>

          {/* Inline create form */}
          {showCreate && (
            <div className="mb-3 flex flex-col gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") setShowCreate(false);
                }}
                className="input text-sm"
                placeholder="List name"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim() || create.isPending}
                  className="btn-primary text-xs disabled:opacity-50"
                >
                  {create.isPending ? "Creating…" : "Create"}
                </button>
                <button onClick={() => setShowCreate(false)} className="btn-secondary text-xs">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Active lists */}
          {active.length > 0 && (
            <div className="space-y-0.5">
              {active.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setSelectedId(l.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
                    selectedId === l.id
                      ? "bg-brand-50 font-medium text-brand-800"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span className="flex-1 truncate">{l.name}</span>
                  <span className="badge shrink-0 bg-emerald-100 text-xs text-emerald-700">
                    Active
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Archived lists */}
          {archived.length > 0 && (
            <div className="mt-3 space-y-0.5">
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Archived
              </p>
              {archived.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setSelectedId(l.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
                    selectedId === l.id
                      ? "bg-brand-50 font-medium text-brand-800"
                      : "text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  <span className="flex-1 truncate">{l.name}</span>
                  <span className="badge shrink-0 bg-slate-100 text-xs text-slate-400">
                    Archived
                  </span>
                </button>
              ))}
            </div>
          )}

          {(lists ?? []).length === 0 && !showCreate && (
            <EmptyState
              title="No lists yet"
              hint="Create your first shopping list to get started."
              action={
                <button
                  onClick={() => {
                    setShowCreate(true);
                    setNewName("");
                  }}
                  className="btn-primary"
                >
                  Create list
                </button>
              }
            />
          )}
        </aside>

        {/* Right panel — selected list detail */}
        <div className="card min-h-64 flex-1 p-4">
          {selectedId ? (
            <ListDetail listId={selectedId} />
          ) : (
            <EmptyState
              title="Select a list"
              hint="Choose a list from the sidebar or create a new one."
            />
          )}
        </div>
      </div>
    </div>
  );
}
