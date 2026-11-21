import {readConfig} from './core/config/config';
import {createPool,migrate} from './core/database/connection';
import {importSeed} from './core/database/seeders/seed-import';
import {AppLogger} from './core/logger/app-logger';

const logger=new AppLogger();

async function main() {
  const pool=createPool(readConfig(process.env).databaseUrl);
  try {await migrate(pool);logger.log(JSON.stringify(await importSeed(pool)));}
  finally {await pool.end();}
}
void main().catch(()=>{logger.error('Seed import failed; check source files, database and report directory');process.exitCode=1;});
