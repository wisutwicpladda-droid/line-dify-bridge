'use strict';
const crypto=require('crypto');
const {stageKnowledge}=require('./knowledge_release');
const DATASET='9e6143c2-bf6e-4dde-9892-c958e138b2a8';
const NAME='ICP-STAGING-20261003.md';
// Uses the existing isolated document. Deep generation is paused while it indexes.
// API: official Dify /documents/{batch}/indexing-status; never edit shared live KB.
class StagingKnowledgeSync {
  constructor({api,enabled=false,pause=()=>new Promise(r=>setTimeout(r,2000))}={}) {
    this.api=api;this.enabled=enabled;this.pause=pause;this.state={status:'unverified',catalogVersion:null};this.running=false;
  }
  async sync({catalogVersion,text,isCurrent=()=>true}) {
    if(!this.enabled)return this.state;
    if(this.running)return this.state;
    if(this.state.status==='ready'&&this.state.catalogVersion===catalogVersion)return this.state;
    this.running=true;this.state={...this.state,status:'indexing'};
    try {
      const listed=await this.api('GET','/datasets/'+DATASET+'/documents?limit=100');
      const docs=listed.data?.data||[];
      const target=docs.find(d=>d.name===NAME);
      if(listed.status!==200||!target||docs.some(d=>d.id!==target.id&&d.enabled&&!d.archived))
        throw Error('isolated_single_document_required');
      const hash=crypto.createHash('sha256').update(text).digest('hex');
      await stageKnowledge({datasetId:DATASET,catalogVersion,documentHash:hash,pause:this.pause,
        upload:async()=>{
          const r=await this.api('POST','/datasets/'+DATASET+'/documents/'+target.id+'/update-by-text',{name:NAME,text});
          if(r.status!==200||!r.data?.batch)throw Error('staging_document_update_failed');
          return {documentId:target.id,batch:r.data.batch};
        },
        status:async draft=>{
          const r=await this.api('GET','/datasets/'+DATASET+'/documents/'+draft.batch+'/indexing-status');
          if(r.status!==200)throw Error('staging_index_status_unavailable');
          const row=r.data?.data?.find(d=>d.id===draft.documentId);
          return {status:row?.indexing_status||'unknown'};
        },
        promote:async release=>{
          if(!isCurrent())throw Error('catalog_changed_during_indexing');
          this.state={status:'ready',...release};
        }});
    } catch(e) {this.state={...this.state,status:'unavailable',error:e.message};}
    finally {this.running=false;}
    return this.state;
  }
}
module.exports={StagingKnowledgeSync,DATASET,NAME};
