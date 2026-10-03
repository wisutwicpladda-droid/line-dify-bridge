'use strict';
// Single replica ledger; persist entries with the conversation snapshot. No user data.
class EventLedger {
  constructor(entries=[],ttl=86400000){this.entries=new Map(entries);this.ttl=ttl;}
  claim(id,now=Date.now()){
    if(!id)return true;
    for(const [key,entry]of this.entries)if(now-entry.at>this.ttl)this.entries.delete(key);
    if(this.entries.has(id))return false;
    this.entries.set(id,{at:now,status:'processing'});return true;
  }
  finish(id,status,now=Date.now()){if(id)this.entries.set(id,{at:now,status});}
  snapshot(){return [...this.entries];}
}
module.exports={EventLedger};
