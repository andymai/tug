import { useState } from "react";

interface State {
  text: string;
  // The saved value the text last followed.
  base: string;
  edits: number;
  // `edits` when the last save started; -1 after it failed, so the text stays.
  committed: number;
  // The last save, and the text it sent.
  save: number;
  sent: string;
}

export interface Save {
  // Tug's answer (it may clean the value up): the field takes it unless the person
  // typed something else since the save started.
  saved: (answer: string) => void;
  // The text stays as typed and stops following the saved value.
  failed: () => void;
}

export interface Draft {
  text: string;
  edit: (text: string) => void;
  // Call as a save of `text` starts; every count changes in one update, so an edit
  // in the same batch can't split them.
  commit: () => Save;
}

let saves = 0;

// A field's text for a value that Tug saves. It follows the saved value until the
// person types, and again after a save, unless they typed since the save started:
// a late answer never overwrites a newer edit.
export function useDraft(saved: string): Draft {
  const [state, setState] = useState<State>({ text: saved, base: saved, edits: 0, committed: 0, save: 0, sent: saved });
  if (saved !== state.base) {
    setState((s) => (s.base === saved ? s : { ...s, base: saved, text: s.edits === s.committed ? saved : s.text }));
  }
  return {
    text: state.text,
    edit: (text) => {
      setState((s) => ({ ...s, text, edits: s.edits + 1 }));
    },
    commit: () => {
      const save = ++saves;
      setState((s) => ({ ...s, committed: s.edits, save, sent: s.text }));
      return {
        saved: (answer) => {
          setState((s) => (s.save === save && (s.edits === s.committed || s.text === s.sent) ? { ...s, text: answer, committed: s.edits } : s));
        },
        failed: () => {
          setState((s) => (s.save === save ? { ...s, committed: -1 } : s));
        },
      };
    },
  };
}
