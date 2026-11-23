# DESIGN — Seagrass GIS

**Date**: 2026-11-23 · **Scope**: assessment steps 1–6 + 9.5 CI · หลักฐานจริงอยู่ที่ [WORK-STATUS](docs/WORK-STATUS.md)

## Architecture

repository เดียว `wunzent/seagrass-gis` branch `main`; clone `https://github.com/wunzent/seagrass-gis.git` แล้วรัน Compose จาก root; CI ใช้ GitHub Actions ที่ `.github/workflows/ci.yml`

`gis-web` (Next.js, MapLibre) → proxy `/api/*` → `gis-api` (NestJS, `pg`) → PostgreSQL 16 + PostGIS 3.5 รันด้วย Docker Compose บนเครื่อง local (loopback เท่านั้น) API รัน migrations แบบ versioned/checksum และ importer ก่อนรับ HTTP ไม่มี schema synchronize

## Geometry, SRID and Indexes

- ทุก geometry เก็บเป็น SRID 4326: `provinces.geom`, `sites.geom` เป็น `MultiPolygon` (รับ Polygon แล้ว normalize เป็น MultiPolygon), `surveys.geom` เป็น `Point`; GeoJSON ใช้ลำดับ `[lon, lat]`
- GiST index บน `geom` ของ provinces, sites, surveys; unique partial index `sites(code) WHERE deleted_at IS NULL`; index `surveys(site_id, surveyed_on DESC, id DESC)` สำหรับ status และ history
- bbox query ใช้ `ST_Intersects(geom, ST_MakeEnvelope(..., 4326))` ซึ่งกรองด้วย GiST ก่อน; ระยะ 50 m ของ survey ใช้ `ST_DWithin(geography)` จึงได้หน่วยเมตรจริง
- `area_rai = ST_Area(geom::geography) / 1600` ปัด 2 ตำแหน่งตอนตอบ; จังหวัดของ site คือจังหวัดที่ intersection บน geography ใหญ่สุด (เสมอ → code น้อยสุด) ถ้าไม่มี positive-area intersection กับจังหวัดใด → 422 `OUTSIDE_COVERAGE`

## Invalid Geometry and Missing CRS

- ไม่ซ่อม geometry: ตรวจ shape (finite, lon ±180, lat ±90, ring ปิด ≥4 จุด) แล้ว `ST_IsValid AND NOT ST_IsEmpty AND ST_Area(geography) > 0` ไม่ผ่าน → importer ปฏิเสธพร้อมเขียนเหตุผลใน `reports/import_report.csv`, API ตอบ 400 `INVALID_GEOMETRY`
- CRS: ถ้าไม่ระบุ `crs` ถือเป็น WGS84 ตาม GeoJSON (RFC 7946) แต่พิกัดต้องอยู่ในช่วง lon/lat จึงไม่รับค่า UTM ที่ไม่ระบุ CRS; ถ้าระบุต้องเป็น EPSG:4326/CRS84 ไม่เช่นนั้นปฏิเสธ `INVALID_CRS` ไม่ reproject และไม่ relabel ไฟล์ UTM (`seagrass_large_utm.zip` ยังไม่ import)
- Import: first occurrence ของ code/ref ชนะ, แถวผิดถูกข้าม (seed: รับ 310 / ปฏิเสธ 29), รันซ้ำข้าม key เดิมโดยไม่ทับการแก้ไขผ่าน API; source files ไม่ถูกแก้

## Concurrency

- Site: `PATCH /sites/:code` ต้องส่ง `version`; transaction ล็อกแถว (`FOR UPDATE`) แล้วเทียบ version → ไม่ตรงตอบ 409 `VERSION_CONFLICT` พร้อม `details.current`; สำเร็จ version + 1 (มี e2e race ที่ได้ [200, 409])
- Survey write ล็อก parent site ที่ยัง active ด้วย `FOR SHARE` ก่อนตรวจ 50 m กับ geometry ที่ commit แล้ว; DELETE/PATCH site ใช้ `FOR UPDATE` ลำดับ lock เสมอ site → survey จึงไม่มี survey ค้างบน site ที่ถูกลบ และ DELETE site ที่ยังมี survey ตอบ 409 `SITE_HAS_SURVEYS`
- Survey ไม่มี version (last-write-wins ต่อ field) — ข้อจำกัดที่ยอมรับ

## Authentication

- `POST /auth/login` คืน JWT (HS256 อายุ 900 วินาที) ใน `access_token` ตามโจทย์ข้อ 5.1 และตั้ง HttpOnly cookie `gis_access` ค่าเดียวกัน (`SameSite=Lax`); API รับได้ทั้ง `Authorization: Bearer` และ cookie; หน้าเว็บใช้ cookie อย่างเดียวและไม่เก็บ token ใน storage (DEC-14)
- JWT ผูกกับแถว `access_sessions`; logout revoke session ฝั่ง server cookie เดิมที่ถูก replay ได้ 401; ไม่มี refresh token
- CSRF: ทุก POST/PATCH/DELETE (รวม login/logout) ต้องมี Origin ตรง allowlist, `X-CSRF-Protection: 1` และไม่ใช่ `Sec-Fetch-Site: cross-site`; ลำดับตรวจ 401 → 403 role → 403 CSRF → validation → lookup
- Roles: viewer อ่าน (เห็นผู้บันทึก), editor แก้ชื่อ site และ CRUD survey, admin สร้าง/แก้ geometry/ลบ site; anonymous ไม่เห็น `created_by`

## Status Calculation

คำนวณตอนอ่าน ไม่เก็บใน DB: ใช้ AVG(`cover_percent`) ของทุก survey ในวันที่สำรวจล่าสุด (MAX `surveyed_on`) ของ site ไม่ปัดก่อนเทียบ: ≥75 `very_good`, ≥50 `good`, ≥25 `fair`, <25 `poor`, ไม่มี survey `no_data` จึงอัปเดตทันทีหลังเขียน survey

## Strategy for 500k Polygons within 2 Seconds (Proposal — not implemented or benchmarked)

ปัจจุบันมี 27 sites; เป้าหมาย 2 วินาทีสำหรับ 500,000 polygons ต้องใช้ tiles ตาม viewport/zoom และวัดผลจริง แนวทางต่อไปนี้เป็นข้อเสนอ ยังไม่มีผลวัด

1. คง bbox query + GiST และบังคับ bbox ทุกคำขอแผนที่ (ทำแล้วใน `/sites.geojson`, `/surveys.geojson`) เพิ่มเพดานจำนวน feature ต่อคำขอ
2. Vector tiles (`ST_AsMVT` หรือ tile server) ตาม zoom แทน GeoJSON ก้อนใหญ่; ใช้ geometry ที่ simplify ล่วงหน้าต่อระดับ zoom (`ST_SimplifyPreserveTopology` เก็บเป็นคอลัมน์/ตารางแยก) และ full geometry เฉพาะ zoom สูงหรือ detail
3. ตารางและการค้นหาใช้ pagination (มีแล้ว สูงสุด 100/หน้า) และพิจารณา keyset pagination เมื่อข้อมูลโต; status ล่าสุดอาจเก็บเป็น materialized/summary table ที่อัปเดตตอนเขียน survey
4. Cache tiles/lookup ด้วย HTTP cache หรือ CDN โดยล้างตาม version ของข้อมูล; import ขนาดใหญ่ใช้ `COPY` + background job
5. วัดผลด้วย `EXPLAIN ANALYZE` และ load test ก่อนอ้างตัวเลข

## Remaining Work and Next-Day Plan

- ทำแล้วเพิ่มเติม: workflow GitHub Actions สำหรับ tests และ image builds พร้อม แต่ hosted run ยัง Pending; fresh code/security review ทุกงานแก้ครบ, owner pre-UAT, หน้าแผนที่ออกแบบใหม่ (popup แหล่งพร้อมประวัติสรุปรอบ, popup จุดสำรวจ, หน้าตาราง) และปุ่มเข้าสู่ระบบตาม role สำหรับสาธิต (`DEMO_LOGIN_ENABLED` ค่าตั้งต้นปิด)
- ยังไม่ทำ: แนบรูปผลสำรวจ (ข้อเสริมขั้นที่ 4), Senior ขั้นที่ 3/6/7/8 (overlap, SURVEYS_OUTSIDE, reference UTM, layer list, URL state, วาด/แก้บนแผนที่, dashboard/export), ขั้นที่ 9 ข้ออื่นนอกจาก CI ดู [DEFERRED](docs/swc/DEFERRED.md)
- ถ้ามีเวลาอีก 1 วัน: (1) ขั้นที่ 7 เพิ่ม/แก้/ลบผลสำรวจจาก popup บนแผนที่ (API พร้อมแล้ว เหลือ UI + Playwright) (2) layer list และเก็บสถานะใน URL (3) vector tiles ตามข้อเสนอด้านบนพร้อมวัดผล
