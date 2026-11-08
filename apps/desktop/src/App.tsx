import markDark from "../../../brand/svg/mark-dark.svg";
import mark from "../../../brand/svg/mark.svg";

export function App() {
  return (
    <main className="flex h-full items-center justify-center bg-bg">
      <section aria-labelledby="empty-title" className="flex max-w-sm flex-col items-center gap-3 text-center">
        <picture>
          <source srcSet={markDark} media="(prefers-color-scheme: dark)" />
          <img src={mark} alt="" width={40} height={42} />
        </picture>
        <h1 id="empty-title" className="text-heading text-ink">
          Nothing downloading
        </h1>
        <p className="text-body text-ink-muted">Paste a link or drop a file here.</p>
      </section>
    </main>
  );
}
