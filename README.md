# GIS — ระบบติดตามแหล่งหญ้าทะเล

Monorepo: GIS-api (NestJS), GIS-web (Next.js), PostgreSQL/PostGIS และ GitHub Actions

## Foundation Scope

ขั้น1 มี schema migrations, DB-backed API health และ web process health เท่านั้น ยังไม่มี importer, domain API, login หรือหน้าแผนที่

## Local Run

เปิด Docker Desktop Linux engine แล้วเรียก `docker compose up --build` จาก root; มี local demo defaults ใน Compose และ .env.example

| Service | Endpoint |
|---|---|
| API/PostGIS health | http://localhost:3001/health |
| Web health | http://localhost:3000/health |
| PostgreSQL | localhost:54329 |

Web root ยังไม่มี product page. API รัน versioned migrations ก่อนเปิด HTTP; named volume เก็บข้อมูลข้าม restart ห้ามลบ volume เพื่อแก้ error โดยอัตโนมัติ

## Verification

ตรวจแล้ว: API unit7/7, real PostGIS integration1/1, web readiness1/1, API/web builds, Compose fresh-start/restart และ independent review. Hosted GitHub Actions ยังไม่ได้รัน

Host GIS-api: `npm run test:unit` และ `npm run test:integration` (DATABASE_URL ชี้ test DB); host GIS-web: `npm run test:unit`, `npm run build`, `npm run typecheck`
