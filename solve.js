// Fast drop-in for makefun-diff 1.0.0's diffPatch, written from the competition spec.
//
// Lines are cut after every "\n" (a "\r" stays in its line); a final line without
// "\n" still counts, and line equality includes newline presence. The edit script
// keeps the common prefix of lines, then the common suffix of what remains, then
// runs Myers's greedy furthest-point search on the middle: per diagonal the path
// reaching furthest into the old text wins, ties go to the deletion's path, moves
// past either text's end are not candidates, and every run of equal lines (snake)
// is followed as far as it goes. The patch is the makefun-diff/1 header plus
// hunks with 3 lines of context (runs at most 6 kept lines apart share a hunk),
// deletions listed before insertions within each change run, and a "%" line after
// any covered line that ends its text without a newline.
//
// Speed: lines are interned to integer ids per call, the search runs on typed
// arrays with no allocation in the inner loop, and the trace keeps only the
// active diagonal window per depth.

const NEG = -1000000000;

/** Cut a text into line bodies (without the "\n"); reports whether the last line lacks one. */
function splitLines(text) {
  const parts = text.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  const noNL = text.length > 0 && text.charCodeAt(text.length - 1) !== 10;
  return { parts, noNL };
}

/** Intern line bodies to ids: id = 2*base, plus 1 for a final line with no newline. */
function intern(parts, noNL, map) {
  const n = parts.length;
  const ids = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const s = parts[i];
    let base = map.get(s);
    if (base === undefined) {
      base = map.size;
      map.set(s, base);
    }
    ids[i] = base * 2 + (noNL && i === n - 1 ? 1 : 0);
  }
  return ids;
}

/**
 * Greedy Myers search on A[oa..oa+N) vs B[na..na+M).
 * Returns { ops, len } where ops is a Uint8Array filled from the end:
 * 0 = keep, 1 = delete, 2 = insert; the valid segment is ops[len..N+M).
 *
 * The trace stores, per depth d and diagonal k, the pre-snake x of the chosen
 * predecessor move, encoded as x+1 for a deletion and -(x+1) for an insertion
 * (0 = unreachable), so backtracking needs no V snapshots.
 */
function myers(A, oa, N, B, na, M) {
  const ops = new Uint8Array(N + M);
  if (N === 0) {
    ops.fill(2);
    return { ops, len: 0 };
  }
  if (M === 0) {
    ops.fill(1);
    return { ops, len: 0 };
  }
  const a = A.subarray(oa, oa + N);
  const b = B.subarray(na, na + M);
  const maxD = N + M;
  const offset = maxD;
  const V = new Int32Array(2 * maxD + 1).fill(NEG);
  const trace = [null];
  let D = -1;

  // Depth 0: the snake from the origin.
  {
    let x = 0;
    while (x < N && x < M && a[x] === b[x]) x++;
    V[offset] = x;
    if (x >= N && x >= M) D = 0;
  }

  for (let d = 1; d <= maxD && D < 0; d++) {
    const tr = new Int32Array(d + 1);
    trace.push(tr);
    for (let k = -d, ti = 0; k <= d; k += 2, ti++) {
      const idx = offset + k;
      const dv = V[idx - 1] + 1; // deletion candidate x (NEG+1 when unreachable)
      const iv = V[idx + 1]; // insertion candidate x
      let x;
      let del;
      if (dv >= 0 && dv <= N && iv >= 0 && iv - k <= M) {
        // Fast path: both moves valid; furthest x wins, deletion takes ties.
        if (dv >= iv) {
          x = dv;
          del = true;
        } else {
          x = iv;
          del = false;
        }
      } else if (k === -d) {
        if (iv < 0 || iv - k > M) {
          V[idx] = NEG;
          continue;
        }
        x = iv;
        del = false;
      } else if (k === d) {
        if (dv < 0 || dv > N) {
          V[idx] = NEG;
          continue;
        }
        x = dv;
        del = true;
      } else {
        const dOk = dv >= 0 && dv <= N;
        const iOk = iv >= 0 && iv - k <= M;
        if (dOk && (!iOk || dv >= iv)) {
          x = dv;
          del = true;
        } else if (iOk) {
          x = iv;
          del = false;
        } else {
          V[idx] = NEG;
          continue;
        }
      }
      tr[ti] = del ? x + 1 : -(x + 1);
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }
      V[idx] = x;
      if (x >= N && y >= M) {
        D = d;
        break;
      }
    }
  }

  // Backtrack from (N, M) through the stored predecessor choices.
  let pos = N + M;
  let x = N;
  let y = M;
  for (let d = D; d >= 1; d--) {
    const k = x - y;
    const enc = trace[d][(k + d) >> 1];
    const x0 = (enc > 0 ? enc : -enc) - 1;
    while (x > x0) {
      ops[--pos] = 0;
      x--;
      y--;
    }
    if (enc > 0) {
      ops[--pos] = 1;
      x--;
    } else {
      ops[--pos] = 2;
      y--;
    }
  }
  while (x > 0) {
    ops[--pos] = 0;
    x--;
    y--;
  }
  return { ops, len: pos };
}

export function run(input) {
  const oldSplit = splitLines(input.old);
  const newSplit = splitLines(input.new);
  const oParts = oldSplit.parts;
  const nParts = newSplit.parts;
  const oN = oParts.length;
  const nN = nParts.length;

  const map = new Map();
  const A = intern(oParts, oldSplit.noNL, map);
  const B = intern(nParts, newSplit.noNL, map);

  // Common prefix, then common suffix of what remains.
  let pre = 0;
  const lim = oN < nN ? oN : nN;
  while (pre < lim && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < lim - pre && A[oN - 1 - suf] === B[nN - 1 - suf]) suf++;

  const midN = oN - pre - suf;
  const midM = nN - pre - suf;
  const { ops: midOps, len: midStart } = myers(A, pre, midN, B, pre, midM);
  const midLen = midN + midM - midStart;

  // Full op sequence: prefix keeps, middle ops, suffix keeps (0 = keep).
  const ops = new Uint8Array(pre + midLen + suf);
  ops.set(midOps.subarray(midStart), pre);

  let deleted = 0;
  let inserted = 0;
  for (let i = 0; i < ops.length; i++) {
    if (ops[i] === 1) deleted++;
    else if (ops[i] === 2) inserted++;
  }

  const head = `makefun-diff/1 old=${oN} new=${nN} hunks=`;
  if (deleted === 0 && inserted === 0) {
    return `${head}0 deleted=0 inserted=0\n`;
  }

  // Change runs: maximal non-keep stretches, with old/new positions.
  const runs = [];
  {
    let oi = 0;
    let ni = 0;
    let i = 0;
    const total = ops.length;
    while (i < total) {
      if (ops[i] === 0) {
        oi++;
        ni++;
        i++;
      } else {
        const r = { opStart: i, oldStart: oi, newStart: ni, opEnd: i, oldEnd: oi, newEnd: ni };
        while (i < total && ops[i] !== 0) {
          if (ops[i] === 1) oi++;
          else ni++;
          i++;
        }
        r.opEnd = i;
        r.oldEnd = oi;
        r.newEnd = ni;
        runs.push(r);
      }
    }
  }

  // Group runs into hunks: runs at most 6 kept lines apart share one.
  const hunks = [];
  for (const r of runs) {
    const last = hunks[hunks.length - 1];
    if (last && r.oldStart - last.oldEnd <= 6) {
      last.opEnd = r.opEnd;
      last.oldEnd = r.oldEnd;
      last.newEnd = r.newEnd;
      last.runs.push(r);
    } else {
      hunks.push({
        opStart: r.opStart,
        opEnd: r.opEnd,
        oldStart: r.oldStart,
        newStart: r.newStart,
        oldEnd: r.oldEnd,
        newEnd: r.newEnd,
        runs: [r],
      });
    }
  }

  const out = [`${head}${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  const oNoNL = oldSplit.noNL;
  const nNoNL = newSplit.noNL;

  for (const h of hunks) {
    // Widen with up to 3 kept lines on each side.
    let hOpStart = h.opStart;
    let hOldStart = h.oldStart;
    let hNewStart = h.newStart;
    for (let c = 0; c < 3 && hOpStart > 0 && ops[hOpStart - 1] === 0; c++) {
      hOpStart--;
      hOldStart--;
      hNewStart--;
    }
    let hOpEnd = h.opEnd;
    let hOldEnd = h.oldEnd;
    let hNewEnd = h.newEnd;
    for (let c = 0; c < 3 && hOpEnd < ops.length && ops[hOpEnd] === 0; c++) {
      hOpEnd++;
      hOldEnd++;
      hNewEnd++;
    }
    out.push(`@ ${hOldStart + 1} ${hOldEnd - hOldStart} ${hNewStart + 1} ${hNewEnd - hNewStart}\n`);

    let oi = hOldStart;
    let ni = hNewStart;
    let i = hOpStart;
    while (i < hOpEnd) {
      if (ops[i] === 0) {
        out.push('=' + oParts[oi] + '\n');
        if (oNoNL && oi === oN - 1) out.push('%\n');
        oi++;
        ni++;
        i++;
      } else {
        // One change run: deletions first, then insertions.
        const delIdx = [];
        const insIdx = [];
        while (i < hOpEnd && ops[i] !== 0) {
          if (ops[i] === 1) delIdx.push(oi++);
          else insIdx.push(ni++);
          i++;
        }
        for (const dIdx of delIdx) {
          out.push('-' + oParts[dIdx] + '\n');
          if (oNoNL && dIdx === oN - 1) out.push('%\n');
        }
        for (const iIdx of insIdx) {
          out.push('+' + nParts[iIdx] + '\n');
          if (nNoNL && iIdx === nN - 1) out.push('%\n');
        }
      }
    }
  }
  return out.join('');
}
