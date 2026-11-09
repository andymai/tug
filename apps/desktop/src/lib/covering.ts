type Covers<T, Named> = [T] extends [Named] ? unknown : { missing: Exclude<T, Named> };

type Repeated<L extends readonly unknown[], Seen = never> = L extends readonly [infer Head, ...infer Rest]
  ? [Head] extends [Seen]
    ? Head
    : Repeated<Rest, Seen | Head>
  : never;
type Once<L extends readonly unknown[]> = [Repeated<L>] extends [never] ? unknown : { repeated: Repeated<L> };
type At<L extends readonly unknown[], K extends string> = { [I in keyof L]: L[I] extends Record<K, infer V> ? V : never };
// A typed array (`Color[]`) could hold anything, so only a written-out list counts.
type Written<L extends readonly unknown[]> = number extends L["length"] ? { notWrittenOut: true } : unknown;

// A list that must name every member of the union `T` once fails the typecheck when
// one is missing or repeated, and the error names it: a new variant can't skip a list
// that holds them all.
export function covering<T extends string>() {
  return {
    names: <const L extends readonly T[]>(list: L & Written<L> & Covers<T, L[number]> & Once<L>): L => list,
    // The member names sit at `K` in each entry: `.by<"id">()(entries)`.
    by:
      <K extends string>() =>
      <const L extends readonly Record<K, T>[]>(list: L & Written<L> & Covers<T, L[number][K]> & Once<At<L, K>>): L =>
        list,
  };
}
