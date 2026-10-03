'use strict';
const SHARED_PRODUCTION_DATASET='af225749-33cc-4f0a-ae49-934ada9af79f';
async function stageKnowledge({datasetId,catalogVersion,documentHash,upload,status,promote,attempts=30,pause}) {
  if(!datasetId||datasetId===SHARED_PRODUCTION_DATASET)throw new Error('isolated_dataset_required');
  const draft=await upload({datasetId,catalogVersion,documentHash});
  for(let i=0;i<attempts;i++) {
    const result=await status(draft);
    if(result.status==='completed') {const release={datasetId,catalogVersion,documentHash,documentId:draft.documentId,indexed_at:new Date().toISOString()};await promote(release);return release;}
    if(['error','paused','failed'].includes(result.status))throw new Error('indexing_'+result.status);
    if(pause)await pause();
  }
  throw new Error('indexing_not_confirmed');
}
module.exports={stageKnowledge,SHARED_PRODUCTION_DATASET};

