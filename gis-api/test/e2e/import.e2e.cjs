const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createPool,migrate}=require('../../dist/database/connection');
const {importSeed}=require('../../dist/database/seeders/seed-import');
test('zero-geography-area province is rejected and valid rows continue',async()=>{
  const url=process.env.IMPORT_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(url,'Isolated test database required');
  assert.match(new URL(url).pathname,/^\/(?:gis_import_test(?:_[a-z0-9_]+)?|gis_test)$/);
  const pool=createPool(url);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gis-import-area-'));
  const speciesCode=`A${Date.now().toString(36)}`;
  try {
    await migrate(pool);
    const used=new Set((await pool.query('SELECT code FROM provinces')).rows.map(r=>r.code));
    const province=Array.from({length:100},(_,i)=>String(i).padStart(2,'0')).find(c=>!used.has(c));
    assert.ok(province,'An unused province key is required; never reset existing test data');
    const geom={type:'Polygon',coordinates:[[[-180,0],[180,0],[180,1],[-180,1],[-180,0]]]};
    const raw=JSON.stringify(geom);
    const measured=(await pool.query('SELECT ST_IsValid(g) AS valid,ST_Area(g::geography) AS area FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1),4326) AS g) q',[raw])).rows[0];
    assert.equal(measured.valid,true);assert.equal(Number(measured.area),0);
    await fs.writeFile(path.join(dir,'provinces.geojson'),JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{code:province,name_th:'Zero area regression'},geometry:geom}]}));
    await fs.writeFile(path.join(dir,'species.json'),JSON.stringify([{code:speciesCode,name_th:'Valid',name_sci:'Valid continuation'}]));
    await fs.writeFile(path.join(dir,'seagrass_sites.geojson'),JSON.stringify({type:'FeatureCollection',features:[]}));
    await fs.writeFile(path.join(dir,'surveys.csv'),'survey_ref,site_code,lon,lat,surveyed_on,cover_percent,species\r\n');
    const result=await importSeed(pool,{seedDir:dir,reportDir:path.join(dir,'reports')});
    assert.equal(result.rejected,1);
    assert.equal(result.accepted,1);
    assert.equal((await pool.query('SELECT count(*) FROM provinces WHERE code=$1',[province])).rows[0].count,'0');
    assert.equal((await pool.query('SELECT count(*) FROM species WHERE code=$1',[speciesCode])).rows[0].count,'1');
    const report=await fs.readFile(path.join(dir,'reports/import_report.csv'),'utf8');
    assert.match(report,new RegExp(`"provinces.geojson","1","${province}","INVALID_GEOMETRY"`));
  } finally {await pool.end();}
});
test('real PostGIS import, rejections, rerun and preserve edits/deletion',async()=>{
  const url=process.env.IMPORT_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(url,'IMPORT_TEST_DATABASE_URL required (isolated test database)');
  assert.match(new URL(url).pathname,/^\/(?:gis_import_test(?:_[a-z0-9_]+)?|gis_test)$/,'Never run fixtures on work database');
  const pool=createPool(url);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gis-import-'));
  const code=`T${Date.now().toString(36)}`;
  const polygon={type:'Polygon',coordinates:[[[99,8],[99.01,8],[99.01,8.01],[99,8.01],[99,8]]]};
  const feature=(properties,geometry=polygon)=>({type:'Feature',properties,geometry});
  const fc=features=>JSON.stringify({type:'FeatureCollection',features});
  try {
    await migrate(pool);
    // Every run uses new keys; no fixture resets or deletes existing rows.
    const province='00';
    const provinceExists=(await pool.query('SELECT code FROM provinces WHERE code=$1',[province])).rowCount>0;
    await fs.writeFile(path.join(dir,'provinces.geojson'),fc([feature({code:province,name_th:'Test'})]));
    await fs.writeFile(path.join(dir,'species.json'),JSON.stringify([{code,name_th:'Test',name_sci:'Test species'}]));
    await fs.writeFile(path.join(dir,'seagrass_sites.geojson'),fc([
      feature({code:code+'S',name:'Test site'}),
      feature({code:code+'BAD',name:'Invalid'}, {type:'Polygon',coordinates:[[[99,8],[99.01,8.01],[99.01,8],[99,8.01],[99,8]]]}),
      feature({code:code+'BAD',name:'valid duplicate'}),
      feature({code:code+'OUT',name:'Outside province'},{type:'Polygon',coordinates:[[[0,0],[0.01,0],[0.01,0.01],[0,0.01],[0,0]]]})
    ]));
    const csv='survey_ref,site_code,lon,lat,surveyed_on,cover_percent,species\r\n'+[
      [code+'1',code+'S',99.005,8.005,'2025-01-01',50,code],
      [code+'2',code+'S',99.03,8.03,'2025-01-01',50,code],
      [code+'3',code+'S',99.005,8.005,'2025-02-30',50,code],
      [code+'4',code+'S',99.005,8.005,'2025-01-01',101,code],
      [code+'5',code+'S',99.005,8.005,'2025-01-01',50,'UNKNOWN'],
      [code+'6',code+'S',99.0102,8.005,'2025-01-01',50,code], // about 22m outside boundary, accepted
      [code+'7',code+'BAD',99.005,8.005,'2025-01-01',50,code],
    ].map(r=>r.join(',')).join('\r\n');
    await fs.writeFile(path.join(dir,'surveys.csv'),csv);
    const first=await importSeed(pool,{seedDir:dir,reportDir:path.join(dir,'reports')});
    assert.equal(first.accepted,provinceExists?4:5); // province if new, species, site, two surveys
    assert.equal(first.already_present,provinceExists?1:0);
    assert.equal(first.rejected,8);
    assert.equal(first.duplicate,1);
    assert.equal(first.accepted+first.rejected+first.already_present,13);
    const report=await fs.readFile(path.join(dir,'reports/import_report.csv'),'utf8');
    for(const reason of ['INVALID_GEOMETRY','DUPLICATE_KEY','OUTSIDE_SITE','INVALID_DATE','INVALID_COVER','UNKNOWN_SPECIES','NO_PROVINCE','UNKNOWN_SITE'])assert.ok(report.includes(reason));
    const second=await importSeed(pool,{seedDir:dir,reportDir:path.join(dir,'reports')});
    assert.equal(second.accepted,0);assert.equal(second.already_present,5);assert.equal(second.rejected,8);
    const site=(await pool.query('SELECT id,area_rai FROM sites WHERE code=$1',[code+'S'])).rows[0];
    assert.ok(Number(site.area_rai)>0);
    assert.equal((await pool.query('SELECT province_code FROM sites WHERE id=$1',[site.id])).rows[0].province_code,'00');
    await pool.query('UPDATE sites SET name=$2,deleted_at=now() WHERE id=$1',[site.id,'Owner edit']);
    const third=await importSeed(pool,{seedDir:dir,reportDir:path.join(dir,'reports')});
    assert.equal(third.accepted,0);
    assert.equal((await pool.query('SELECT name,deleted_at FROM sites WHERE id=$1',[site.id])).rows[0].name,'Owner edit');
    assert.ok((await pool.query('SELECT deleted_at FROM sites WHERE id=$1',[site.id])).rows[0].deleted_at);
    // A report failure is fatal and cannot leave partial new entity writes.
    await fs.writeFile(path.join(dir,'species.json'),JSON.stringify([{code:code+'NEW',name_th:'New',name_sci:'New'}]));
    await fs.writeFile(path.join(dir,'blocked'),'file');
    await assert.rejects(importSeed(pool,{seedDir:dir,reportDir:path.join(dir,'blocked')}));
    assert.equal((await pool.query('SELECT count(*) FROM species WHERE code=$1',[code+'NEW'])).rows[0].count,'0');
  } finally {await pool.end();} // retained test rows and temporary fixture evidence
});
