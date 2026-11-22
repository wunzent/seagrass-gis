# gis-api

API ระบบติดตามแหล่งหญ้าทะเล (NestJS + PostgreSQL/PostGIS, `pg` ไม่มี ORM) เอกสาร SWC, Docker Compose, seed-data, [DESIGN](https://gitlab.com/gis450547/gis-docs/-/blob/feat/seagrass-monitoring/DESIGN.md) และ `api-examples.http` อยู่ใน [gis-docs](https://gitlab.com/gis450547/gis-docs)

## Workspace

clone `gis-api`, `gis-web`, `gis-docs` ไว้ในโฟลเดอร์เดียวกัน; Compose ใน `gis-docs` build จาก `../gis-api` ดูขั้นตอนเต็มที่ `gis-docs/docs/swc/LOCAL-DEVELOPMENT.md`

## Layout

```text
migrations/          SQL migrations แบบ versioned + checksum (รันก่อนเปิด HTTP)
api-docs/            OpenAPI ที่ generate จากโค้ด (openapi.yaml, paths/, components/)
src/
  core/              config, database, seeders (importer), logger, CoreModule
  shared/            decorators, dto, errors, filters, openapi, pipes, types, validators
  auth/ sites/ surveys/ lookups/ health/   feature modules (controller, service, repository, dto, entities)
  main.ts migrate.ts import.ts docs.ts     entry points
test/                *.e2e-spec.ts (real PostGIS), helpers.ts
```

Unit specs (`*.spec.ts`) อยู่ข้างไฟล์ที่ทดสอบใน `src/`

## Host Development

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm ci --ignore-scripts
npm run build
npm start
```

`.env` (ignored) ตั้ง `PORT=3002`, `DATABASE_URL` ไป PostGIS ของ Compose ที่ `localhost:54329`, `SEED_DATA_DIR=../gis-docs/seed-data`, `IMPORT_REPORT_DIR=../gis-docs/reports`, `JWT_SECRET`, `PUBLIC_WEB_ORIGIN`, `API_DOCS_ORIGIN` และ `DEMO_*_PASSWORD` ค่าใน `.env.example` เป็น demo-only ตรวจที่ `http://localhost:3002/health` และ Swagger ที่ `/docs`

| Script                                    | ใช้ทำอะไร                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run build` / `npm start`             | compile ด้วย Nest CLI แล้วรัน `dist/main.js` (migrate + import แล้วเปิด HTTP) |
| `npm run start:dev`                       | watch mode                                                                    |
| `npm run migrate` / `npm run import`      | รัน migrations หรือ importer แยก                                              |
| `npm run docs:generate`                   | build แล้วเขียน `api-docs/` ใหม่จาก decorators                                |
| `npm run format` / `npm run format:check` | Prettier                                                                      |

## Demo Quick Login (T022)

สำหรับสาธิตบนเครื่อง local ตั้ง `DEMO_LOGIN_ENABLED=true` ใน environment ของ API แล้วเริ่ม API ใหม่
(ต้องมีผู้ใช้ `viewer@demo.local`, `editor@demo.local`, `admin@demo.local` จาก demo seeder เดิม)
`GET /auth/demo-login` คืนรายการ role; `POST /auth/demo-login` รับเฉพาะ `{ "role": "viewer" | "editor" | "admin" }`
พร้อม Origin ที่อนุญาตและ `X-CSRF-Protection: 1` เช่นเดียวกับ login เดิม แล้วตั้ง HttpOnly cookie อายุ 900 วินาที
ทุก response ใช้ `Cache-Control: no-store`; ไม่รับรหัสผ่านและไม่คืน token ใน JSON
POST ใช้ rate limiter เดิมแยก key `demo:<role>` โดยล้างตัวนับเมื่อเข้าสู่ระบบสำเร็จ จึงนับเฉพาะความล้มเหลว (ค่าเริ่มต้น 10 ครั้ง/15 นาทีต่อ role)
และเพิกถอน session เดิมใน cookie เมื่อสร้าง session ใหม่สำเร็จ

ค่าเริ่มต้น `DEMO_LOGIN_ENABLED=false`; ยอมรับเฉพาะข้อความ `true` ตัวพิมพ์เล็กเท่านั้น ค่าอื่นหรือไม่ตั้งถือว่าปิด:
ทั้งสอง endpoint ตอบ 404 `NOT_FOUND` ก่อนตรวจ CSRF/body (image Docker รันด้วย `NODE_ENV=production` จึงใช้ flag นี้เป็นสวิตช์เดียว)
ให้คงค่า `false` สำหรับการใช้งานจริง เพราะเมื่อเปิดผู้เข้าถึง API จะเข้าเป็น admin ได้
`POST /auth/login` เดิมยังทำงานเหมือนเดิม

## Tests

Jest รันโหมด ESM (`node --experimental-vm-modules`) ต้องรันจากโฟลเดอร์ `gis-api/`

| Script                              | ขอบเขต                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm test` หรือ `npm run test:unit` | unit specs ใน `src/` ไม่ใช้ DB                                                                           |
| `npm run test:integration`          | e2e กับ PostGIS จริง ยกเว้น import; ต้องตั้ง `DATABASE_URL`                                              |
| `npm run test:import:unit`          | importer unit                                                                                            |
| `npm run test:import:integration`   | importer กับ PostGIS จริง; ต้องตั้ง `IMPORT_TEST_DATABASE_URL` ไปฐานแยกจาก API suites (ไม่ตั้ง → exit 1) |

Integration suites ล้างตาราง จึงยอมรับเฉพาะฐานที่ชื่อมีคำว่า `test` เป็นคำเต็ม เช่น `gis_api_test`, `gis_import_test` (`test/helpers.ts`) ห้ามชี้ไปฐาน `gis` ที่ใช้งาน

## CI

`.gitlab-ci.yml` มี 3 jobs ตามลำดับ: `test` (node 22.18.0 + PostGIS service สองตัว `db`/`db-import`; `npm ci`, `format:check`, `build`, unit, integration, import unit, import integration) → `docker-image` (build Dockerfile ด้วย dind) → `secret_detection` (GitLab template) จำลอง job `test` ใน Docker ผ่านแล้ว; ผล hosted pipeline ยังไม่ได้ตรวจ
