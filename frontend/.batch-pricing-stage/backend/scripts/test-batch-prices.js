// Fresh scratch database only. No reset, live migration, or shared-test mutation.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
const config=dotenv.config({path:fs.existsSync('.env.test') ? '.env.test' : '.env'}).parsed;
if(!config?.DATABASE_URL || !['localhost','127.0.0.1'].includes(new URL(config.DATABASE_URL).hostname)) throw Error('Require local PostgreSQL connection');
const name=`salonos_batch_test_${process.pid}`;
const connection=new URL(config.DATABASE_URL);const admin=new PrismaClient({datasources:{db:{url:connection.toString()}}});
let created=false;
function run(args,env){const result=spawnSync(process.execPath,args,{env,stdio:'inherit'});if(result.status!==0)throw Error(`Command failed: ${args[0]}`);}
try {
 await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);created=true;connection.pathname=`/${name}`;
 const env={...process.env,...config,DATABASE_URL:connection.toString(),DIRECT_URL:connection.toString(),SALONOS_TEST_DATABASE_URL:connection.toString()};
 const schema=fs.readFileSync('prisma/schema.prisma','utf8').replace('provider      = "prisma-client-js"','provider      = "prisma-client-js"\n  output = "../node_modules/.batch-pricing-client"');
 fs.writeFileSync('prisma/batch-test.prisma',schema);
 run(['node_modules/prisma/build/index.js','generate','--schema','prisma/batch-test.prisma'],env);
 run(['node_modules/prisma/build/index.js','migrate','deploy'],env);
 run(['prisma/seed.js'],env);
 run(['node_modules/vitest/vitest.mjs','run','--config','vitest.batch-pricing.config.js'],env);
} finally {
 if(created) await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
 await admin.$disconnect();
 if(fs.existsSync('prisma/batch-test.prisma')) fs.unlinkSync('prisma/batch-test.prisma');
}
