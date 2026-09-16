interface Props {
  segments: { source: string; target: string }[];
}

/**
 * Paragraph-aligned bilingual reading view: the translation carries the flow of
 * the message and the original sits underneath it in muted type, so a reader can
 * check a sentence without leaving the translated paragraph.
 *
 * Pairs whose translation came back identical to the source are dropped — a
 * translator correctly leaves proper nouns, numbers and URLs alone, and printing
 * those twice only adds noise.
 */
export default function BilingualView({ segments }: Props) {
  const pairs = segments.filter(
    (segment) =>
      segment.target.trim() !== "" && segment.source.trim() !== segment.target.trim(),
  );

  if (pairs.length === 0) {
    return (
      <div style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
        {segments.length > 0 ? segments.map((segment) => segment.target).join("\n") : null}
      </div>
    );
  }

  return (
    <div>
      {pairs.map((segment, index) => (
        <div key={index} style={{ marginBottom: "14px" }}>
          <div
            style={{
              fontSize: "14px",
              lineHeight: 1.7,
              color: "var(--color-text-primary)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {segment.target}
          </div>
          <div
            style={{
              fontSize: "12px",
              lineHeight: 1.6,
              marginTop: "3px",
              paddingLeft: "8px",
              borderLeft: "2px solid var(--color-border)",
              color: "var(--color-text-secondary)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {segment.source}
          </div>
        </div>
      ))}
    </div>
  );
}
