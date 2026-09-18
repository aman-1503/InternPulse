import { useState } from "react";
import { btn, cn, meta, textarea } from "../ui/primitives";

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
    return <p className={meta}>{disabledHint ?? "Your role can't post here."}</p>;
  }

  const submit = () => {
    if (!text.trim()) return;
    onSubmit(text.trim());
    setText("");
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        className={textarea}
        value={text}
        placeholder={placeholder}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
      />
      <button className={cn(btn("primary"), "self-start")} disabled={!text.trim()} onClick={submit}>
        {buttonLabel}
      </button>
    </div>
  );
}
