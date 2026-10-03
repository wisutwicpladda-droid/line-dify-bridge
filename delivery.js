'use strict';
const {renderMessages,batches}=require('./line_renderer');
async function deliver({content,canSend,reply,push,onSent=()=>{}}) {
  const groups=batches(renderMessages(content)); let sent=0;
  for(let i=0;i<groups.length;i++) {
    if(!canSend()) return {status:'dropped_stale',sent};
    let ok = i===0 ? await reply(groups[i]) : await push(groups[i]);
    // A failed reply may fall back to push, but must recheck ownership.
    if(!ok && i===0) { if(!canSend()) return {status:'dropped_stale',sent}; ok=await push(groups[i]); }
    if(!ok) return {status:'failed',sent};
    sent+=groups[i].length; onSent(groups[i]);
  }
  return {status:'sent',sent};
}
module.exports={deliver};

