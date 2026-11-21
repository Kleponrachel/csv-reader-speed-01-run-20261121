// A fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// It returns exactly csv-reader's answer for every input {text, header}:
// {columns, rows, errors}. The reading policy, restated from the spec:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is
//     no record;
//   - outside a quoted field a CR not followed by LF is dropped
//     (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it is one quote, and each CRLF or lone CR inside
//     it is read as LF; what follows its closing quote, up to the next
//     comma or line break, is appended as it stands (quote_junk, when the
//     field ends); a quote that never closes is a literal character, and
//     the text after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows
//     holds the records after it, each padded with "" (short_row, with
//     fields: its count) or cut (long_row, with extra: the cut fields) to
//     the first record's width;
//   - each error is {code, line, row}, in the order met: line the 1-based
//     line its record starts on, counting every LF, CRLF and lone CR
//     inside quotes, and row its record's index in rows (null for the
//     header).
//
// Speed comes from never looping one character at a time on the hot path.
// A record whose line holds no quote and no stray CR is cut out with
// indexOf and split(','). Lines with a quote or a stray CR go through the
// field-by-field scanners below, which are also indexOf-driven: an
// unquoted field is found by the next comma alone once the line's end is
// known, so no scan ever runs past the line it is on, and a quoted field
// is found by the next quote. The scanners report through shared slots
// instead of allocating a result per field. All work is on UTF-16 code
// units, exactly like the reference, so every string comes out identical.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;

  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on, and the index in rows it
  // takes (null while the header is still unread).
  let recordLine = 1;
  let recordRow = null;

  // The last field read: its value, how it ended, where the reader now
  // sits, and how many characters the last scan kept.
  let fValue = '';
  let fEnded = END;
  let fPos = 0;
  let fAdded = 0;

  function pushError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field starting at p, keeping `start` as its value so
  // far, into the shared slots. It stops at the next comma, line break or
  // the end of the text; a CR not followed by LF is dropped and reported,
  // and the field goes on. (The record loop reads unquoted fields on a
  // known line inline instead, where the next comma alone finds the end;
  // this scanner serves the cases with no line bound: junk after a closing
  // quote, a quote that never closes, and records that left their line.)
  function scanUnquoted(p, start) {
    let value = start;
    for (;;) {
      const comma = text.indexOf(',', p);
      const lf = text.indexOf('\n', p);
      let end;
      let kind;
      if (comma === -1 && lf === -1) {
        end = len;
        kind = END;
      } else if (lf === -1 || (comma !== -1 && comma < lf)) {
        end = comma;
        kind = COMMA;
      } else {
        end = lf;
        kind = LINE_BREAK;
      }
      const piece = text.slice(p, end);
      const cr = piece.indexOf('\r');
      if (cr === -1) {
        fValue = value === '' ? piece : value + piece;
        if (kind === COMMA) {
          fEnded = COMMA;
          fPos = end + 1;
        } else if (kind === LINE_BREAK) {
          line += 1;
          fEnded = LINE_BREAK;
          fPos = end + 1;
        } else {
          fEnded = END;
          fPos = len;
        }
        fAdded = fValue.length - start.length;
        return;
      }
      if (kind === LINE_BREAK && cr === piece.length - 1) {
        // A CR right before the LF: one CRLF line break.
        fValue = value === '' ? piece.slice(0, cr) : value + piece.slice(0, cr);
        line += 1;
        fEnded = LINE_BREAK;
        fPos = end + 1;
        fAdded = fValue.length - start.length;
        return;
      }
      // A stray CR: dropped, reported, and the field goes on past it.
      pushError('stray_cr');
      value += piece.slice(0, cr);
      p += cr + 1;
    }
  }

  // Reads a quoted field whose opening quote is at p, into the shared
  // slots. It runs to the next quote that is not doubled ("" inside is one
  // quote); each CRLF or lone CR inside reads as LF. What follows the
  // closing quote, up to the next comma or line break, is appended as it
  // stands. A quote that never closes is a literal character, and the text
  // after it is read again as an unquoted field.
  function scanQuoted(p) {
    const open = p;
    const openLine = line;
    let value = '';
    let cur = p + 1;
    for (;;) {
      const quote = text.indexOf('"', cur);
      if (quote === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted, from the line it opened on.
        line = openLine;
        pushError('unterminated_quote');
        scanUnquoted(open + 1, '"');
        return;
      }
      const piece = text.slice(cur, quote);
      const lf = piece.indexOf('\n');
      const cr = piece.indexOf('\r');
      let br = -1;
      let brCr = false;
      if (lf !== -1) br = lf;
      if (cr !== -1 && (br === -1 || cr < br)) {
        br = cr;
        brCr = true;
      }
      if (br === -1) {
        if (text[quote + 1] === '"') {
          value = value === '' ? piece : value + piece;
          value += '"';
          cur = quote + 2;
          continue;
        }
        value = value === '' ? piece : value + piece;
        const next = quote + 1;
        if (next >= len) {
          fValue = value;
          fEnded = END;
          fPos = next;
          fAdded = 0;
          return;
        }
        const c = text[next];
        if (c === ',') {
          fValue = value;
          fEnded = COMMA;
          fPos = next + 1;
          fAdded = 0;
          return;
        }
        if (c === '\n') {
          line += 1;
          fValue = value;
          fEnded = LINE_BREAK;
          fPos = next + 1;
          fAdded = 0;
          return;
        }
        if (c === '\r' && text[next + 1] === '\n') {
          line += 1;
          fValue = value;
          fEnded = LINE_BREAK;
          fPos = next + 2;
          fAdded = 0;
          return;
        }
        // What follows the closing quote is appended as it stands.
        scanUnquoted(next, value);
        if (fAdded > 0) pushError('quote_junk');
        return;
      }
      // A line break inside the quotes: one LF in the value.
      value += piece.slice(0, br);
      value += '\n';
      line += 1;
      cur += br + (brCr && piece[br + 1] === '\n' ? 2 : 1);
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text[pos];
      if (c === '\n') {
        pos += 1;
        line += 1;
      } else if (c === '\r' && text[pos + 1] === '\n') {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    let fields;
    let lastQuoted = false;

    // Fast path: one clean line, no quote and no stray CR. Its record is
    // the line split on commas; a trailing CR is a CRLF ending. The line's
    // end stays on as the bound for the field-by-field path below.
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? len : nl;
    const seg = text.slice(pos, lineEnd);
    let bound = lineEnd;
    if (seg.indexOf('"') === -1) {
      const cr = seg.indexOf('\r');
      if (cr === -1 || (cr === seg.length - 1 && nl !== -1)) {
        fields = (cr === -1 ? seg : seg.slice(0, -1)).split(',');
        pos = nl === -1 ? len : nl + 1;
        if (nl !== -1) line += 1;
      }
    }

    if (fields === undefined) {
      // A line with a quote or a stray CR: read it field by field. The
      // bound stays valid until a quoted field spans lines, which the
      // line count gives away. An unquoted field on a known line is read
      // inline here: the next comma alone finds its end, so the common
      // field costs one indexOf and one slice, with no call.
      fields = [];
      let ended;
      do {
        if (text[pos] === '"') {
          const l0 = line;
          scanQuoted(pos);
          lastQuoted = true;
          if (fEnded === COMMA && line !== l0) bound = -1;
        } else if (bound >= 0) {
          let value = '';
          let p = pos;
          for (;;) {
            const comma = text.indexOf(',', p);
            if (comma !== -1 && comma < bound) {
              const piece = text.slice(p, comma);
              const cr = piece.indexOf('\r');
              if (cr === -1) {
                // Nothing kept yet: the piece is the field as it stands.
                fValue = value === '' ? piece : value + piece;
                fEnded = COMMA;
                fPos = comma + 1;
                break;
              }
              pushError('stray_cr');
              value += piece.slice(0, cr);
              p += cr + 1;
              continue;
            }
            const piece = text.slice(p, bound);
            const cr = piece.indexOf('\r');
            if (cr === -1) {
              fValue = value === '' ? piece : value + piece;
              if (bound < len) {
                line += 1;
                fEnded = LINE_BREAK;
                fPos = bound + 1;
              } else {
                fEnded = END;
                fPos = len;
              }
              break;
            }
            if (bound < len && cr === piece.length - 1) {
              // A CR right before the LF: one CRLF line break.
              fValue = value === '' ? piece.slice(0, cr) : value + piece.slice(0, cr);
              line += 1;
              fEnded = LINE_BREAK;
              fPos = bound + 1;
              break;
            }
            pushError('stray_cr');
            value += piece.slice(0, cr);
            p += cr + 1;
          }
          lastQuoted = false;
        } else {
          scanUnquoted(pos, '');
          lastQuoted = false;
        }
        fields.push(fValue);
        pos = fPos;
        ended = fEnded;
      } while (ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
