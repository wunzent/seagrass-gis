import {Pool,PoolClient} from 'pg';
import {readFile,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {RowRejection,reject,text,validateGeometry,validateSurvey,validateCrs} from '../domain/validation';
import {parseCsv,reportCsv,ReportRow,firstOccurrences} from './formats';

type SourceRow = {file:string;line:number;key:string;data:Record<string,unknown>;geometry?:unknown;crs?:unknown; malformed?:boolean};
type Source = {kind:'provinces'|'species'|'sites'|'surveys';rows:SourceRow[]};
export type ImportSummary = {accepted:number;rejected:number;already_present:number;duplicate:number;source:number};
const actor='00000000-0000-4000-8000-000000000001';

export function importPaths(env:NodeJS.ProcessEnv=process.env) {
  return {seedDir:resolve(env.SEED_DATA_DIR ?? '../seed-data'),reportDir:resolve(env.IMPORT_REPORT_DIR ?? '../reports')};
}
function object(value:unknown):Record<string,unknown> {
  return value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
}
async function loadSources(seedDir:string):Promise<Source[]> {
  const sources:Source[]=[];
  for(const [kind,file] of [['provinces','provinces.geojson'],['species','species.json'],['sites','seagrass_sites.geojson'],['surveys','surveys.csv']] as const) {
    const raw=await readFile(join(seedDir,file),'utf8');
    if(kind==='surveys') {
      const records=parseCsv(raw),header=records.shift()?.values;
      const expected=['survey_ref','site_code','lon','lat','surveyed_on','cover_percent','species'];
      if(!header || header.length!==expected.length || header.some((v,i)=>v!==expected[i]))throw new Error('Invalid survey CSV header');
      sources.push({kind,rows:records.map(r=>({file,line:r.line,key:r.values[0]??'',data:Object.fromEntries(header.map((h,i)=>[h,r.values[i]??''])),malformed:r.values.length!==header.length}))});
    } else {
      const parsed:unknown=JSON.parse(raw);
      const collection=object(parsed);
      validateCrs(collection.crs);
      const rows=kind==='species'?parsed:collection.features;
      if(!Array.isArray(rows) || (kind!=='species' && collection.type!=='FeatureCollection'))throw new Error(`Invalid source collection: ${file}`);
      sources.push({kind,rows:rows.map((entry,index)=>{
        const feature=object(entry),data=kind==='species'?feature:object(feature.properties);
        return {file,line:index+1,key:typeof data.code==='string'?data.code:'',data,geometry:feature.geometry,crs:feature.crs,malformed:kind!=='species' && feature.type!=='Feature'};
      })});
    }
  }
  return sources;
}
async function spatial(client:PoolClient,geometry:unknown) {
  const serialized=JSON.stringify(validateGeometry(geometry,'polygon'));
  const result=await client.query('SELECT ST_IsValid(g) AND NOT ST_IsEmpty(g) AS valid FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1),4326) AS g) q',[serialized]);
  if(!result.rows[0].valid)reject('INVALID_GEOMETRY','PostGIS rejected invalid or empty geometry');
  const area=await client.query('SELECT ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($1),4326)::geography) > 0 AS positive',[serialized]);
  if(!area.rows[0].positive)reject('INVALID_GEOMETRY','Geometry must have positive geography area');
  return serialized;
}
async function insertRow(client:PoolClient,source:Source,row:SourceRow,knownSpecies:Set<string>):Promise<void> {
  if(row.malformed)reject('INVALID_ROW','Invalid row shape');
  validateCrs(row.crs);
  const d=row.data;
  if(source.kind==='provinces') {
    if(!/^\d{2}$/.test(row.key))reject('INVALID_KEY','Province code must contain two digits');
    const name=text(d.name_th,'name_th');
    const geom=await spatial(client,row.geometry);
    await client.query('INSERT INTO provinces(code,name_th,geom) VALUES($1,$2,ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3),4326)))',[row.key,name,geom]);
  } else if(source.kind==='species') {
    text(row.key,'code',16);
    await client.query('INSERT INTO species(code,name_th,name_sci) VALUES($1,$2,$3)',[row.key,text(d.name_th,'name_th'),text(d.name_sci,'name_sci')]);
    knownSpecies.add(row.key);
  } else if(source.kind==='sites') {
    text(row.key,'code',64); const name=text(d.name,'name');
    const geom=await spatial(client,row.geometry);
    // Only valid geometry reaches geography intersection; ordering is deterministic.
    const match=await client.query(`WITH input AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1),4326) AS g)
      SELECT p.code,ST_Area(i.g::geography)/1600 AS area_rai,
        ST_Area(ST_Intersection(p.geom::geography,i.g::geography)) AS coverage
      FROM provinces p CROSS JOIN input i WHERE ST_Intersects(p.geom,i.g)
      ORDER BY coverage DESC,p.code COLLATE "C" ASC LIMIT 1`,[geom]);
    if(!match.rows.length || Number(match.rows[0].coverage)<=0)reject('NO_PROVINCE','Site has no positive province coverage');
    await client.query(`INSERT INTO sites(id,code,name,province_code,geom,area_rai,created_by,updated_by)
      VALUES($1,$2,$3,$4,ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5),4326)),$6,$7,$7)`,[randomUUID(),row.key,name,match.rows[0].code,geom,match.rows[0].area_rai,actor]);
  } else {
    text(row.key,'survey_ref'); const siteCode=text(d.site_code,'site_code',64);
    const validated=validateSurvey(d as Record<string,string>,knownSpecies);
    const point=JSON.stringify(validated.geom);
    const site=await client.query(`SELECT id, ST_DWithin(geom::geography,ST_SetSRID(ST_GeomFromGeoJSON($2),4326)::geography,50) AS nearby
      FROM sites WHERE code=$1 AND deleted_at IS NULL`,[siteCode,point]);
    if(!site.rows.length)reject('UNKNOWN_SITE','Survey site is missing or deleted');
    if(!site.rows[0].nearby)reject('OUTSIDE_SITE','Survey point is farther than 50 metres from site');
    const inserted=await client.query(`INSERT INTO surveys(survey_ref,site_id,geom,surveyed_on,cover_percent,created_by,updated_by)
      VALUES($1,$2,ST_SetSRID(ST_GeomFromGeoJSON($3),4326),$4,$5,$6,$6) RETURNING id`,[row.key,site.rows[0].id,point,validated.date,validated.cover,actor]);
    for(const species of validated.species)await client.query('INSERT INTO survey_species(survey_id,species_code) VALUES($1,$2)',[inserted.rows[0].id,species]);
  }
}
export async function importSeed(pool:Pool, options=importPaths()):Promise<ImportSummary> {
  const sources=await loadSources(options.seedDir); // missing/malformed whole files are fatal before DB writes
  const summary:ImportSummary={accepted:0,rejected:0,already_present:0,duplicate:0,source:sources.reduce((n,s)=>n+s.rows.length,0)};
  const reports:ReportRow[]=[];
  const client=await pool.connect();
  let transaction=false,locked=false,temp:string|undefined;
  try {
    await client.query('SELECT pg_advisory_lock(73492712)');locked=true;
    await client.query('BEGIN');transaction=true;
    await client.query(`INSERT INTO users(id,email,password_hash,role) VALUES($1,'seed-import@internal.invalid','!disabled-import-system-actor','editor') ON CONFLICT(id) DO NOTHING`,[actor]);
    const identity=(await client.query('SELECT email,password_hash FROM users WHERE id=$1',[actor])).rows[0];
    if(identity.email!=='seed-import@internal.invalid' || identity.password_hash!=='!disabled-import-system-actor')throw new Error('Import actor identity conflict');
    const knownSpecies=new Set<string>((await client.query('SELECT code FROM species')).rows.map(r=>r.code));
    for(const source of sources) {
      const existingSql={provinces:'SELECT code AS key FROM provinces',species:'SELECT code AS key FROM species',sites:'SELECT code AS key FROM sites',surveys:'SELECT survey_ref AS key FROM surveys WHERE survey_ref IS NOT NULL'}[source.kind];
      const existing=new Set<string>((await client.query(existingSql)).rows.map(r=>r.key));
      const first=firstOccurrences(source.rows.map(r=>r.key));
      for(let i=0;i<source.rows.length;i++) {
        const row=source.rows[i];
        if(!first[i]) {
          summary.duplicate++;summary.rejected++;
          reports.push({source_file:row.file,row:row.line,key:row.key,reason_code:'DUPLICATE_KEY',reason:'First source occurrence wins, including invalid first occurrence'});
          continue;
        }
        if(existing.has(row.key)){summary.already_present++;continue;}
        await client.query('SAVEPOINT import_row');
        try {
          await insertRow(client,source,row,knownSpecies);
          await client.query('RELEASE SAVEPOINT import_row');summary.accepted++;
        } catch(error) {
          if(!(error instanceof RowRejection))throw error;
          await client.query('ROLLBACK TO SAVEPOINT import_row');await client.query('RELEASE SAVEPOINT import_row');
          summary.rejected++;
          reports.push({source_file:row.file,row:row.line,key:row.key,reason_code:error.code,reason:error.message});
        }
      }
    }
    await mkdir(options.reportDir,{recursive:true});
    temp=join(options.reportDir,`.import_report.${randomUUID()}.tmp`);
    await writeFile(temp,reportCsv(reports),{encoding:'utf8',flag:'wx'});
    // Replace while the DB transaction is still open: report errors must roll back inserts.
    await rename(temp,join(options.reportDir,'import_report.csv'));temp=undefined;
    await client.query('COMMIT');transaction=false;
    return summary;
  } catch(error) {
    if(transaction)await client.query('ROLLBACK');
    throw error;
  } finally {
    if(temp)await unlink(temp).catch(()=>{});
    try {if(locked)await client.query('SELECT pg_advisory_unlock(73492712)');} finally {client.release();}
  }
}
