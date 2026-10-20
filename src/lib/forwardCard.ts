import { isForwardedMessageMarker } from "./forwardMarkers";

/**
 * Rebuild a quoted message into a card, inside the reader.
 *
 * Mail clients flatten a forwarded or quoted message into a run of lines — a
 * divider, then `From:` / `Sent:` / `Subject:` lines, then the body. Read as
 * plain paragraphs the divider is just another line of text, so a forwarded
 * message looks exactly like the prose above it. The composer already rebuilds
 * the hierarchy when *writing* a forward; this module does the same honour for
 * mail that arrives from somewhere else.
 *
 * Two shapes are recognised:
 *
 * 1. an explicit divider (`---------- 转发邮件 ----------`, `Begin forwarded
 *    message:`) — labelled as a forward;
 * 2. a horizontal rule followed by a header block — Outlook uses this for both
 *    forwards and replies and never says which, so it is labelled as a quoted
 *    message rather than guessing.
 *
 * The transform works on live DOM after sanitisation: the divider and the
 * header lines are lifted into `.pebble-forward-card__header`, everything
 * after them becomes `.pebble-forward-card__body`, and any card already
 * sitting in that body is pushed one level down into
 * `.pebble-forward-history` so a chain of quotes never shows two hops at the
 * same weight.
 */

/** Copy the reader needs to label a rebuilt card. */
export interface ForwardCardLabels {
  /** Badge on an explicit forward, e.g. "Forwarded message". */
  badge: string;
  /** Badge on a rule-plus-header block, e.g. "Quoted message". */
  quoted: string;
  /** Label above an older card nested inside it, e.g. "Earlier message". */
  history: string;
  from: string;
  date: string;
  to: string;
  cc: string;
}

type HeaderField = "from" | "date" | "to" | "cc" | "subject";

interface ParsedHeader {
  field: HeaderField;
  /** Characters to drop from the line to remove "From: " and its variants. */
  prefixLength: number;
}

interface BlockSpec {
  kind: "forward" | "quote";
  /**
   * Where the card replaces the block: the divider line, or the rule above a
   * quote header.
   */
  anchor: Element;
  /**
   * Quote blocks: the wrapper that owns the whole block — the header lines and
   * nothing else. Everything inside it becomes the card header, everything
   * after it the card body.
   */
  container?: Element;
}

const HEADER_ALIASES: Array<{ field: HeaderField; aliases: string[] }> = [
  { field: "from", aliases: ["from", "sender", "发件人", "寄件人", "寄件者", "寄件地址"] },
  {
    field: "date",
    aliases: ["date", "sent", "日期", "时间", "发送时间", "傳送時間", "寄件日期", "日期时间"],
  },
  { field: "to", aliases: ["to", "收件人", "收件者", "收件地址"] },
  { field: "cc", aliases: ["cc", "抄送", "抄送人", "副本", "副本抄送"] },
  { field: "subject", aliases: ["subject", "主题", "主題", "标题", "標題", "邮件主题"] },
];

const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "CENTER", "DD", "DIV", "DL", "DT",
  "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4",
  "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION",
  "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
]);

// Inline wrappers are only interesting as a way *into* a block; `p` and `div`
// are what a divider line actually sits in.
const TABLE_STRUCTURE = new Set(["TABLE", "TBODY", "THEAD", "TFOOT", "TR", "TD", "TH"]);

const CANDIDATE_SELECTOR = [
  "p", "div", "span", "font", "b", "strong", "em", "i", "u", "li",
  "td", "th", "blockquote", "section", "article", "center",
  "h1", "h2", "h3", "h4", "h5", "h6",
].join(", ");

function textOf(node: Node): string {
  return (node.textContent ?? "").replace(/\u00a0/g, " ");
}

/**
 * A header block is a handful of short lines. Anything this long is a body,
 * and copying it to look for `<br>`s is the one thing that made this module
 * slow on messages with thousands of nodes.
 */
const MAX_HEADER_TEXT = 3000;

function headerSized(element: Element): boolean {
  const length = element.textContent?.length ?? 0;
  return length > 0 && length <= MAX_HEADER_TEXT;
}

/** Whitespace, `<br>` and `&nbsp;` lines carry no meaning between two fields. */
function isBlank(node: Node): boolean {
  // `trim` already treats `&nbsp;` as whitespace; no need to rewrite the text.
  if ((node.textContent ?? "").trim() !== "") return false;
  return !(node instanceof Element && node.querySelector("img"));
}

function isBlock(element: Element): boolean {
  return BLOCK_TAGS.has(element.tagName);
}

/**
 * The element that behaves as one line in the message's own layout.
 *
 * A divider is often `<p><b>------ 转发邮件 ------</b></p>`; the paragraph is
 * the unit that owns the following siblings, not the `<b>` inside it.
 */
function blockOf(element: Element, root: Element): Element {
  let current = element;
  while (!isBlock(current) && current.parentElement && current.parentElement !== root) {
    current = current.parentElement;
  }
  return current;
}

function parseHeaderLine(text: string): ParsedHeader | null {
  // A label is short and ends at the first colon; a sentence that happens to
  // contain one ("Re: the thing we discussed, from: memory") must not qualify.
  const match = text.match(/^\s*([^:：]{1,14})\s*[:：]\s*/);
  if (!match) return null;

  const key = match[1].replace(/\s+/g, " ").trim().toLowerCase();
  const known = HEADER_ALIASES.find((entry) => entry.aliases.includes(key));
  if (!known) return null;

  return { field: known.field, prefixLength: match[0].length };
}

/** Drop `count` characters from the front of a subtree's text, across nodes. */
function stripLeadingCharacters(root: Node, count: number): void {
  if (count <= 0) return;
  const doc = root.ownerDocument;
  if (!doc) return;

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = count;
  let text = walker.nextNode() as Text | null;
  while (text && remaining > 0) {
    const value = text.data;
    if (value.length <= remaining) {
      remaining -= value.length;
      text.data = "";
    } else {
      text.data = value.slice(remaining);
      remaining = 0;
    }
    text = walker.nextNode() as Text | null;
  }
}

/**
 * Move a header line's value into the card row, dropping the "From: " prefix
 * but keeping `<a>` and `<b>` so an address stays clickable and a name stays
 * emphasised. The message's own inline colours are dropped: the card decides
 * the typography, and a `font color="#000000"` from the sender would win over
 * the card's muted label colour.
 */
function moveHeaderValue(source: Element, target: Element, prefixLength: number): void {
  for (const child of Array.from(source.childNodes)) target.appendChild(child);
  stripLeadingCharacters(target, prefixLength);
  // `<b>From:</b> x` leaves an empty `<b>` behind once the label is gone.
  target.querySelectorAll("b, strong, i, em, u, font, span").forEach((element) => {
    if ((element.textContent ?? "").trim() === "" && !element.querySelector("img")) {
      element.remove();
    }
  });

  target.removeAttribute("style");
  target.querySelectorAll("[style]").forEach((element) => element.removeAttribute("style"));
  target.querySelectorAll("font").forEach((font) => {
    font.removeAttribute("color");
    font.removeAttribute("face");
    font.removeAttribute("size");
  });

  // The last header line usually drags the block's spacer (`<div>&nbsp;</div>`)
  // or the trailing newline along; neither belongs to the value.
  while (target.firstChild && isBlank(target.firstChild)) target.removeChild(target.firstChild);
  while (target.lastChild && isBlank(target.lastChild)) target.removeChild(target.lastChild);
}

function hasBrLines(element: Element): boolean {
  return element.querySelector("br") !== null;
}

/**
 * Lift the inline wrappers that carry a `<br>` up to the header block itself.
 *
 * Word writes `<p><b><span>发件人</span></b><b><span>:</span></b><span>…<br>
 * <b>发件人</b>…</span></p>`, where the break sits several inline levels deep
 * and grouping direct children finds one long line instead of five.
 */
function prepareBrLines(element: Element): void {
  for (let guard = 0; guard < 24; guard += 1) {
    const nested = Array.from(element.querySelectorAll("br"))
      .find((br) => br.parentElement && br.parentElement !== element);
    if (!nested) return;

    const parent = nested.parentElement;
    const grand = parent?.parentNode;
    if (!parent || !grand) return;
    while (parent.firstChild) grand.insertBefore(parent.firstChild, parent);
    parent.remove();
  }
}

function brGroups(element: Element): Node[][] {
  const groups: Node[][] = [[]];
  for (const child of Array.from(element.childNodes)) {
    if (child instanceof Element && child.tagName === "BR") {
      groups.push([]);
      continue;
    }
    groups[groups.length - 1].push(child);
  }
  return groups;
}

function groupText(group: Node[]): string {
  return group.map(textOf).join("");
}

/** How many `<br>`-separated lines of this element read as header fields. */
function countHeaderLines(element: Element): number {
  if (!hasBrLines(element)) return parseHeaderLine(textOf(element)) ? 1 : 0;
  if (!headerSized(element)) return 0;

  // Counted on a copy: an element that turns out not to be a header block
  // must not be restructured by the probe.
  const probe = element.cloneNode(true) as Element;
  prepareBrLines(probe);
  return brGroups(probe).filter((group) => parseHeaderLine(groupText(group))).length;
}

/**
 * Split one element that carries several header lines separated by `<br>`.
 *
 * Gmail writes `---------- Forwarded message ---------<br>From: …<br>Date: …`
 * into a single `<div>`, where the sibling walk below sees one node and no
 * header at all. Only blocks that really hold header lines (or a divider) are
 * split, so ordinary prose with `<br>` is left alone.
 */
function expandBrSeparatedLines(node: Node, requireMarker = false): Node[] {
  if (!(node instanceof Element) || !hasBrLines(node)) return [node];
  if (!headerSized(node)) return [node];

  const element = node;
  const probe = element.cloneNode(true) as Element;
  prepareBrLines(probe);
  const probeGroups = brGroups(probe);
  if (probeGroups.length < 2) return [node];

  const hasMarker = probeGroups.some((group) => isForwardedMessageMarker(groupText(group)));
  const headerCount = probeGroups.filter((group) => parseHeaderLine(groupText(group))).length;
  // Outside a known forward block only an actual divider earns a split: two
  // lines that look like `Date:` are not enough reason to restructure a body.
  if (requireMarker ? !hasMarker : !hasMarker && headerCount < 2) return [node];

  const doc = element.ownerDocument;
  const parent = element.parentNode;
  if (!doc || !parent) return [node];

  prepareBrLines(element);
  const segments = lineElementsFrom(element, brGroups(element));

  const anchor = element.nextSibling;
  for (const line of segments) parent.insertBefore(line, anchor);

  element.remove();
  return segments;
}

/** One element per `<br>`-separated group, in order. */
function lineElementsFrom(element: Element, groups: Node[][]): Element[] {
  const doc = element.ownerDocument;
  if (!doc) return [];

  const lines: Element[] = [];
  for (const group of groups) {
    if (group.every((child) => isBlank(child))) continue;
    const line = doc.createElement("div");
    // Keep the wrapper's own presentation (font, indent, `dir`) on every line.
    for (const attribute of ["style", "dir", "align"]) {
      const value = element.getAttribute(attribute);
      if (value) line.setAttribute(attribute, value);
    }
    for (const child of group) line.appendChild(child);
    lines.push(line);
  }
  return lines;
}

function wrapInHistory(card: Element, doc: Document, label: string): void {
  const parent = card.parentNode;
  if (!parent) return;

  const wrapper = doc.createElement("div");
  wrapper.className = "pebble-forward-history";

  const labelElement = doc.createElement("span");
  labelElement.className = "pebble-forward-history__label";
  labelElement.textContent = label;

  parent.insertBefore(wrapper, card);
  wrapper.append(labelElement, card);
}

/**
 * Give a card that arrived already built the same header as a rebuilt one.
 *
 * A forward sent from Pebble writes its header as flat `From: …` rows
 * (`buildForwardMessageHtml`), while every card this module builds uses a
 * label/value pair. In a chain that mixes both — a Pebble forward quoting an
 * Outlook reply — the two layouts sit one above the other and the older one
 * reads as a different component, so the flat rows are parsed back into
 * fields. Rows that are not header fields, and rows already rebuilt, are left
 * exactly as they are.
 */
function normalizeCardRows(header: Element, labels: ForwardCardLabels): void {
  const doc = header.ownerDocument;
  const fieldLabels: Record<Exclude<HeaderField, "subject">, string> = {
    from: labels.from,
    date: labels.date,
    to: labels.to,
    cc: labels.cc,
  };

  for (const row of Array.from(header.children)) {
    if (!row.classList.contains("pebble-forward-card__meta")) continue;
    if (row.querySelector(".pebble-forward-card__meta-label")) continue;

    const parsed = parseHeaderLine(textOf(row));
    if (!parsed || parsed.field === "subject") continue;

    const label = doc.createElement("span");
    label.className = "pebble-forward-card__meta-label";
    label.textContent = fieldLabels[parsed.field];

    const value = doc.createElement("span");
    value.className = "pebble-forward-card__meta-value";
    moveHeaderValue(row, value, parsed.prefixLength);

    // A fresh row rather than the old one: the sender's inline
    // `font-size`/`color` would otherwise be written back over the card's
    // label styling by `reapplyInlineStyles`.
    const replacement = doc.createElement("div");
    replacement.className = "pebble-forward-card__meta";
    replacement.append(label, value);
    row.replaceWith(replacement);
  }
}

/** The first node after `start` that carries content, climbing out of wrappers. */
function nextContentNode(start: Node, root: Element): Node | null {
  let scope: Node = start;
  while (true) {
    let node = scope.nextSibling;
    while (node && isBlank(node)) node = node.nextSibling;
    if (node) return node;

    const parent = scope.parentNode;
    if (!parent || parent === root) return null;
    scope = parent;
  }
}

function hasOtherContent(parent: Element, child: Node): boolean {
  return Array.from(parent.childNodes).some((node) => node !== child && !isBlank(node));
}

/**
 * The element holding a rule-plus-header block, if `rule` is followed by one.
 *
 * Outlook writes the rule, then a `div` whose `<font>` holds
 * `From:<br>Sent:<br>To:<br>Subject:` — or, in Word-authored mail, a `<p>`
 * whose lines are separated by `<br>`s nested inside spans.
 */
function quoteHeaderHostAfter(rule: Element, root: Element): Element | null {
  const next = nextContentNode(rule, root);
  if (!next || !(next instanceof Element)) return null;

  if (countHeaderLines(next) >= 2) return next;

  // The same block written as one element per line: `From:` and friends as
  // consecutive siblings.
  if (!parseHeaderLine(textOf(next))) return null;
  let count = 1;
  let cursor: Node | null = nextContentNode(next, root);
  while (cursor && cursor instanceof Element && parseHeaderLine(textOf(cursor))) {
    count += 1;
    cursor = nextContentNode(cursor, root);
  }
  return count >= 2 ? next : null;
}

/**
 * The wrapper that owns the whole header block.
 *
 * Outlook nests the block twice — a `div` around a `<p>` — and the outer
 * wrapper is what the body follows; stopping at the `<p>` would leave the body
 * outside the card.
 */
function headerContainer(host: Element, root: Element): Element {
  let container = host;
  while (
    container.parentElement
    && container.parentElement !== root
    && !hasOtherContent(container.parentElement, container)
  ) {
    container = container.parentElement;
  }
  return container;
}

/**
 * Where the card can be inserted so that it sits beside the quoted block.
 *
 * The rule often lives in its own centred wrapper (`<div class="MsoNormal">`),
 * one level below the header block. Lift it while its wrapper holds nothing
 * else, and give up when the two would end up in different parents — a card
 * inserted in the wrong container would read as part of the prose above it.
 */
function anchorFor(rule: Element, container: Element): Element | null {
  const target = container.parentElement;
  if (!target) return null;

  let anchor = rule;
  while (anchor.parentNode !== target) {
    const parent = anchor.parentElement;
    if (!parent || parent === target || hasOtherContent(parent, anchor)) return null;
    anchor = parent;
  }
  return anchor;
}

/** Every block in the message that should become a card, in document order. */
function collectBlocks(root: Element): BlockSpec[] {
  const blocks: BlockSpec[] = [];

  for (const line of collectMarkerLines(root)) {
    blocks.push({ kind: "forward", anchor: line });
  }

  for (const rule of Array.from(root.querySelectorAll("hr"))) {
    const host = quoteHeaderHostAfter(rule, root);
    if (!host) continue;

    const container = headerContainer(host, root);
    if (container === root) continue;

    const anchor = anchorFor(rule, container);
    if (!anchor) continue;

    blocks.push({ kind: "quote", anchor, container });
  }

  return blocks.sort((a, b) => {
    const position = a.anchor.compareDocumentPosition(b.anchor);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

interface GatheredBlock {
  nodes: Node[];
  /** Elements that disappear with the block. */
  remove: Node[];
  /** Index of the first body line; anything before it is a header line. */
  firstIndex: number;
}

/** The block's lines, in order, plus the scaffolding to tear down afterwards. */
function gatherBlock(spec: BlockSpec, root: Element): GatheredBlock | null {
  const siblingsFrom = (start: Node | null): Node[] => {
    const nodes: Node[] = [];
    let node = start;
    while (node) {
      const next: Node | null = node.nextSibling;
      nodes.push(...expandBrSeparatedLines(node));
      node = next;
    }
    return nodes;
  };

  if (spec.kind === "forward") {
    return { nodes: siblingsFrom(spec.anchor), remove: [spec.anchor], firstIndex: 1 };
  }

  const container = spec.container;
  if (!container || container === root) return null;

  // Flatten the header block into one element per line so the sibling walk
  // below can tell a field from the body.
  if (hasBrLines(container)) {
    prepareBrLines(container);
    const lines = lineElementsFrom(container, brGroups(container));
    if (lines.length > 1) container.replaceChildren(...lines);
  }

  const nodes: Node[] = [];
  for (const child of Array.from(container.childNodes)) {
    nodes.push(...expandBrSeparatedLines(child));
  }
  nodes.push(...siblingsFrom(container.nextSibling));

  return { nodes, remove: [spec.anchor, container], firstIndex: 0 };
}

function buildCard(spec: BlockSpec, root: Element, labels: ForwardCardLabels): Element | null {
  const anchor = spec.anchor;
  const doc = anchor.ownerDocument;
  const parent = anchor.parentNode;
  if (!doc || !parent) return null;

  const gathered = gatherBlock(spec, root);
  if (!gathered) return null;
  const { nodes, remove, firstIndex } = gathered;
  if (nodes.length <= firstIndex) return null;

  const header = doc.createElement("div");
  header.className = "pebble-forward-card__header";

  const badge = doc.createElement("span");
  badge.className = "pebble-forward-badge";
  badge.textContent = spec.kind === "quote" ? labels.quoted : labels.badge;
  header.appendChild(badge);

  const fields: Array<{ field: HeaderField; node: Element; prefixLength: number }> = [];
  let cursor = firstIndex;
  let bodyStart = firstIndex;
  while (cursor < nodes.length) {
    const current = nodes[cursor];
    if (isBlank(current)) {
      cursor += 1;
      continue;
    }
    if (!(current instanceof Element)) break;

    const parsed = parseHeaderLine(textOf(current));
    if (!parsed) break;

    fields.push({ ...parsed, node: current });
    cursor += 1;
    bodyStart = cursor;
  }

  const fieldLabels: Record<Exclude<HeaderField, "subject">, string> = {
    from: labels.from,
    date: labels.date,
    to: labels.to,
    cc: labels.cc,
  };

  const subject = fields.find((field) => field.field === "subject");
  if (subject) {
    const subjectElement = doc.createElement("div");
    subjectElement.className = "pebble-forward-card__subject";
    moveHeaderValue(subject.node, subjectElement, subject.prefixLength);
    header.appendChild(subjectElement);
  }

  for (const field of fields) {
    if (field.field === "subject") continue;

    const row = doc.createElement("div");
    row.className = "pebble-forward-card__meta";

    const label = doc.createElement("span");
    label.className = "pebble-forward-card__meta-label";
    label.textContent = fieldLabels[field.field];
    row.appendChild(label);

    const value = doc.createElement("span");
    value.className = "pebble-forward-card__meta-value";
    moveHeaderValue(field.node, value, field.prefixLength);
    row.appendChild(value);

    header.appendChild(row);
  }

  const body = doc.createElement("div");
  body.className = "pebble-forward-card__body";
  for (const content of nodes.slice(bodyStart)) body.appendChild(content);

  const card = doc.createElement("div");
  card.className = "pebble-forward-card";
  card.append(header, body);

  // Insert before the scaffolding is torn down: the anchor is part of it.
  parent.insertBefore(card, anchor);
  for (const consumed of [...nodes.slice(0, bodyStart), ...remove]) {
    consumed.parentNode?.removeChild(consumed);
  }

  // A card already inside this body is an older hop in the chain.
  const nested = Array.from(body.querySelectorAll(".pebble-forward-card"))
    .filter((inner) => !inner.parentElement?.closest(".pebble-forward-history"));
  for (const inner of nested) wrapInHistory(inner, doc, labels.history);

  return card;
}

/**
 * `<br>`-separated forerunners, resolved before anything is matched.
 *
 * One `<div>` holding the divider and its header lines reads as a single long
 * line of text, which is neither a divider nor an extra sibling — so it has to
 * be broken up before the marker scan can see it.
 */
function expandBrForwardBlocks(root: Element): void {
  const holders = new Set<Element>();
  for (const rule of Array.from(root.querySelectorAll("br"))) {
    const parent = rule.parentElement;
    if (parent) holders.add(parent);
  }
  for (const holder of holders) {
    expandBrSeparatedLines(holder, true);
  }
}

function collectMarkerLines(root: Element): Element[] {
  const candidates = Array.from(root.querySelectorAll(CANDIDATE_SELECTOR));
  // `textContent` straight: the marker test normalises on its own, and most
  // candidates are rejected on length before any rewriting happens.
  const matches = candidates.filter(
    (element) => isForwardedMessageMarker(element.textContent ?? ""),
  );

  // Keep the innermost match: a wrapper holding the divider has the same text,
  // and starting the card at the wrapper would swallow whatever sits beside it.
  const innermost = matches.filter(
    (element) => !matches.some((other) => other !== element && element.contains(other)),
  );

  const lines: Element[] = [];
  for (const match of innermost) {
    const line = blockOf(match, root);
    // A divider that *is* a table cell would need its rows lifted out of the
    // table; a `div` between `<tr>`s is invalid markup that the engine repairs
    // in unpredictable ways. Leave those alone — a flat divider reads better
    // than a broken table.
    if (TABLE_STRUCTURE.has(line.tagName)) continue;
    if (!lines.includes(line)) lines.push(line);
  }
  return lines;
}

/**
 * Rewrite every forwarded or quoted block under `root` into a card, in place.
 * Returns how many cards were built.
 */
export function buildForwardCards(root: Element, labels: ForwardCardLabels): number {
  expandBrForwardBlocks(root);
  const blocks = collectBlocks(root);

  // Work backwards: the oldest hop is carded first so the hop above it can
  // adopt the finished card as its nested history.
  let built = 0;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (buildCard(blocks[index], root, labels)) built += 1;
  }

  // A card that arrived already built — a forward sent from Pebble — carries
  // its own older hops as plain cards inside its body. Push those down one
  // level as well, so depth reads the same whichever client wrote the mail.
  const doc = root.ownerDocument;
  if (doc) {
    for (const header of Array.from(root.querySelectorAll(".pebble-forward-card__header"))) {
      normalizeCardRows(header, labels);
    }

    for (const inner of Array.from(root.querySelectorAll(".pebble-forward-card .pebble-forward-card"))) {
      if (inner.parentElement?.closest(".pebble-forward-history")) continue;
      wrapInHistory(inner, doc, labels.history);
    }
  }

  return built;
}
