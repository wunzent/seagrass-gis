# DESIGN — Seagrass GIS

**Date**: 2026-11-25 · **Scope**: assessment steps 1–6, 9.1 vector tiles, 9.5 CI

## Architecture

`gis-web` (Next.js, MapLibre) → proxy `/api/*` → `gis-api` (NestJS, `pg`) → PostgreSQL 16 + PostGIS 3.5 รันด้วย Docker Compose บนเครื่อง local (loopback เท่านั้น) API รัน migrations แบบ versioned/checksum และ importer ก่อนรับ HTTP ไม่มี schema synchronize; CI ใช้ GitHub Actions

## (a) Geometry, SRID and Indexes

- ทุก geometry เก็บเป็น SRID 4326: `provinces.geom`, `sites.geom` เป็น `MultiPolygon` (รับ Polygon แล้ว normalize เป็น MultiPolygon), `surveys.geom` เป็น `Point`; GeoJSON ใช้ลำดับ `[lon, lat]`
- GiST index บน `geom` ของ provinces, sites, surveys; unique partial index `sites(code) WHERE deleted_at IS NULL`; index `surveys(site_id, surveyed_on DESC, id DESC)` สำหรับ status และ history
- bbox query ใช้ `ST_Intersects(geom, ST_MakeEnvelope(..., 4326))` ซึ่งกรองด้วย GiST ก่อน; ระยะ 50 m ของ survey ใช้ `ST_DWithin(geography)` จึงได้หน่วยเมตรจริง
- ทำไม: เก็บเป็น `geometry` SRID 4326 เพราะตรงกับ GeoJSON/GPS ที่รับส่ง จึงไม่ต้องแปลงพิกัด และ GiST บน geometry ใช้กรอง bbox/intersects ได้เร็ว; แปลงเป็น `geography` เฉพาะตอนคำนวณระยะ/พื้นที่จึงได้หน่วยเมตรจริง
- `area_rai = ST_Area(geom::geography) / 1600` ปัด 2 ตำแหน่งตอนตอบ; จังหวัดของ site คือจังหวัดที่ intersection บน geography ใหญ่สุด (เสมอ → code น้อยสุด) ถ้าไม่มี positive-area intersection กับจังหวัดใด → 422 `OUTSIDE_COVERAGE`

## (b) Invalid Geometry and Missing CRS

- ไม่ซ่อม geometry: ตรวจ shape (finite, lon ±180, lat ±90, ring ปิด ≥4 จุด) แล้ว `ST_IsValid AND NOT ST_IsEmpty AND ST_Area(geography) > 0` ไม่ผ่าน → importer ปฏิเสธพร้อมเขียนเหตุผลใน `reports/import_report.csv`, API ตอบ 400 `INVALID_GEOMETRY`
- GeoJSON ถือเป็น WGS84 ตาม RFC 7946 พิกัดต้องอยู่ในช่วง lon/lat และปฏิเสธ `INVALID_CRS` เมื่อระบุ CRS อื่น ส่วน importer ของ `seagrass_large_utm.zip` ระบุ EPSG:32647 ตามโจทย์และแปลงเป็น EPSG:4326 หลังตรวจ geometry
- Import: first occurrence ของ code/ref ชนะ, แถวผิดถูกข้าม (seed: รับ 310 / ปฏิเสธ 29), รันซ้ำข้าม key เดิมโดยไม่ทับการแก้ไขผ่าน API; source files ไม่ถูกแก้

## (c) Concurrency

- Site: `PATCH /sites/:code` ต้องส่ง `version`; transaction ล็อกแถว (`FOR UPDATE`) แล้วเทียบ version → ไม่ตรงตอบ 409 `VERSION_CONFLICT` พร้อม `details.current`; สำเร็จ version + 1 (มี e2e race ที่ได้ [200, 409])
- Survey write ล็อก parent site ที่ยัง active ด้วย `FOR SHARE` ก่อนตรวจ 50 m กับ geometry ที่ commit แล้ว; DELETE/PATCH site ใช้ `FOR UPDATE` ลำดับ lock เสมอ site → survey จึงไม่มี survey ค้างบน site ที่ถูกลบ และ DELETE site ที่ยังมี survey ตอบ 409 `SITE_HAS_SURVEYS`
- Survey ไม่มี version (last-write-wins ต่อ field) — ข้อจำกัดที่ยอมรับ

## Authentication

- `POST /auth/login` คืน JWT (HS256 อายุ 900 วินาที) ใน `access_token` ตามโจทย์ข้อ 5.1 และตั้ง HttpOnly cookie `gis_access` ค่าเดียวกัน (`SameSite=Lax`); API รับได้ทั้ง `Authorization: Bearer` และ cookie; หน้าเว็บใช้ cookie อย่างเดียวและไม่เก็บ token ใน storage
- JWT ผูกกับแถว `access_sessions`; logout revoke session ฝั่ง server cookie เดิมที่ถูก replay ได้ 401; ไม่มี refresh token
- CSRF: ทุก POST/PATCH/DELETE (รวม login/logout) ต้องมี Origin ตรง allowlist, `X-CSRF-Protection: 1` และไม่ใช่ `Sec-Fetch-Site: cross-site`
- Roles: viewer อ่าน (เห็นผู้บันทึก), editor แก้ชื่อ site และ CRUD survey, admin สร้าง/แก้ geometry/ลบ site; anonymous ไม่เห็น `created_by`

## Status Calculation

คำนวณตอนอ่าน ไม่เก็บใน DB: ใช้ AVG(`cover_percent`) ของทุก survey ในวันที่สำรวจล่าสุด (MAX `surveyed_on`) ของ site ไม่ปัดก่อนเทียบ: ≥75 `very_good`, ≥50 `good`, ≥25 `fair`, <25 `poor`, ไม่มี survey `no_data` จึงอัปเดตทันทีหลังเขียน survey

## (d) Strategy for 500k Polygons within 2 Seconds

ปัจจุบัน API กรอง GeoJSON ด้วย bbox + GiST เว็บ cache แต่ละ layer ตาม bbox ที่ขยายออกเป็นกริด 0.25 องศาและตัวกรอง เก็บใน memory 5 นาที สูงสุด 200 รายการรวมทุก layer แบบ LRU เมื่อเปลี่ยนตัวกรองหรือ session จะล้าง cache ตารางแบ่งหน้าสูงสุด 100 รายการ

ขั้น 9.1 ใช้ Martin ออก MVT ตาม zoom จาก `reference_parcels` (~20k polygons) โดยใช้คอลัมน์ Web Mercator ที่คำนวณตอน import และมี GiST เว็บโหลดผ่าน `/tiles/` และ cache 5 นาที งานนำเข้าแยกจาก API

สำหรับ 500k polygons ให้ simplify ล่วงหน้าตาม zoom (`ST_SimplifyPreserveTopology`) เก็บรูปเต็มสำหรับ zoom สูงและหน้ารายละเอียด กำหนดเพดาน feature ต่อ request และใช้ CDN cache ตาม version ของข้อมูล ใช้ `COPY` กับ background import และ keyset pagination เมื่อข้อมูลโต วัดด้วย `EXPLAIN ANALYZE` และ load test บนชุด 500k ก่อนสรุปว่าเข้าเป้า

## (e) Remaining Work and Next-Day Plan

- ขอบเขต: ขั้นที่ 1–6, vector tiles (9.1) และ CI (9.5) ขั้นที่ 6 รองรับลิงก์แชร์สถานะหน้าและกฎแสดงจุดสำรวจ
- ยังไม่ทำ: แนบรูปผลสำรวจและขั้นที่ 9 ข้อ 2–4
- ถ้ามีเวลาอีก 1 วัน: แนบรูปผลสำรวจ jpg/png ไม่เกิน 5 MB เก็บใน volume และเพิ่ม E2E test ของแผนที่ ตาราง และ login
