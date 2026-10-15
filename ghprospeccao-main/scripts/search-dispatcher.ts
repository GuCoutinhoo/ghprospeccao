import 'dotenv/config';
import { dispatchSearchJobs } from '../src/lib/search/searchWorker';
let stopping=false;
process.on('SIGINT',()=>{stopping=true;});
process.on('SIGTERM',()=>{stopping=true;});
while(!stopping){
  try{await dispatchSearchJobs();}catch{console.error('[worker] Delivery failed; persisted checkpoint retained.');}
  await new Promise(resolve=>setTimeout(resolve,1000));
}
