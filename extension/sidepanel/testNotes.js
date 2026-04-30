const TEST_NOTES_KEY = "jobtrack_phase_31_test_notes_v1";

export const TEST_NOTE_TYPES = [
  "Bug",
  "New field/category idea",
  "General test case",
  "UI issue",
  "Autofill mismatch",
];

export const TEST_NOTE_AREAS = [
  "Detection",
  "Field matching",
  "Filling",
  "Custom select",
  "Side panel UI",
  "Profile value",
  "Platform-specific",
];

export async function saveTestNote({ type, area, fieldLabel, note, tab }) {
  const cleanNote = String(note || "").trim();

  if (!cleanNote) {
    throw new Error("Write a note first.");
  }

  const entry = {
    id: `note_${Date.now()}`,
    createdAt: new Date().toISOString(),
    type: type || "Bug",
    area: area || "Filling",
    fieldLabel: String(fieldLabel || "").trim(),
    note: cleanNote,
    url: tab?.url || "",
    title: tab?.title || "",
  };

  const existing = await chrome.storage.local.get(TEST_NOTES_KEY);
  const notes = Array.isArray(existing[TEST_NOTES_KEY])
    ? existing[TEST_NOTES_KEY]
    : [];

  notes.unshift(entry);

  await chrome.storage.local.set({
    [TEST_NOTES_KEY]: notes.slice(0, 200),
  });

  return entry;
}

export async function getTestNotes() {
  const existing = await chrome.storage.local.get(TEST_NOTES_KEY);

  return Array.isArray(existing[TEST_NOTES_KEY])
    ? existing[TEST_NOTES_KEY]
    : [];
}

export async function copyAllTestNotes() {
  const notes = await getTestNotes();

  if (!notes.length) {
    throw new Error("No saved notes yet.");
  }

  const text = notes
    .map((note, index) => {
      return [
        `#${index + 1} ${note.type} - ${note.area}`,
        `Created: ${note.createdAt}`,
        `Field: ${note.fieldLabel || "N/A"}`,
        `Page: ${note.title || "N/A"}`,
        `URL: ${note.url || "N/A"}`,
        `Note: ${note.note}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  await navigator.clipboard.writeText(text);

  return notes.length;
}

export async function clearTestNotes() {
  await chrome.storage.local.set({
    [TEST_NOTES_KEY]: [],
  });
}