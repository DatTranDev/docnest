export type Run = { length: number; mask: number };
type Leaf =
  | { kind: 'uniform'; mask: number }
  | { kind: 'runs'; runs: Uint16Array }
  | { kind: 'dense'; planes: readonly Uint32Array[] };
export type StyleNode = {
  length: number;
  height: number;
  andMask: number;
  orMask: number;
  a: number;
  o: number;
  leaf?: Leaf;
  children?: readonly StyleNode[];
};
const transform = (m: number, a: number, o: number) => (m & a) | o;
function leaf(length: number, data: Leaf, andMask: number, orMask: number): StyleNode {
  return { length, height: 0, andMask, orMask, a: 7, o: 0, leaf: data };
}
function branch(children: readonly StyleNode[]): StyleNode {
  return {
    length: children.reduce((n, c) => n + c.length, 0),
    height: children[0]!.height + 1,
    andMask: children.reduce((m, c) => m & c.andMask, 7),
    orMask: children.reduce((m, c) => m | c.orMask, 0),
    a: 7,
    o: 0,
    children,
  };
}
function tagged(n: StyleNode, a: number, o: number): StyleNode {
  return {
    ...n,
    a: n.a & a,
    o: (n.o & a) | o,
    andMask: transform(n.andMask, a, o),
    orMask: transform(n.orMask, a, o),
  };
}
function children(n: StyleNode): readonly StyleNode[] {
  return n.children!.map((c) => tagged(c, n.a, n.o));
}
function root(n: StyleNode): StyleNode {
  while (n.children?.length === 1) n = children(n)[0]!;
  return n;
}
function join(a: StyleNode | undefined, b: StyleNode | undefined): StyleNode | undefined {
  if (!a?.length) return b;
  if (!b?.length) return a;
  if (a.andMask === a.orMask && b.andMask === b.orMask && a.orMask === b.orMask)
    return leaf(a.length + b.length, { kind: 'uniform', mask: a.orMask }, a.orMask, a.orMask);
  if (a.height === b.height) {
    if (!a.height) return branch([a, b]);
    const cs = [...children(a), ...children(b)];
    return cs.length <= 32 ? branch(cs) : branch([a, b]);
  }
  if (a.height > b.height) {
    const cs = [...children(a)],
      last = cs.pop()!;
    const j = join(last, b)!;
    if (j.height === last.height) cs.push(j);
    else cs.push(...children(j));
    return cs.length <= 32 ? branch(cs) : branch([branch(cs.slice(0, 16)), branch(cs.slice(16))]);
  }
  const cs = [...children(b)],
    first = cs.shift()!;
  const j = join(a, first)!;
  if (j.height === first.height) cs.unshift(j);
  else cs.unshift(...children(j));
  return cs.length <= 32 ? branch(cs) : branch([branch(cs.slice(0, 16)), branch(cs.slice(16))]);
}
function at(n: StyleNode, i: number): number {
  let m: number;
  if (n.children) {
    for (const c of n.children) {
      if (i < c.length) return transform(at(c, i), n.a, n.o);
      i -= c.length;
    }
    throw new RangeError('style offset');
  }
  const l = n.leaf!;
  if (l.kind === 'uniform') m = l.mask;
  else if (l.kind === 'runs') {
    m = l.runs[runIndex(l.runs, i)]! & 7;
  } else m = l.planes.reduce((v, p, k) => v | (((p[i >>> 5]! >>> (i & 31)) & 1) << k), 0);
  return transform(m, n.a, n.o);
}
function runIndex(runs: Uint16Array, offset: number): number {
  let low = 0,
    high = runs.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (runs[mid]! >>> 3 <= offset) low = mid + 1;
    else high = mid;
  }
  return low;
}
function makeRuns(runs: readonly Run[]): StyleNode | undefined {
  const normalized: Run[] = [];
  for (const r of runs) {
    if (!r.length) continue;
    if (!Number.isInteger(r.length) || r.length < 0 || r.mask < 0 || r.mask > 7)
      throw new RangeError('invalid style run');
    const p = normalized.at(-1);
    if (p?.mask === r.mask) p.length += r.length;
    else normalized.push({ ...r });
  }
  if (!normalized.length) return undefined;
  const length = normalized.reduce((n, r) => n + r.length, 0);
  if (normalized.length === 1)
    return leaf(
      length,
      { kind: 'uniform', mask: normalized[0]!.mask },
      normalized[0]!.mask,
      normalized[0]!.mask,
    );
  if (length > 4096) {
    let result: StyleNode | undefined;
    let chunk: Run[] = [];
    let size = 0;
    for (const r of normalized) {
      let left = r.length;
      while (left) {
        const take = Math.min(left, 4096 - size);
        chunk.push({ length: take, mask: r.mask });
        size += take;
        left -= take;
        if (size === 4096) {
          result = join(result, makeRuns(chunk));
          chunk = [];
          size = 0;
        }
      }
    }
    return join(result, makeRuns(chunk));
  }
  const andMask = normalized.reduce((m, r) => m & r.mask, 7),
    orMask = normalized.reduce((m, r) => m | r.mask, 0);
  // Leaves cover at most 4096 units: cumulative end << 3 plus mask fits uint16.
  // Choose the in-memory byte cost; the codec independently chooses wire encoding.
  if (normalized.length * 2 <= 12 * Math.ceil(length / 32)) {
    let end = 0;
    const runs = Uint16Array.from(normalized, (r) => ((end += r.length) << 3) | r.mask);
    return leaf(length, { kind: 'runs', runs }, andMask, orMask);
  }
  const planes = [
    new Uint32Array(Math.ceil(length / 32)),
    new Uint32Array(Math.ceil(length / 32)),
    new Uint32Array(Math.ceil(length / 32)),
  ];
  let pos = 0;
  for (const r of normalized)
    for (let end = pos + r.length; pos < end; pos++)
      for (let k = 0; k < 3; k++) if (r.mask & (1 << k)) planes[k]![pos >>> 5]! |= 1 << (pos & 31);
  return leaf(length, { kind: 'dense', planes }, andMask, orMask);
}
function split(
  n: StyleNode | undefined,
  pos: number,
): [StyleNode | undefined, StyleNode | undefined] {
  if (!n) return [undefined, undefined];
  if (pos <= 0) return [undefined, n];
  if (pos >= n.length) return [n, undefined];
  if (n.children) {
    let left: StyleNode | undefined, right: StyleNode | undefined;
    for (const c of children(n)) {
      if (pos >= c.length) {
        left = join(left, c);
        pos -= c.length;
      } else if (pos > 0) {
        const [x, y] = split(c, pos);
        left = join(left, x);
        right = join(right, y);
        pos = 0;
      } else right = join(right, c);
    }
    return [left, right];
  }
  if (n.andMask === n.orMask)
    return [
      leaf(pos, { kind: 'uniform', mask: n.orMask }, n.orMask, n.orMask),
      leaf(n.length - pos, { kind: 'uniform', mask: n.orMask }, n.orMask, n.orMask),
    ];
  const l: Run[] = [],
    r: Run[] = [];
  for (const run of new StyleTree(n).queryRuns()) {
    if (run.from < pos) l.push({ length: Math.min(run.to, pos) - run.from, mask: run.mask });
    if (run.to > pos) r.push({ length: run.to - Math.max(run.from, pos), mask: run.mask });
  }
  return [makeRuns(l), makeRuns(r)];
}
function* visibleRuns(
  node: StyleNode,
  offset: number,
  from: number,
  to: number,
  inheritedA: number,
  inheritedO: number,
): Generator<{ from: number; to: number; mask: number }> {
  const start = Math.max(from, offset),
    end = Math.min(to, offset + node.length);
  if (start >= end) return;
  const andMask = transform(node.andMask, inheritedA, inheritedO),
    orMask = transform(node.orMask, inheritedA, inheritedO);
  if (andMask === orMask) {
    yield { from: start, to: end, mask: orMask };
    return;
  }
  const a = node.a & inheritedA,
    o = (node.o & inheritedA) | inheritedO;
  if (node.children) {
    for (const child of node.children) {
      if (offset >= end) break;
      if (offset + child.length > start) yield* visibleRuns(child, offset, start, end, a, o);
      offset += child.length;
    }
    return;
  }
  const leaf = node.leaf!;
  if (leaf.kind === 'runs') {
    let pos = start;
    for (let i = runIndex(leaf.runs, start - offset); pos < end; i++) {
      const word = leaf.runs[i]!,
        next = Math.min(end, offset + (word >>> 3));
      yield { from: pos, to: next, mask: transform(word & 7, a, o) };
      pos = next;
    }
  } else if (leaf.kind === 'dense') {
    const [bold, italic, underline] = leaf.planes;
    let begin = start,
      prior = -1;
    for (let pos = start; pos < end; pos++) {
      const i = pos - offset,
        word = i >>> 5,
        bit = i & 31;
      const mask = transform(
        ((bold![word]! >>> bit) & 1) |
          (((italic![word]! >>> bit) & 1) << 1) |
          (((underline![word]! >>> bit) & 1) << 2),
        a,
        o,
      );
      if (mask !== prior) {
        if (prior >= 0) yield { from: begin, to: pos, mask: prior };
        begin = pos;
        prior = mask;
      }
    }
    yield { from: begin, to: end, mask: prior };
  }
}
export class StyleTree {
  constructor(readonly node?: StyleNode) {}
  static uniform(length: number, mask = 0): StyleTree {
    if (length < 0 || !Number.isInteger(length) || !Number.isInteger(mask) || mask < 0 || mask > 7)
      throw new RangeError('invalid style');
    return new StyleTree(length ? leaf(length, { kind: 'uniform', mask }, mask, mask) : undefined);
  }
  static fromRuns(runs: readonly Run[]): StyleTree {
    return new StyleTree(makeRuns(runs));
  }
  static fromDense(length: number, planes: readonly Uint32Array[]): StyleTree {
    if (
      length < 1 ||
      planes.length !== 3 ||
      planes.some((p) => p.length !== Math.ceil(length / 32))
    )
      throw new Error('INVALID_DENSE');
    let result: StyleNode | undefined;
    for (let start = 0; start < length; start += 4096) {
      const n = Math.min(4096, length - start),
        slice = planes.map((p) => p.slice(start / 32, start / 32 + Math.ceil(n / 32)));
      let andMask = 0,
        orMask = 0;
      for (let bit = 0; bit < 3; bit++) {
        let all = true,
          any = false;
        const p = slice[bit]!;
        for (let w = 0; w < p.length; w++) {
          const active = w === p.length - 1 && n % 32 ? 0xffffffff >>> (32 - (n % 32)) : 0xffffffff;
          any ||= !!p[w];
          all &&= p[w] === active;
        }
        if (all) andMask |= 1 << bit;
        if (any) orMask |= 1 << bit;
      }
      result = join(
        result,
        andMask === orMask
          ? leaf(n, { kind: 'uniform', mask: orMask }, orMask, orMask)
          : leaf(n, { kind: 'dense', planes: slice }, andMask, orMask),
      );
    }
    return new StyleTree(result && root(result));
  }
  get length(): number {
    return this.node?.length ?? 0;
  }
  maskAt(i: number): number {
    if (i < 0 || i >= this.length) throw new RangeError('style offset');
    return at(this.node!, i);
  }
  slice(from: number, to = this.length): StyleTree {
    this.range(from, to);
    const [, tail] = split(this.node, from);
    const [part] = split(tail, to - from);
    return new StyleTree(part && root(part));
  }
  concat(other: StyleTree): StyleTree {
    const n = join(this.node, other.node);
    return new StyleTree(n && root(n));
  }
  replace(from: number, to: number, withTree: StyleTree): StyleTree {
    this.range(from, to);
    const [head, tail] = split(this.node, from);
    const [, last] = split(tail, to - from);
    const n = join(join(head, withTree.node), last);
    return new StyleTree(n && root(n));
  }
  applyBit(from: number, to: number, bit: number, mode: 'set' | 'clear' | 'toggle'): StyleTree {
    this.range(from, to);
    if (![1, 2, 4].includes(bit)) throw new RangeError('style bit');
    if (from === to) return this;
    const mid = this.slice(from, to),
      clear = mode === 'clear' || (mode === 'toggle' && !!(mid.node!.andMask & bit));
    return this.replace(
      from,
      to,
      new StyleTree(tagged(mid.node!, clear ? 7 ^ bit : 7, clear ? 0 : bit)),
    );
  }
  *queryRuns(from = 0, to = this.length): Generator<{ from: number; to: number; mask: number }> {
    this.range(from, to);
    if (!this.node || from === to) return;
    let pending: { from: number; to: number; mask: number } | undefined;
    for (const run of visibleRuns(this.node, 0, from, to, 7, 0)) {
      if (pending?.mask === run.mask) pending.to = run.to;
      else {
        if (pending) yield pending;
        pending = run;
      }
    }
    if (pending) yield pending;
  }
  *leaves(): Generator<StyleNode> {
    function* visit(n: StyleNode): Generator<StyleNode> {
      if (n.children) for (const c of children(n)) yield* visit(c);
      else yield n;
    }
    if (this.node) yield* visit(this.node);
  }
  private range(a: number, b: number): void {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a || b > this.length)
      throw new RangeError('style range');
  }
}
