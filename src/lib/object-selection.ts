// Selecting objects on a page: one page at a time, any number of "units". A
// unit is what one click selects: a plain object, or a whole group (its
// outermost group). Grouping is stored on the objects themselves (`groups`,
// outermost first), so a page's object list stays the single source of the
// layer order, and the saved PDF never sees groups. No DOM here.
import { bounds, describe, type Annotation, type Rect } from './annotations';
import { rectsOverlap } from './image-geometry';

export interface ObjectSelection {
  pageId: string;
  /** Selected units (object ids or group ids), in the order they were selected. */
  ids: readonly string[];
}

export const GROUP_PREFIX = 'group-';
export const isGroupId = (id: string) => id.startsWith(GROUP_PREFIX);

/** The unit an object belongs to: its outermost group, or itself. */
export function unitOf(a: Annotation): string {
  return a.groups?.[0] ?? a.id;
}

/** The page's units, bottom first (a group where its first object is; groups are kept together). */
export function unitsIn(list: readonly Annotation[]): string[] {
  return [...new Set(list.map(unitOf))];
}

/** The objects of the given units, bottom first. */
export function membersOf(list: readonly Annotation[], ids: Iterable<string>): Annotation[] {
  const set = new Set(ids);
  return list.filter((a) => set.has(unitOf(a)));
}

export type ToggleResult = { selection: ObjectSelection | null } | { otherPage: true };

/**
 * Shift (or Cmd/Ctrl) + click: add the unit to the selection, or take it out.
 * Only on one page: a unit on another page leaves the selection as it is.
 */
export function toggleUnit(sel: ObjectSelection | null, pageId: string, id: string): ToggleResult {
  if (!sel || sel.ids.length === 0) return { selection: { pageId, ids: [id] } };
  if (sel.pageId !== pageId) return { otherPage: true };
  const ids = sel.ids.includes(id) ? sel.ids.filter((x) => x !== id) : [...sel.ids, id];
  return { selection: ids.length ? { pageId, ids } : null };
}

/** The units with an object touching the rectangle (PDF space), bottom first. */
export function unitsTouching(list: readonly Annotation[], r: Rect): string[] {
  return unitsIn(list.filter((a) => rectsOverlap(bounds(a), r)));
}

/** Add units to a selection (Shift+drag), keeping the ones already there first. */
export function addUnits(sel: ObjectSelection | null, pageId: string, ids: readonly string[]): ObjectSelection | null {
  const base = sel && sel.pageId === pageId ? sel.ids : [];
  const all = [...base, ...ids.filter((id) => !base.includes(id))];
  return all.length ? { pageId, ids: all } : null;
}

/** The rectangle around objects (PDF space). */
export function unionBounds(members: readonly Annotation[]): Rect | null {
  if (!members.length) return null;
  const rs = members.map(bounds);
  return [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))];
}

/** How far a move may go so that the whole rectangle stays on the page (when it fits at all). */
export function clampDelta(box: Rect, page: Rect, dx: number, dy: number): [number, number] {
  const fit = (lo: number, hi: number, pLo: number, pHi: number, d: number) => (hi - lo > pHi - pLo ? d : Math.min(Math.max(d, pLo - lo), pHi - hi));
  return [fit(box[0], box[2], page[0], page[2], dx), fit(box[1], box[3], page[1], page[3], dy)];
}

/** How many objects a group holds (nested groups count their objects). */
export function groupSize(list: readonly Annotation[], groupId: string) {
  return list.filter((a) => a.groups?.includes(groupId)).length;
}

/**
 * Words for a selection, as used in undo labels and announcements: "text",
 * "group (3 objects)", "3 objects". `capital` for the start of a sentence.
 */
export function describeUnits(list: readonly Annotation[], ids: readonly string[], capital = false): string {
  let s: string;
  if (ids.length === 1 && isGroupId(ids[0])) s = `group (${groupSize(list, ids[0])} objects)`;
  else if (ids.length === 1) {
    const a = list.find((x) => x.id === ids[0]);
    s = a ? describe(a).toLowerCase() : 'object';
  } else s = `${ids.length} objects`;
  return capital ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Copies of objects with new ids; groups among them become new groups (the same new id for each copied group). */
export function copyWithNewIds(members: readonly Annotation[], newId: () => string): Annotation[] {
  const groups = new Map<string, string>();
  const groupId = (g: string) => {
    if (!groups.has(g)) groups.set(g, `${GROUP_PREFIX}${newId()}`);
    return groups.get(g)!;
  };
  return members.map((a) => ({ ...a, id: newId(), ...(a.groups ? { groups: a.groups.map(groupId) } : {}) }));
}

// --- Groups ----------------------------------------------------------------------------------

/**
 * Group units (objects or groups: groups nest) into a new group. Their objects
 * move together in the layer order, to where the topmost of them was, keeping
 * their order among themselves. Returns the list unchanged for fewer than two.
 */
export function groupUnits(list: readonly Annotation[], ids: readonly string[], groupId: string): readonly Annotation[] {
  const sel = new Set(ids);
  const units = unitsIn(list);
  if (units.filter((u) => sel.has(u)).length < 2) return list;
  const topIndex = Math.max(...units.map((u, i) => (sel.has(u) ? i : -1)));
  // Unselected units below the topmost selected one stay below the group.
  const below = units.slice(0, topIndex).filter((u) => !sel.has(u));
  const above = units.slice(topIndex + 1);
  const block = units.filter((u) => sel.has(u));
  const tagged = (u: string) => membersOf(list, [u]).map((a) => ({ ...a, groups: [groupId, ...(a.groups ?? [])] }));
  return [...below.flatMap((u) => membersOf(list, [u])), ...block.flatMap(tagged), ...above.flatMap((u) => membersOf(list, [u]))];
}

/**
 * Remove one level of grouping from these groups: their objects (and the
 * groups inside, which stay intact) become units of their own, in the same
 * places and order. Returns the new list and the former children's units.
 */
export function ungroupUnits(list: readonly Annotation[], groupIds: readonly string[]): { list: readonly Annotation[]; children: string[] } {
  const sel = new Set(groupIds.filter(isGroupId));
  const next = list.map((a) => {
    if (!a.groups || !sel.has(a.groups[0])) return a;
    const rest = a.groups.slice(1);
    const { groups: _g, ...plain } = a;
    return (rest.length ? { ...a, groups: rest } : plain) as Annotation;
  });
  const children = unitsIn(next.filter((a, i) => list[i].groups && sel.has(list[i].groups![0])));
  return { list: next, children };
}
