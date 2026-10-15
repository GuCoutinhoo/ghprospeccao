import { OFFICIAL_PLACES_FIELD_MASK, type GooglePlaceRaw } from './places';
export interface PlacesPage { places: GooglePlaceRaw[]; nextPageToken?: string }
export async function searchPage(query:string,key:string,options:{pageToken?:string;lat?:number;lng?:number;radius?:number}={}):Promise<PlacesPage> {
  if(!key)throw new Error('GOOGLE_MAPS_API_KEY_MISSING');
  const body:Record<string,unknown>={textQuery:query,languageCode:'pt-BR',pageSize:20};
  if(options.pageToken)body.pageToken=options.pageToken;
  if(options.lat && options.lng)body.locationBias={circle:{center:{latitude:options.lat,longitude:options.lng},radius:options.radius || 12000}};
  const response=await fetch('https://places.googleapis.com/v1/places:searchText',{
    method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':`${OFFICIAL_PLACES_FIELD_MASK},nextPageToken`},body:JSON.stringify(body),
  });
  if(!response.ok)throw Object.assign(new Error(`PLACES_HTTP_${response.status}`),{status:response.status});
  const data=await response.json() as PlacesPage;
  if(data.places!==undefined && !Array.isArray(data.places))throw new Error('PLACES_INVALID_RESPONSE');
  return {places:data.places || [],nextPageToken:data.nextPageToken};
}
