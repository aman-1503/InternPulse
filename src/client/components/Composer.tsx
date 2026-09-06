import { useState } from "react";

/** Minimal text composer: a textarea + submit button, clears on send. */
export function Composer({
  placeholder,
  buttonLabel,
  onSubmit,
  disabled,
  disabledHint,
}: {
  placeholder: string;
  buttonLabel: string;
  onSubmit: (text: string) => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const [text, setText] = useState("");

  if (disabled) {
    return <p className="meta">{disabledHint ?? "Your role can't post here."}</p>;
  }

  return (
    <div className="composer">
      <textarea
        value={text}
        placeholder={placeholder}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim()) {
            onSubmit(text.trim());
            setText("");
          }
        }}
      />
      <button
        className="primary"
        disabled={!text.trim()}
        onClick={() => {
          onSubmit(text.trim());
          setText("");
        }}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
