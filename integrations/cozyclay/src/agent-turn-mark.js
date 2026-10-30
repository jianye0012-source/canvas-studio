// The agent turn's controls, and its mark. One user message is one editor transaction
// (#702, #715): every edit of the turn lands in one composed session, so the message is one
// undo step. A script runs inside that turn, after edits the same message already made (an
// installed take, a placed set). When the script fails, only its own edits roll back:
// agent.turn.mark records where it starts, and agent.turn.rollback restores exactly what came
// after the mark and leaves the turn open, so the earlier edits still land with the turn.
import { StudioProtocolError } from './studio-agent-protocol.js';

const TURN_CONTROLS = ['begin', 'mark', 'rollback', 'finish', 'cancel'];
/** The wire schema of each agent.turn.* control: the owning turn's id, nothing else. */
export const agentTurnControls = (object, identifier) => Object.fromEntries(TURN_CONTROLS.map(verb => [`agent.turn.${verb}`, object({ turnId: identifier })]));

/**
 * agent.turn.mark or agent.turn.rollback on the open turn. Answers the transaction its receipt
 * describes: a mark affects nothing, a rollback names the ids the rolled-back edits touched.
 * The bus adds each later edit's ids to `turn.mark.since`.
 */
export function markAgentTurn(id, turn) {
  if (id === 'agent.turn.mark') {
    turn.mark = { point: turn.session?.savepoint() ?? null, affectedIds: new Set(turn.affectedIds), since: new Set() };
    return { txId: turn.txId, affectedIds: [], toasts: [] };
  }
  const { mark } = turn;
  if (!mark) throw new StudioProtocolError('STALE_TARGET', 'The agent turn has no mark to roll back to.');
  turn.mark = null;
  turn.edits = (turn.edits ?? []).filter(edit => edit.mark !== mark);
  // No session at the mark: everything the turn authored came after it.
  turn.session?.rollback(mark.point ?? undefined);
  turn.affectedIds = mark.affectedIds;
  return { txId: turn.txId, affectedIds: [...mark.since], toasts: [] };
}

// The turn's own edits, newest last: each keeps the savepoint before it, so undo_edit on the
// newest one's receipt rolls back to there and the turn stays open (9240db36 was refused twice).
/** Where the turn stands before a command runs: the savepoint, the ids so far, the open mark. */
export const turnEditPoint = turn => turn && { point: turn.session?.savepoint() ?? null, affectedIds: new Set(turn.affectedIds), since: turn.mark && new Set(turn.mark.since), mark: turn.mark };

/** Files an authored receipt of the turn with the point before it; answers the receipt. */
export function recordTurnEdit(turn, at, recorded) {
  if (turn && at && recorded?.ok && recorded.authored) (turn.edits ??= []).push({ ...at, receiptId: recorded.receiptId, ids: recorded.affectedIds });
  return recorded;
}

/**
 * edit.undo from inside the owning turn once it has authored. A receipt of the turn's newest edit
 * rolls back to the point before it and answers the receipt (before: the bus's read at admission;
 * read: a read after); anything else is refused with what the agent can do instead.
 */
export function undoTurnEdit(turn, args, request, before, read) {
  const edits = turn.edits ?? [], at = edits.findIndex(edit => edit.receiptId === args.receiptId);
  if (at < 0) throw new StudioProtocolError('TARGET_BUSY', `Finish the agent turn before traversing history or opening another transaction. Inside the turn, undo_edit with the receiptId of this message's newest edit reverts it${edits.length ? ` (now ${edits.at(-1).receiptId})` : ''}; an earlier message's edit is undone after this one ends.`);
  const edit = edits[at];
  if (at < edits.length - 1) throw new StudioProtocolError('UNDO_CONFLICT', `Later edits of this message come after it; undo them first, newest first: ${edits.slice(at + 1).reverse().map(later => later.receiptId).join(', ')}.`);
  turn.session.rollback(edit.point ?? undefined);
  edits.pop();
  turn.affectedIds = edit.affectedIds;
  // Nothing came after a mark this edit predates, so the mark moves to now: a script's rollback still finds it.
  if (turn.mark && edit.mark !== turn.mark) turn.mark = { point: turn.session.savepoint(), affectedIds: new Set(turn.affectedIds), since: new Set() };
  else if (turn.mark) turn.mark.since = edit.since;
  return { ok: true, status: 'completed', kind: 'transaction', action: 'edit.undo', txId: turn.txId, commandId: request.commandId, receiptId: crypto.randomUUID(), host: before.host,
    summary: `Undid ${edit.receiptId} inside this message.`, authored: false, revision: { before: before.revision, after: read().revision }, affectedIds: edit.ids, delta: [],
    checks: { coverage: 'agent-turn-savepoint' }, undo: null, warnings: [], output: { undoneReceiptId: edit.receiptId } };
}
