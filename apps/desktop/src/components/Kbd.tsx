export function Keys({ label }: { label: readonly string[] }) {
  return (
    <span className="flex shrink-0 gap-1">
      {label.map((key) => (
        <kbd
          key={key}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line bg-surface px-1 text-mono text-ink-muted"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
