'use strict';
const STATES = ['BOT_ACTIVE','HUMAN_REQUESTED','HUMAN_ACTIVE','BOT_ASSIST_ONLY','BOT_RESUME'];
function ensure(s) {
  if (!s.ownership) s.ownership = { state: s.handoff || s.mutedUntil > Date.now() ? 'HUMAN_ACTIVE' : 'BOT_ACTIVE', version: 1, turn: 0, summary: '', updated_at: Date.now() };
  return s.ownership;
}
function transition(s,state,{expectedVersion,summary,actor='system'}={}) {
  const o=ensure(s); if(!STATES.includes(state)) throw new Error('invalid_ownership_state');
  if(expectedVersion != null && expectedVersion!==o.version) throw new Error('ownership_conflict');
  if(state==='BOT_RESUME' && actor!=='admin') throw new Error('admin_resume_required');
  if(state==='BOT_RESUME' && typeof summary!=='string') throw new Error('resume_summary_required');
  s.ownership={...o,state,version:o.version+1,updated_at:Date.now(),summary:summary==null?o.summary:summary};
  return s.ownership;
}
function beginTurn(s) { const o=ensure(s); o.turn++; return {version:o.version,turn:o.turn}; }
function ticket(s) { const o=ensure(s);return {version:o.version,turn:o.turn}; }
function canSend(s,t,{handoffAcknowledgement=false}={}) {
  const o=ensure(s);
  return !!t && t.version===o.version && t.turn===o.turn && (['BOT_ACTIVE','BOT_RESUME'].includes(o.state) || (handoffAcknowledgement && o.state==='HUMAN_REQUESTED'));
}
module.exports={STATES,ensure,transition,beginTurn,ticket,canSend};

