/**
 * Parse the free-text body of an Almacén PV entry to extract structured data.
 *
 * Body format example:
 *   "SE CREÓ PV1599  MADISEN\r\n\r\n \r\n\r\nDiseño de gage 756560-92_C0\r\n\r\n\t 0.9\r\n\r\n \r\n\r\nTE 1 SEMANA \r\n\r\n..."
 *
 * Extracts:
 *   - cliente: "MADISEN" (text after "SE CREÓ PVXXXX")
 *   - concepto: "Diseño de gage 756560-92_C0" (first meaningful line after client)
 *   - teTexto: "1 SEMANA" (text after "TE")
 *   - teDias: 7 (converted from teTexto)
 */

export interface ParsedPVData {
  cliente: string | null
  concepto: string | null
  teTexto: string | null
  teDias: number | null
}

/** Parse TE text like "1 SEMANA", "3 A 4 SEMANAS", "3 DÍAS", "INMEDIATO" into days. */
export function parseTeToDays(teTexto: string): number | null {
  if (!teTexto) return null
  const t = teTexto.toUpperCase().trim()

  // INMEDIATO = 0 days
  if (t.includes('INMEDIATO') || t.includes('IMMEDIATE')) return 0

  // Extract numbers
  const numbers = t.match(/\d+/g) || []

  // SEMANAS / SEMANA
  if (t.includes('SEMANA')) {
    if (numbers.length === 0) return null
    if (numbers.length === 1) return parseInt(numbers[0], 10) * 7
    // "3 A 4 SEMANAS" → take the max (worst case)
    if (t.includes(' A ')) {
      return Math.max(...numbers.map(Number)) * 7
    }
    return parseInt(numbers[0], 10) * 7
  }

  // DÍAS / DIA / DAYS
  if (t.includes('DÍA') || t.includes('DIA') || t.includes('DAY')) {
    if (numbers.length === 0) return null
    if (t.includes(' A ')) {
      return Math.max(...numbers.map(Number))
    }
    return parseInt(numbers[0], 10)
  }

  // MESES / MES
  if (t.includes('MES')) {
    if (numbers.length === 0) return null
    if (t.includes(' A ')) {
      return Math.max(...numbers.map(Number)) * 30
    }
    return parseInt(numbers[0], 10) * 30
  }

  // Just a number
  if (numbers.length > 0) {
    return parseInt(numbers[0], 10)
  }

  return null
}

/** Parse the PV body text to extract structured data. */
export function parsePvBody(body: string | null | undefined, subject?: string | null): ParsedPVData {
  if (!body) return { cliente: null, concepto: null, teTexto: null, teDias: null }

  const lines = body.split(/\r\n|\n|\r/).map(l => l.trim()).filter(l => l.length > 0)

  let cliente: string | null = null
  let concepto: string | null = null
  let teTexto: string | null = null

  // 1. Extract TE text: find line starting with "TE" (case insensitive)
  for (const line of lines) {
    const teMatch = line.match(/^TE\s+(.+)$/i)
    if (teMatch) {
      teTexto = teMatch[1].trim()
      break
    }
    // Also match "te " anywhere in line (some PVs have it inline)
    const teInline = line.match(/\bTE\s+([\d\sA-ZÁÉÍÓÚÑ]+(?:SEMANA|DÍA|DIA|MES|INMEDIATO)[^.\r\n]*)/i)
    if (teInline && !teTexto) {
      teTexto = teInline[1].trim()
    }
  }

  // 2. Extract client: text after "SE CREÓ PVxxxx" in the first few lines
  for (const line of lines.slice(0, 5)) {
    const creacionMatch = line.match(/SE\s+CRE[ÓO][Oo]\s+PV\d+\s+(.+)/i)
    if (creacionMatch) {
      cliente = creacionMatch[1].trim()
      break
    }
  }

  // 3. Extract concept: first meaningful line after the "SE CREÓ" line
  // Skip lines that are: empty, "SE CREÓ...", PV number, email signatures, phone numbers
  const skipPatterns = /^(SE\s+CRE|PV\s*\d|Ing\.|Tel\.|Cel\.|Política|www\.|Este\s+correo|https?|\.+$|-+$|O\.?\s*C\.?\s*PEND)/i
  const foundCreacion = lines.findIndex(l => /SE\s+CRE[ÓO][Oo]/i.test(l))

  for (let i = (foundCreacion >= 0 ? foundCreacion + 1 : 0); i < lines.length; i++) {
    const line = lines[i]
    if (skipPatterns.test(line)) continue
    // Skip lines that are just numbers or very short
    if (line.length < 3) continue
    // Skip TE lines
    if (/^TE\s+/i.test(line)) continue
    // Skip email/phone patterns
    if (/@|\.com|\.mx|Ext\.|^\d+$|^[\d\s\-\(\)]+$/.test(line)) continue

    concepto = line
    break
  }

  // Fallback: if no concept found, use subject
  if (!concepto && subject) {
    concepto = subject
  }

  // 4. Convert TE text to days
  const teDias = teTexto ? parseTeToDays(teTexto) : null

  return { cliente, concepto, teTexto, teDias }
}
