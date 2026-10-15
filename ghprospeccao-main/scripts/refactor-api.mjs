import ts from 'typescript-ast';
import fs from 'node:fs';
function replaceMethods(file,replacements) {
 const source=fs.readFileSync(file,'utf8');const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);const changes=[];
 function visit(n){if(ts.isMethodDeclaration(n) && replacements[n.name.getText(tree)])changes.push({start:n.getStart(tree),end:n.end,text:replacements[n.name.getText(tree)]});ts.forEachChild(n,visit);}
 visit(tree);let result=source;for(const c of changes.sort((a,b)=>b.start-a.start)) result=result.slice(0,c.start)+c.text+result.slice(c.end);fs.writeFileSync(file,result);
}
replaceMethods('src/lib/api.ts',{
 getLeads:`async getLeads(params: {freelancer_id?:string;search_job_id?:string;state?:string;city?:string;niche?:string;onlyWithoutWebsite?:boolean;onlyWithPhone?:boolean;onlyFavorites?:boolean;excludeHidden?:boolean;onlyHidden?:boolean;minRating?:number;minReviews?:number;minScore?:number;status?:string;search?:string;sortBy?:'score'|'reviews'|'rating'|'recent';page?:number;limit?:number}, signal?:AbortSignal): Promise<{leads:Lead[];total:number;page:number;totalPages:number}> {
 const query=new URLSearchParams();for(const [k,v] of Object.entries(params))if(v!==undefined)query.set(k,String(v));
 const data=await requestJson('/api/leads?'+query,{signal});
 if(!Array.isArray(data.leads)||!Number.isInteger(data.total)||data.total<0)throw new Error('Resposta de leads inválida.');return data;
 }`,
 getDashboardStats:`async getDashboardStats(freelancer_id?:string):Promise<DashboardStats>{return requestJson('/api/dashboard/stats'+scopeQuery(freelancer_id));}`,
 getPipeline:`async getPipeline(freelancer_id?:string):Promise<Record<PipelineStatus,Lead[]>>{return requestJson('/api/pipeline'+scopeQuery(freelancer_id));}`,
 movePipelineLead:`async movePipelineLead(leadId:string,toStatus:PipelineStatus):Promise<Lead>{return requestJson('/api/pipeline/move',{method:'POST',body:JSON.stringify({leadId,toStatus})});}`,
 getNiches:`async getNiches(params?:{onlyFavorites?:boolean;freelancer_id?:string}){return requestJson('/api/niches?'+new URLSearchParams(Object.entries(params||{}).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])));}`,
 getStatesSummary:`async getStatesSummary(params?:{onlyFavorites?:boolean;freelancer_id?:string;niche?:string}){return requestJson('/api/states-summary?'+new URLSearchParams(Object.entries(params||{}).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])));}`,
 adminGetFreelancerLeads:`async adminGetFreelancerLeads(id:string):Promise<{leads:Lead[];total:number}>{return requestJson('/api/admin/freelancers/'+encodeURIComponent(id)+'/leads');}`,
 adminDeleteFreelancer:`async adminDeleteFreelancer(id:string):Promise<{success:boolean;message?:string}>{return requestJson('/api/admin/freelancers/'+encodeURIComponent(id),{method:'DELETE'});}`,
 getSearchJobs:`async getSearchJobs():Promise<SearchJob[]>{return requestJson('/api/search-jobs');}`,
 getSettings:`async getSettings():Promise<AppSettings & {maskedKey?:string}>{return requestJson('/api/settings');}`,
});
let api=fs.readFileSync('src/lib/api.ts','utf8');
api=api.replace(/import \{\s*fetchAllLeadsFromFirestore,[\s\S]*?from '\.\/firebase\/client';/,"import { invalidateLeadsCache } from './firebase/client';");
api+=`\nfunction scopeQuery(id?:string){return id?'?freelancer_id='+encodeURIComponent(id):'';}\nasync function requestJson(url:string,options:RequestInit={}){const res=await fetch(url,{...options,cache:'no-store',headers:getAuthHeaders({'Content-Type':'application/json'})});if(!res.ok){const error=await res.json().catch(()=>({}));throw Object.assign(new Error(error.message||error.error||'Falha ao consultar o servidor.'),{status:res.status});}return res.json();}\n`;
fs.writeFileSync('src/lib/api.ts',api);
let app=fs.readFileSync('src/server/app.ts','utf8');
// Remove the startup timer: imports must never run workers or access production data.
app=app.slice(0,app.indexOf('// Auto-recuperação'))+'\nexport { app };\nexport default app;\n';
// The legacy login must use exactly the same configured credentials.
const begin=app.indexOf("app.post('/api/auth/login'");const end=app.indexOf("app.get('/api/auth/me'",begin);
app=app.slice(0,begin)+"app.post('/api/auth/login', (_req, res) => res.status(410).json({error:'Use /api/admin/login.'}));\n\n"+app.slice(end);
app=app.replace(/const ok = (pauseSearchJob|resumeSearchJob|cancelSearchJob)\(/g,'const ok = await $1(');
app=app.replace("    runSearchJob(job.id).catch(console.error);","    // Job is committed; the durable dispatcher will claim it.");
app=app.replace(/db\.deleteLead\(leadId, \{\s*freelancerId: ([^,]+),\s*role: [^,\n]+,?\s*\}\)/g,'db.deleteLead(leadId, $1)');
app=app.replace(/db\.deleteMultipleLeads\(leadIds, \{\s*freelancerId: ([^,]+),\s*role: [^,\n]+,?\s*\}\)/g,'db.deleteMultipleLeads(leadIds, $1)');
// Return authorization/storage errors without exposing upstream payloads or secrets.
app=app.replace(/res\.status\(500\)\.json\(\{ error: message \}\)/g,"res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) })");
fs.writeFileSync('src/server/app.ts',app);
