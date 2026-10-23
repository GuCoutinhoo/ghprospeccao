type Row = { collection:string; id:string; workspace_id:string; document:Record<string,any>; revision:number };

const clone = <T>(value:T):T => JSON.parse(JSON.stringify(value));

export function createSupabaseHarness() {
  const rows = new Map<string,Row>();
  let failNextCommit = false;
  const key = (collection:string,id:string) => `${collection}/${id}`;
  const response = (body:unknown,status=200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {status,headers:{'content-type':'application/json'}});

  const fetchMock:typeof fetch = async (input,init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/app_records')) {
      const collection = String(url.searchParams.get('collection') || '').replace(/^eq\./,'');
      const idFilter = String(url.searchParams.get('id') || '');
      const id = idFilter.startsWith('eq.') ? idFilter.slice(3) : '';
      const ids = idFilter.startsWith('in.(') ? idFilter.slice(4,-1).split(',').map(value=>value.replace(/^"|"$/g,'')) : [];
      const workspace = String(url.searchParams.get('workspace_id') || '').replace(/^eq\./,'');
      let result = [...rows.values()].filter(row => !collection || row.collection===collection);
      if(id)result=result.filter(row=>row.id===id);
      if(ids.length)result=result.filter(row=>ids.includes(row.id));
      if(workspace)result=result.filter(row=>row.workspace_id===workspace);
      const jsonFilter = [...url.searchParams.entries()].find(([name])=>name.startsWith('document->>'));
      if(jsonFilter) {
        const field=jsonFilter[0].slice('document->>'.length);
        const value=jsonFilter[1].replace(/^eq\./,'');
        result=result.filter(row=>String(row.document[field] ?? '')===value);
      }
      return response(result.map(clone));
    }
    if (url.pathname.endsWith('/rpc/gh_commit_changes')) {
      if (failNextCommit) { failNextCommit=false; return response('forced write failure',503); }
      const body=JSON.parse(String(init?.body || '{}')) as {p_reads:Array<{collection:string;id:string;revision:number}>;p_operations:Array<{collection:string;id:string;op:string;document?:Record<string,any>}>};
      for(const read of body.p_reads || []) {
        const current=rows.get(key(read.collection,read.id));
        if((current?.revision || 0)!==read.revision)return response('GH_TX_CONFLICT',409);
      }
      for(const operation of body.p_operations || []) {
        const mapKey=key(operation.collection,operation.id);
        const current=rows.get(mapKey);
        if(operation.op==='create' && current)return response('23505 duplicate key value violates unique constraint',409);
        if(operation.op==='update' && !current)return response('missing record',404);
        if(operation.op==='delete'){rows.delete(mapKey);continue;}
        const document=['merge','update'].includes(operation.op)?{...(current?.document || {}),...(operation.document || {})}:clone(operation.document || {});
        rows.set(mapKey,{collection:operation.collection,id:operation.id,workspace_id:String(document.workspace_id || document.freelancer_id || document.user_id || 'admin'),document,revision:(current?.revision || 0)+1});
      }
      return response(true);
    }
    throw new Error(`Unexpected request ${url}`);
  };
  return {rows,fetchMock,failCommit(){failNextCommit=true;}};
}

