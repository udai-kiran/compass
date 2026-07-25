import { useState } from "react";
import {
  calculateAge,
  EducationStageSchema,
  FamilyRelationshipSchema,
  todayInIST,
  type FamilyMember,
} from "@compass/shared";
import { DateField } from "../../components/DateField.tsx";
import { useFamilyMembers, useFamilyMutations } from "../../lib/family-queries.ts";

export function FamilyPanel() {
  const { data: members, isLoading: membersLoading } = useFamilyMembers();
  const { create, update, remove } = useFamilyMutations();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // New member form state
  const [newName, setNewName] = useState("");
  const [newRelationship, setNewRelationship] = useState<FamilyMember["relationship"]>("child");
  const [newDob, setNewDob] = useState("");
  const [newDobValid, setNewDobValid] = useState(true);
  const [newDobError, setNewDobError] = useState<string | undefined>();
  const [newEducationStage, setNewEducationStage] = useState<FamilyMember["educationStage"]>(null);
  const [newInstitution, setNewInstitution] = useState("");
  const [newCourse, setNewCourse] = useState("");
  const [newExpectedYear, setNewExpectedYear] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const handleAddMember = () => {
    if (!newName.trim()) return;
    create.mutate(
      {
        name: newName.trim(),
        relationship: newRelationship,
        dateOfBirth: newDob || null,
        educationStage: newEducationStage,
        institution: newInstitution.trim() || null,
        courseOrStream: newCourse.trim() || null,
        expectedCompletionYear: newExpectedYear ? parseInt(newExpectedYear, 10) : null,
        notes: newNotes.trim() || null,
      },
      {
        onSuccess: () => {
          setNewName("");
          setNewRelationship("child");
          setNewDob("");
          setNewDobValid(true);
          setNewDobError(undefined);
          setNewEducationStage(null);
          setNewInstitution("");
          setNewCourse("");
          setNewExpectedYear("");
          setNewNotes("");
          setShowAddForm(false);
        },
      },
    );
  };

  const handleDeleteMember = (id: string, name: string) => {
    if (confirm(`Remove ${name}?`)) {
      remove.mutate(id);
    }
  };

  return (
    <div className="mt-4 max-w-3xl space-y-6">
      {/* Family Members Section */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Family members</h2>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white"
          >
            {showAddForm ? "Cancel" : "Add member"}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Record spouse, children, parents, or others for planning. Your own profile details are in the Profile tab.
        </p>

        {showAddForm && (
          <div className="mt-4 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Name *
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="e.g., Priya"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Relationship *
                <select
                  value={newRelationship}
                  onChange={(e) => setNewRelationship(e.target.value as FamilyMember["relationship"])}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                >
                  {FamilyRelationshipSchema.options.map((rel) => (
                    <option key={rel} value={rel}>
                      {rel.charAt(0).toUpperCase() + rel.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Date of birth
                <DateField
                  value={newDob}
                  onChange={setNewDob}
                  max={todayInIST()}
                  className="w-full"
                  commitOnValidChange
                  onValidityChange={(state) => {
                    setNewDobValid(state.valid);
                    setNewDobError(state.message);
                  }}
                  aria-invalid={!newDobValid}
                  aria-describedby={!newDobValid && newDobError ? "new-member-dob-error" : undefined}
                />
                {!newDobValid && newDobError && (
                  <span id="new-member-dob-error" className="text-xs text-red-600">{newDobError}</span>
                )}
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Education stage
                <select
                  value={newEducationStage ?? ""}
                  onChange={(e) =>
                    setNewEducationStage(
                      e.target.value ? (e.target.value as FamilyMember["educationStage"]) : null,
                    )
                  }
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="">None</option>
                  {EducationStageSchema.options.map((stage) => (
                    <option key={stage} value={stage}>
                      {stage.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Institution
                <input
                  value={newInstitution}
                  onChange={(e) => setNewInstitution(e.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="e.g., St. Xavier's"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Course / Stream
                <input
                  value={newCourse}
                  onChange={(e) => setNewCourse(e.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="e.g., Computer Science"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Expected completion year
                <input
                  type="number"
                  value={newExpectedYear}
                  onChange={(e) => setNewExpectedYear(e.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="e.g., 2030"
                  min="1950"
                  max="2100"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Notes
              <textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                rows={2}
                placeholder="Additional notes"
              />
            </label>
            <button
              onClick={handleAddMember}
              disabled={!newName.trim() || !newDobValid}
              className="rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Save member
            </button>
          </div>
        )}

        {membersLoading ? (
          <p className="mt-4 text-sm text-slate-400">Loading...</p>
        ) : !members || members.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">
            No family members added yet. Click "Add member" to record spouse, children, parents, or others.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {members.map((member) => (
              <FamilyMemberRow
                key={member.id}
                member={member}
                isEditing={editingId === member.id}
                onEdit={() => setEditingId(member.id)}
                onCancelEdit={() => setEditingId(null)}
                onSave={(data) => {
                  update.mutate({ id: member.id, data }, { onSuccess: () => setEditingId(null) });
                }}
                onDelete={() => handleDeleteMember(member.id, member.name)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FamilyMemberRow({
  member,
  isEditing,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  member: FamilyMember;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (data: Partial<FamilyMember>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(member.name);
  const [relationship, setRelationship] = useState(member.relationship);
  const [dob, setDob] = useState(member.dateOfBirth || "");
  const [dobValid, setDobValid] = useState(true);
  const [dobError, setDobError] = useState<string | undefined>();
  const [educationStage, setEducationStage] = useState(member.educationStage);
  const [institution, setInstitution] = useState(member.institution || "");
  const [course, setCourse] = useState(member.courseOrStream || "");
  const [expectedYear, setExpectedYear] = useState(member.expectedCompletionYear?.toString() || "");
  const [notes, setNotes] = useState(member.notes || "");

  const handleSave = () => {
    onSave({
      name: name.trim(),
      relationship,
      dateOfBirth: dob || null,
      educationStage,
      institution: institution.trim() || null,
      courseOrStream: course.trim() || null,
      expectedCompletionYear: expectedYear ? parseInt(expectedYear, 10) : null,
      notes: notes.trim() || null,
    });
  };

  if (isEditing) {
    return (
      <li className="space-y-3 py-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Relationship
            <select
              value={relationship}
              onChange={(e) => setRelationship(e.target.value as FamilyMember["relationship"])}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              {FamilyRelationshipSchema.options.map((rel) => (
                <option key={rel} value={rel}>
                  {rel.charAt(0).toUpperCase() + rel.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Date of birth
            <DateField
              value={dob}
              onChange={setDob}
              max={todayInIST()}
              className="w-full"
              commitOnValidChange
              onValidityChange={(state) => {
                setDobValid(state.valid);
                setDobError(state.message);
              }}
              aria-invalid={!dobValid}
              aria-describedby={!dobValid && dobError ? `edit-member-${member.id}-dob-error` : undefined}
            />
            {!dobValid && dobError && (
              <span id={`edit-member-${member.id}-dob-error`} className="text-xs text-red-600">{dobError}</span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Education stage
            <select
              value={educationStage ?? ""}
              onChange={(e) =>
                setEducationStage(e.target.value ? (e.target.value as FamilyMember["educationStage"]) : null)
              }
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">None</option>
              {EducationStageSchema.options.map((stage) => (
                <option key={stage} value={stage}>
                  {stage.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Institution
            <input
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Course / Stream
            <input
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Expected completion year
            <input
              type="number"
              value={expectedYear}
              onChange={(e) => setExpectedYear(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              min="1950"
              max="2100"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            rows={2}
          />
        </label>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={!dobValid}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Save
          </button>
          <button onClick={onCancelEdit} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600">
            Cancel
          </button>
        </div>
      </li>
    );
  }

  const age = calculateAge(member.dateOfBirth);
  const ageDisplay = age !== null ? `Age ${age}` : null;
  const isChild = member.relationship === "child";

  return (
    <li className="py-3">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-slate-800">{member.name}</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {member.relationship.charAt(0).toUpperCase() + member.relationship.slice(1)}
            </span>
            {ageDisplay && <span className="text-xs text-slate-500">{ageDisplay}</span>}
          </div>
          {isChild && (member.educationStage || member.institution || member.courseOrStream) && (
            <div className="mt-1 space-y-0.5 text-xs text-slate-600">
              {member.educationStage && (
                <p>
                  <span className="text-slate-400">Education:</span>{" "}
                  {member.educationStage.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                </p>
              )}
              {member.institution && (
                <p>
                  <span className="text-slate-400">Institution:</span> {member.institution}
                </p>
              )}
              {member.courseOrStream && (
                <p>
                  <span className="text-slate-400">Course:</span> {member.courseOrStream}
                </p>
              )}
              {member.expectedCompletionYear && (
                <p>
                  <span className="text-slate-400">Expected completion:</span> {member.expectedCompletionYear}
                </p>
              )}
            </div>
          )}
          {member.notes && (
            <p className="mt-1 text-xs text-slate-500">{member.notes}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onEdit} className="text-xs text-brand-600 underline">
            Edit
          </button>
          <button onClick={onDelete} className="text-xs text-red-500 underline">
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}
