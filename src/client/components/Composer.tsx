import { useRef, useState } from "react";
import type { WorkspaceMember } from "../../shared/protocol";
import { btn, cn, meta, textarea } from "../ui/primitives";
import { useMentionSuggestions } from "../ui/useMentionSuggestions";
import { MentionSuggestions } from "../ui/MentionSuggestions";

/** Minimal text composer: a textarea + submit button, clears on send. */
export function Composer({
  placeholder,
  buttonLabel,
  onSubmit,
  disabled,
  disabledHint,
  members,
}: {
  placeholder: string;
  buttonLabel: string;
  onSubmit: (text: string) => void;
  disabled?: boolean;
  disabledHint?: string;
  /** When provided, typing "@" offers these workspace members as mention suggestions. */
  members?: WorkspaceMember[];
}) {
  const [text, setText] = useState("");
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const mention = useMentionSuggestions(text, setText, members ?? [], fieldRef);

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
        ref={fieldRef}
        className={textarea}
        value={text}
        placeholder={members ? `${placeholder} (type @ to mention someone)` : placeholder}
        rows={2}
        onChange={mention.onFieldChange}
        onKeyUp={mention.onFieldKeyUp}
        onKeyDown={(e) => {
          if (mention.onFieldKeyDown(e)) return;
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
      />
      {members && (
        <MentionSuggestions
          open={mention.open}
          triggerRef={fieldRef}
          suggestions={mention.suggestions}
          activeIndex={mention.activeIndex}
          onPick={mention.insert}
          onClose={mention.close}
        />
      )}
      <button className={cn(btn("primary"), "self-start")} disabled={!text.trim()} onClick={submit}>
        {buttonLabel}
      </button>
    </div>
  );
}
