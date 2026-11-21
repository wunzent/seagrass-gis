# gis-api

API ระบบติดตามแหล่งหญ้าทะเล (NestJS + PostgreSQL/PostGIS) เอกสาร SWC, Docker Compose และ seed-data อยู่ใน [gis-docs](https://gitlab.com/gis450547/gis-docs)

## Workspace

clone `gis-api`, `gis-web`, `gis-docs` ไว้ในโฟลเดอร์เดียวกัน; Compose ใน `gis-docs` build จาก `../gis-api` ดูขั้นตอนเต็มที่ `gis-docs/docs/swc/LOCAL-DEVELOPMENT.md`

## Host Development

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm ci --ignore-scripts
npm run build
npm start
```

`.env` (ignored) ตั้ง `PORT=3002`, `DATABASE_URL` ไป PostGIS ของ Compose ที่ `localhost:54329` และ `SEED_DATA_DIR=../gis-docs/seed-data`, `IMPORT_REPORT_DIR=../gis-docs/reports` ค่าใน `.env.example` เป็น demo-only ตรวจที่ `http://localhost:3002/health`

## Tests

`npm run test:unit`, `npm run test:import:unit`; integration (`npm run test:integration`, `npm run test:import:integration`) ต้องกำหนด `DATABASE_URL`/`IMPORT_TEST_DATABASE_URL` ไปฐานข้อมูลทดสอบแยกจากข้อมูลใช้งาน

## CI

`.gitlab-ci.yml`: tests กับ service `postgis/postgis:16-3.5`, build Docker image และ GitLab Secret Detection
