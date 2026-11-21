# GIS — ระบบติดตามแหล่งหญ้าทะเล

Monorepo: `GIS-api/` (NestJS), `GIS-web/` (Next.js), PostgreSQL/PostGIS และ GitHub Actions

## Current Status

ขั้น1 runtime/migration/healthcheck และขั้น2 importer ผ่าน local tests/Compose และ independent review แล้ว; stack หลักนำเข้าข้อมูลแล้ว ยังไม่มีหน้าแผนที่, domain API หรือ login ที่ใช้งานได้ ดูผลจริงและขั้นถัดไปที่ [WORK-STATUS](docs/WORK-STATUS.md)
แผนทั้งงานอยู่ที่ [SWC](docs/swc/README.md) และ [UAT](docs/swc/UAT.md) ข้อมูลใน `seed-data/` เป็นข้อมูลจำลอง ไม่ใช่ขอบเขตจังหวัด/แหล่งจริง

## Local Run

ต้องมี Docker Desktop ที่เปิด Linux engine และ Docker Compose

```powershell
docker compose up --build
```

คำสั่งข้างต้นเป็น run interface ของขั้น1–2 ดูผล build/start ล่าสุดที่ WORK-STATUS ใช้ `.env.example` เป็นตัวอย่างหากต้องการแก้ค่า local; มีค่า demo-only default จึงไม่จำเป็นต้องสร้าง `.env` ก่อนเปิดครั้งแรก

| Service | Local endpoint |
|---|---|
| API readiness / PostGIS | http://localhost:3001/health |
| Web process readiness | http://localhost:3000/health |
| Database | localhost:54329, database/user `gis` |

Web `/` ยังไม่มี product page ในขั้น1; health route ไม่ใช่แผนที่พร้อมใช้ Ports ผูกกับ loopback เท่านั้น ค่า demo credentials ใช้เฉพาะ local ไม่ใช่ production secrets และห้ามเปิดบริการนี้ออกอินเทอร์เน็ตโดยใช้ค่าเหล่านี้
API จะรัน versioned migration ก่อนรับ HTTP ไม่มี schema synchronize. named volume `seagrass-gis_postgres_data` เก็บฐานข้อมูลข้าม restart; ไม่ลบ volume เพื่อแก้ startup errorโดยอัตโนมัติ

## Verification

```powershell
docker compose config --quiet
curl.exe --fail http://localhost:3001/health
curl.exe --fail http://localhost:3000/health
docker compose restart
```

Local API tests หลังติดตั้ง dependencies (`npm ci --ignore-scripts` ใน `GIS-api/`) ใช้ `npm run test:unit` และ `npm run test:integration`. Integration ต้องกำหนด DATABASE_URL ไปฐานข้อมูลทดสอบที่แยกจากข้อมูลใช้งาน; อย่าใช้ destructive fixtures กับ work database
Web tests ใน `GIS-web/`: `npm run test:unit`, `npm run build`, `npm run typecheck`
GitHub Actions workflow อยู่ `.github/workflows/ci.yml`; actual hosted workflow ยังไม่ผ่านการรันจนกว่าจะมี run evidence ไม่ถือว่า local green เท่ากับ CI green

## Seed Import

API startup เรียก importer หลัง migrations ก่อนเปิด HTTP; อ่าน `seed-data/` แบบ read-only และเขียนรายงาน `reports/import_report.csv`. รันซ้ำด้วยคำสั่งเดียว:

```powershell
docker compose exec api npm run import
```

คำสั่งรันซ้ำข้าม key เดิมโดยไม่ overwrite การแก้ไขหรือฟื้น site ที่ลบ; ไฟล์ UTM zip ยังไม่ import. Summary มี `accepted`, `rejected`, `already_present`, `duplicate`, `source` โดย duplicate รวมอยู่ใน rejected แล้ว. รายงานใช้ feature/array index เริ่ม1 และ physical CSV record start line เริ่ม2 รายละเอียดที่ [Step2 import SWC](docs/swc/BE/step-2-import.md)

ผลไฟล์ต้นฉบับบน proof stack: 339 records รับ310/ปฏิเสธ29; เก็บ provinces3, species6, sites27, surveys274. Import ซ้ำเพิ่ม0; snapshot ข้อมูลก่อน/หลัง restart ตรงกัน. ดู [รายงานรอบแรก](reports/import_report.initial.csv) สำหรับแถวที่ไม่ผ่าน ไม่มีการซ่อมหรือแก้ source. รายงานปัจจุบันจะถูกแทนทุกครั้ง; เก็บรายงานรอบสำเร็จแรกแยกไว้ก่อนรันซ้ำและตรวจ exit code ร่วมกับผลใน DB.

Importer unit tests: `npm run test:import:unit`; real PostGIS tests: `npm run test:import:integration` โดยกำหนด `IMPORT_TEST_DATABASE_URL` ไปฐานข้อมูลแยกชื่อ `gis_import_test`/suffix หรือ CI `gis_test`. ห้ามชี้ fixture tests ไปฐานข้อมูลใช้งาน.

## Authentication Plan

ยังไม่ implement login หรือ seed demo users ในขั้น1. Accepted design: JWT อายุ15นาทีใน HttpOnly cookie, GETme/POSTlogout/session revocation/CSRF, ไม่มี refresh token ดู [AUTH-SESSION](docs/swc/BE/AUTH-SESSION.md)

## Continue Work

อ่าน [AGENTS.md](AGENTS.md) และ [docs/WORK-STATUS.md](docs/WORK-STATUS.md). Checkpoint ระบุผลจริง คำสั่ง และสิ่งค้าง เผื่อ quota/แชตถูกขัดจังหวะ บันทึก `.honeyguide/` เป็น local workflow ที่ไม่ต้อง commit
