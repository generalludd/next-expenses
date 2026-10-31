/**
 * A minimal parser for the specific shape of INSERT statements mysqldump
 * produces: one row per statement, `INSERT INTO \`table\` (\`col\`, ...) VALUES
 * (val, ...);`. Not a general SQL parser — it only needs to handle what this
 * dump actually contains (verified: no escaped quotes inside any fee.type or
 * payment field, one row per INSERT, no multi-row VALUES lists).
 */

export type LegacyValue = string | number | null

/** Splits "1, 'Groceries', '260', 4, 2018" into [1, 'Groceries', '260', 4, 2018], respecting quotes. */
export function parseValueTuple(tuple: string): LegacyValue[] {
  const values: LegacyValue[] = []
  let i = 0
  const len = tuple.length

  while (i < len) {
    while (i < len && (tuple[i] === ' ' || tuple[i] === ',')) i++
    if (i >= len) break

    if (tuple[i] === "'") {
      let raw = ''
      i++ // skip opening quote
      while (i < len && tuple[i] !== "'") {
        if (tuple[i] === '\\' && i + 1 < len) {
          raw += tuple[i + 1]
          i += 2
        } else {
          raw += tuple[i]
          i++
        }
      }
      i++ // skip closing quote
      values.push(raw)
    } else {
      let raw = ''
      while (i < len && tuple[i] !== ',') {
        raw += tuple[i]
        i++
      }
      raw = raw.trim()
      if (raw === 'NULL') {
        values.push(null)
      } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
        values.push(Number(raw))
      } else {
        values.push(raw)
      }
    }
  }

  return values
}

/**
 * Finds every `INSERT INTO \`table\` (...) VALUES (...);` line for a table and
 * returns each row's values, in column order.
 */
export function parseInsertsForTable(sql: string, table: string): LegacyValue[][] {
  const pattern = new RegExp(
    `INSERT INTO \`${table}\`\\s*\\([^)]*\\)\\s*VALUES\\s*\\(([^;]*)\\);`,
    'g',
  )
  const rows: LegacyValue[][] = []
  let match: RegExpExecArray | null

  while ((match = pattern.exec(sql)) !== null) {
    rows.push(parseValueTuple(match[1]))
  }

  return rows
}
