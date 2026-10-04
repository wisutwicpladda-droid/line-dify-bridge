'use strict';
// Environment values contain identities/credentials, never repository files. Fail closed before listening.
const APP='ed28c981-1c94-4547-9003-aefa5e98aaf4';
const NAME='น้องลัดดา AI Sales STAGING 20261003';
const RECOVERY_APP='d7eb3552-3a5a-4f04-b8b0-e2a32e40a95e';
const RECOVERY_NAME='น้องลัดดา RECOVERY AI BRAIN 20261004';
function expectedIdentity(env) {
 const recovery=env.AI_SALES_RECOVERY==='on';
 const app=recovery?{id:RECOVERY_APP,name:RECOVERY_NAME}:{id:APP,name:NAME};
 if(env.AI_SALES_ENVIRONMENT!=='staging'||env.AI_SALES_DIFY_APP_ID!==app.id||
    (env.AI_SALES_DIFY_APP_NAME&&env.AI_SALES_DIFY_APP_NAME!==app.name))throw Error('staging_environment_identity_mismatch');
 return app;
}
async function verifyStaging({env,catalog,knowledge,lineInfo,difyInfo}){
 const app=expectedIdentity(env);
 if(env.AI_SALES_REPLICAS!=='1')throw Error('single_replica_required');
 if(!env.AI_SALES_EXPECTED_LINE_ID||!env.AI_SALES_TESTER_IDS)throw Error('staging_line_identity_and_audience_required');
 if(!catalog||!env.AI_SALES_EXPECTED_CATALOG_VERSION||catalog.version!==env.AI_SALES_EXPECTED_CATALOG_VERSION)throw Error('staging_catalog_version_mismatch');
 if(knowledge?.status!=='ready'||knowledge.catalogVersion!==catalog.version)throw Error('staging_knowledge_version_mismatch');
 const line=await lineInfo(),dify=await difyInfo();
 if(line.status!==200||line.data?.basicId!==env.AI_SALES_EXPECTED_LINE_ID)throw Error('staging_line_identity_mismatch');
 if(dify.status!==200||dify.data?.name!==app.name||(dify.data?.id&&dify.data.id!==app.id))throw Error('staging_dify_identity_mismatch');
 return {verified:true,app_id:app.id,app_name:app.name,line_identity:line.data.basicId,catalog_version:catalog.version,kb_version:knowledge.catalogVersion,replicas:1};
}
function audienceAllowed(env,source){return source?.type==='user'&&(env.AI_SALES_TESTER_IDS||'').split(',').map(x=>x.trim()).filter(Boolean).includes(source.userId);}
module.exports={verifyStaging,audienceAllowed,expectedIdentity};
