export type CsvRecord = {line:number; values:string[]};
/** Strict RFC4180 records; line is the physical line where each record starts. */
export function parseCsv(input:string): CsvRecord[] {
  input = input.replace(/^\uFEFF/,'');
  const rows: CsvRecord[]=[];
  let values:string[]=[], value='', quoted=false, closed=false, line=1, start=1, active=false;
  function field() { values.push(value); value=''; closed=false; }
  function record() { field(); rows.push({line:start,values}); values=[]; active=false; }
  for(let i=0;i<input.length;i++) {
    const c=input[i]; active=true;
    if(quoted) {
      if(c==='"') { if(input[i+1]==='"'){ value+='"';i++; } else {quoted=false;closed=true;} }
      else {value+=c; if(c==='\n')line++; else if(c==='\r' && input[i+1]!=='\n')line++;}
      continue;
    }
    if(c===',') {field();continue;}
    if(c==='\r'||c==='\n') {
      if(c==='\r' && input[i+1]==='\n')i++;
      record();line++;start=line;continue;
    }
    if(closed) throw new Error('Malformed CSV after quoted field');
    if(c==='"') {if(value)throw new Error('Malformed CSV quote');quoted=true;}
    else value+=c;
  }
  if(quoted)throw new Error('Unterminated CSV quote');
  if(active || values.length || value)record();
  return rows;
}
export function firstOccurrences(keys:string[]): boolean[] {
  const seen=new Set<string>();
  return keys.map(key=>{const first=!seen.has(key);seen.add(key);return first;});
}
export type ReportRow = {source_file:string; row:number; key:string; reason_code:string; reason:string};
export function reportCsv(rows:ReportRow[]):string {
  const columns = ['source_file','row','key','reason_code','reason'] as const;
  function escape(value:unknown) {
    let s=String(value);
    if(/^[\s\u0000-\u001f]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  }
  return columns.join(',')+'\r\n'+rows.map(row=>columns.map(c=>escape(row[c])).join(',')+'\r\n').join('');
}
