const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseCsv,reportCsv,firstOccurrences}=require('../../dist/database/seeders/import-formats');
const {validateGeometry,validateSurvey}=require('../../dist/common/validation/geometry.validation');
test('CSV preserves quoted newlines and physical starting line',()=>{
  assert.deepEqual(parseCsv('a,b\r\n"one\nline","a""b"\r\nx,y\r\n'),[
    {line:1,values:['a','b']},{line:2,values:['one\nline','a"b']},{line:4,values:['x','y']}]);
  assert.throws(()=>parseCsv('a,b\n"bad,x'),/CSV/);
});
test('duplicate first occurrence includes invalid first rows',()=>{
  assert.deepEqual(firstOccurrences(['x','x','y','x']),[true,false,true,false]);
});
test('report CSV escapes formulas commas quotes and newlines',()=>{
  assert.equal(reportCsv([{source_file:'=bad',row:2,key:'a,b',reason_code:'INVALID',reason:'a"\nb'}]),
    'source_file,row,key,reason_code,reason\r\n"\'=bad","2","a,b","INVALID","a""\nb"\r\n');
});
test('domain rejects bad coordinates rings real dates cover species',()=>{
  assert.throws(()=>validateGeometry({type:'Point',coordinates:[Infinity,0]},'point'));
  assert.throws(()=>validateGeometry({type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1]]]},'polygon'));
  assert.throws(()=>validateGeometry({type:'Point',coordinates:[0,91]},'point'));
  const base={lon:'99',lat:'8',surveyed_on:'2026-02-28',cover_percent:'0',species:'EA'};
  assert.equal(validateSurvey(base,new Set(['EA']),'2026-11-21').cover,0);
  for(const change of [{surveyed_on:'2026-02-30'},{surveyed_on:'2026-11-22'},{cover_percent:''},{cover_percent:'NaN'},{cover_percent:'101'},{species:'XX'}])
    assert.throws(()=>validateSurvey({...base,...change},new Set(['EA']),'2026-11-21'));
});
test('year zero and conflicting explicit CRS are rejected before SQL',()=>{
  assert.throws(()=>validateSurvey({lon:'99',lat:'8',surveyed_on:'0000-01-01',cover_percent:'50',species:'EA'},new Set(['EA']),'2026-11-21'));
  assert.throws(()=>validateGeometry({type:'Point',coordinates:[99,8],crs:{type:'name',properties:{name:'EPSG:32647'}}},'point'));
});
