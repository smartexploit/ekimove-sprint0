/**
 * Renders the small amount of formatting Atọ́nà uses (paragraphs, "- "
 * lists and **bold**) as React elements. No HTML is ever injected.
 */
function inline(text, keyPrefix) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, index) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={`${keyPrefix}-${index}`}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  )
}

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/

export default function FormattedText({ text }) {
  const blocks = String(text || '').trim().split(/\n\s*\n/)

  return blocks.map((block, blockIndex) => {
    const lines = block.split('\n').filter((line) => line.trim())
    const isList = lines.length > 0 && lines.every((line) => LIST_ITEM.test(line))

    if (isList) {
      return (
        <ul key={blockIndex}>
          {lines.map((line, lineIndex) => (
            <li key={lineIndex}>{inline(line.replace(LIST_ITEM, ''), `${blockIndex}-${lineIndex}`)}</li>
          ))}
        </ul>
      )
    }

    return (
      <p key={blockIndex}>
        {lines.map((line, lineIndex) => (
          <span key={lineIndex}>
            {lineIndex > 0 && <br />}
            {inline(line.replace(/^#+\s*/, ''), `${blockIndex}-${lineIndex}`)}
          </span>
        ))}
      </p>
    )
  })
}
