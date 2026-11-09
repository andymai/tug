import { useState } from "react";

interface State {
  text: string;
  // The saved value the text last followed.
  base: string;
  // Keystrokes so far, and the count when the last save started.
  edits: number;
  committed: number;
}

export interface Draft {
  text: string;
  edit: (text: string) => void;
  // Call as a save of `text` starts. The answer it returns takes the saved value
  // (Tug may clean it up) only if nobody typed since the save started.
  commit: () => (answer: string) => void;
}

// A field's text for a value that Tug saves. It follows the saved value until the
// person types, and again after a save, unless they typed since the save started:
// a late answer never overwrites a newer edit.
export function useDraft(saved: string): Draft {
  const [state, setState] = useState<State>({ text: saved, base: saved, edits: 0, committed: 0 });
  let now = state;
  if (saved !== state.base) {
    now = { ...state, base: saved, text: state.edits === state.committed ? saved : state.text };
    setState(now);
  }
  return {
    text: now.text,
    edit: (text) => {
      setState((s) => ({ ...s, text, edits: s.edits + 1 }));
    },
    commit: () => {
      const mark = now.edits;
      setState((s) => ({ ...s, committed: s.edits }));
      return (answer) => {
        setState((s) => (s.edits === mark ? { ...s, text: answer } : s));
      };
    },
  };
}
