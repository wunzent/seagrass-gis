import {readConfig} from './config';
import {createPool,migrate} from './database';
import {importSeed} from './import/runner';

async function main() {
  const pool=createPool(readConfig(process.env).databaseUrl);
  try {await migrate(pool);console.log(JSON.stringify(await importSeed(pool)));}
  finally {await pool.end();}
}
void main().catch(()=>{console.error('Seed import failed; check source files, database and report directory');process.exitCode=1;});
