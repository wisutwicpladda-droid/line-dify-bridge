'use strict';
class OptionalClassifier {
  constructor({call,enabled=false,clock=Date.now,cooldownMs=60000,alert=()=>{}}) {Object.assign(this,{call,enabled,clock,cooldownMs,alert});this.openUntil=0;this.authFailed=false;}
  async classify(input,fallback) {
    if(!this.enabled)return {value:fallback,status:'disabled'};
    if(this.authFailed||this.clock()<this.openUntil)return {value:fallback,status:'circuit_open'};
    try {
      const r=await this.call(input);
      if(r.status===401||r.status===403){this.authFailed=true;this.alert({type:'classifier_auth_error',status:r.status});return {value:fallback,status:'auth_error'};}
      if(r.status!==200)throw new Error('unavailable');
      return {value:r.value||fallback,status:'ok'};
    }catch{this.openUntil=this.clock()+this.cooldownMs;return {value:fallback,status:'unavailable'};}
  }
  resetAfterConfigChange(){this.authFailed=false;this.openUntil=0;}
}
module.exports={OptionalClassifier};

