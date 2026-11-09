type Covers<T, Named> = [T] extends [Named] ? unknown : { missing: Exclude<T, Named> };

// A list that must name every member of the union `T` fails the typecheck when one
// is missing, and the error names it: a new variant can't skip a list that holds them all.
export function covering<T extends string>() {
  return {
    names: <const L extends readonly T[]>(list: L & Covers<T, L[number]>): L => list,
    // The member names sit at `K` in each entry: `.by<"id">()(entries)`.
    by:
      <K extends string>() =>
      <const L extends readonly Record<K, T>[]>(list: L & Covers<T, L[number][K]>): L =>
        list,
  };
}
