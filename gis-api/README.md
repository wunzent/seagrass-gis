# gis-api

API ระบบติดตามแหล่งหญ้าทะเล (NestJS + PostgreSQL/PostGIS, `pg` ไม่มี ORM) อยู่ใน repository เดียว `wunzent/seagrass-gis` branch `main`; เอกสาร SWC, Docker Compose, seed-data, [DESIGN](../DESIGN.md) และ [api-examples.http](../api-examples.http) อยู่ที่ root

## Workspace

clone `https://github.com/wunzent/seagrass-gis.git` เพียงครั้งเดียว; รัน `docker compose up -d --build --wait` จาก repository root ซึ่ง build จาก `./gis-api` และ `./gis-web` ดู [Local Development](../docs/swc/LOCAL-DEVELOPMENT.md)

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

รันคำสั่งต่อไปนี้จาก `gis-api/`:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm ci --ignore-scripts
npm run build
npm start
```

`.env` (ignored) ตั้ง `PORT=3002`, `DATABASE_URL` ไป PostGIS ของ Compose ที่ `localhost:54329`, `SEED_DATA_DIR=../seed-data`, `IMPORT_REPORT_DIR=../reports`, `JWT_SECRET`, `PUBLIC_WEB_ORIGIN`, `API_DOCS_ORIGIN` และ `DEMO_*_PASSWORD` ค่าใน `.env.example` เป็น demo-only ตรวจที่ `http://localhost:3002/health` และ Swagger ที่ `/docs`

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
ทุก response ใช้ `Cache-Control: no-store`; ไม่รับรหัสผ่าน; คืน `access_token` และ `token_type: "Bearer"` เช่นเดียวกับ login
POST ใช้ rate limiter เดิมแยก key `demo:<role>` โดยล้างตัวนับเมื่อเข้าสู่ระบบสำเร็จ จึงนับเฉพาะความล้มเหลว (ค่าเริ่มต้น 10 ครั้ง/15 นาทีต่อ role)
และเพิกถอน session เดิมใน cookie รวมถึง Bearer header ที่ส่งมาด้วย เมื่อสร้าง session ใหม่สำเร็จใน transaction เดียวกัน

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

[GitHub Actions](../.github/workflows/ci.yml) ที่ root รันทุก branch push และ pull request: `api-test` ใช้ PostGIS สองฐานแยก `gis_test`/`gis_import_test`; format, build, unit, integration, import unit และ import integration แล้ว `api-image` build ด้วย `docker build --pull ./gis-api` ใช้ Node22.18.0, `npm ci --ignore-scripts` และ npm cache ตาม lockfile; ไม่ push image; รอตรวจ hosted run ของ revision ปัจจุบัน

## JWT และ Bearer (DEC-14)

`POST /auth/login` และ `POST /auth/demo-login` คืน `{access_token, token_type:"Bearer", user, expires_in:900, expires_at}`
พร้อม HttpOnly cookie `gis_access` ที่มี JWT เดียวกัน ใช้ session revocation เดิมและไม่ต่ออายุเมื่ออ่านข้อมูล
client ส่ง `Authorization: Bearer <JWT>` ได้; เมื่อมี header จะเลือก header ก่อน cookie แม้ header ผิดรูปหรือ token ใช้ไม่ได้
จะไม่ fallback และไม่ล้าง cookie เพราะ Bearer ล้มเหลว; public reads ยังคงตอบข้อมูล anonymous ส่วน protected endpoints ตอบ 401

protected writes ที่ยืนยันตัวตนด้วย Bearer ไม่ต้องส่ง Origin/X-CSRF-Protection แต่ยังตรวจ role และสิทธิ์ราย field ตามเดิม
ถ้าใช้ cookie ต้องส่ง Origin ที่อนุญาตและ `X-CSRF-Protection: 1` เสมอ
`POST /auth/login`, `/auth/demo-login`, `/auth/logout` ยังตรวจ CSRF ทุกกรณี
login ทั้งสองแบบเพิกถอน session เดิมจาก cookie และ Bearer header พร้อมสร้าง session ใหม่ใน transaction เดียวกัน
logout เลือกเพิกถอน session จาก header เมื่อมี header มิฉะนั้นเลือก cookie; JWT ที่ถูกเพิกถอนใช้ไม่ได้ทั้งสองช่องทาง
เมื่อ Bearer ใช้ได้และมี cookie session ที่ยังใช้ได้ จะเพิกถอน cookie session ด้วยและส่ง clearing Set-Cookie;
ถ้าไม่มี cookie session ที่ใช้ได้ จะไม่ส่ง clearing Set-Cookie สำหรับ Bearer logout
ถ้า Bearer ใช้ไม่ได้ logout ตอบ 204 โดยไม่ล้าง cookie หรือเพิกถอน session ของ cookie
Swagger `/docs` มีทั้ง cookie และ Bearer security; ห้าม log token

เว็บใช้ cookie อย่างเดียวและเลือกเก็บเฉพาะ safe user กับ expiry โดยไม่เก็บ `access_token` หรือส่ง Authorization
กฎ status ใช้ `src/sites/site-status.ts` เป็นแหล่ง thresholds ร่วมกับ SQL CASE:
75 → very_good, 50 → good, 25 → fair, ต่ำกว่า 25 → poor, null → no_data
เปรียบเทียบค่าเฉลี่ยของ survey ทั้งหมดในวันล่าสุดโดยไม่ปัดเศษก่อน; ปัดเฉพาะค่าที่แสดง
