/** Splits text into words so each one can bob gently on its own. Wrapping and selection still work normally. */
export function FloatyText({ text }: { text: string }) {
  const parts = text.split(/(\s+)/);
  let index = 0;
  return (
    <span className="floaty-quote" aria-label={text}>
      {parts.map((part, i) => {
        if (!part) return null;
        if (/^\s+$/.test(part)) return part;
        const n = index++;
        return (
          <span key={i} className="floaty-word" aria-hidden="true" style={{ ['--i' as string]: n }}>
            <span>{part}</span>
          </span>
        );
      })}
    </span>
  );
}
