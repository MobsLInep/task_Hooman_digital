export interface PdfOptions {
  encrypted?: boolean
}

export function buildPdf(pages: readonly (string | null)[], options: PdfOptions = {}): Uint8Array {
  const objects: string[] = []
  const add = (body: string): number => objects.push(body)

  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

  const contentIds = pages.map((text) => {
    const stream = text === null ? '' : textStream(text)
    return add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })

  const pagesId = objects.length + pages.length + 1
  const pageIds = pages.map((_, i) =>
    add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`
    )
  )

  const realPagesId = add(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
  )
  const catalogId = add(`<< /Type /Catalog /Pages ${realPagesId} 0 R >>`)

  const encryptId = options.encrypted
    ? add(
        '<< /Filter /Standard /V 1 /R 2 ' +
          `/O <${'ab'.repeat(32)}> /U <${'cd'.repeat(32)}> /P -1 >>`
      )
    : 0

  if (realPagesId !== pagesId) {
    for (const id of pageIds) {
      objects[id - 1] = objects[id - 1]!.replace(
        `/Parent ${pagesId} 0 R`,
        `/Parent ${realPagesId} 0 R`
      )
    }
  }

  let out = '%PDF-1.4\n'
  const offsets: number[] = [0]
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })

  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  out +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R` +
    `${options.encrypted ? ` /Encrypt ${encryptId} 0 R /ID [<${'11'.repeat(16)}> <${'22'.repeat(16)}>]` : ''} >>\n` +
    `startxref\n${xref}\n%%EOF\n`

  return new Uint8Array(Buffer.from(out, 'latin1'))
}

function textStream(text: string): string {
  const lines = wrap(text, 70)
  const body = lines
    .map((line, i) => `${i === 0 ? '' : 'T* '}(${escapePdfString(line)}) Tj `)
    .join('')
  return `BT /F1 12 Tf 14 TL 72 720 Td ${body}ET`
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (line && (line + ' ' + word).length > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines
}

function escapePdfString(text: string): string {
  return text.replace(/([()\\])/g, '\\$1')
}

export function corruptPdf(): Uint8Array {
  return new Uint8Array(Buffer.from('%PDF-1.4\n%\xFF\xFF\n1 0 obj\n<< /Type /Cat', 'latin1'))
}

export function notAPdf(): Uint8Array {
  return new Uint8Array(Buffer.from('this is plainly not a pdf file at all', 'utf8'))
}
