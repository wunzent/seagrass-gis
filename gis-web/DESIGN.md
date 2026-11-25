# UI Design System

## Overview

ทิศทาง **Nautical survey chart** พื้นขาวสว่าง ใช้เส้นแบ่งและตัวเลขสำรวจ เอกสารนี้เป็น single source of truth ของธีมเว็บ ถอดค่าจาก code ปัจจุบันโดยไม่ปรับสี basemap raster (OpenStreetMap, Esri ภาพดาวเทียมพร้อมชั้นถนนและชื่อสถานที่) ดู [ARCHITECTURE](ARCHITECTURE.md) สำหรับโครงสร้างโปรแกรม

## Foundations

### Color tokens

Contrast คำนวณจาก hex จริงด้วย WCAG relative luminance: sRGB แต่ละช่อง /255; c≤0.04045 ใช้ c/12.92 มิฉะนั้น ((c+0.055)/1.055)^2.4; L=0.2126R+0.7152G+0.0722B; ratio=(Lสว่าง+0.05)/(Lมืด+0.05) ปัดสองตำแหน่ง คอลัมน์ท้ายเทียบสีทึบกับ `--bg` / `--surface` ไม่ใช่ polygon หลัง blend กับ tile

| Token                      | Hex     | Role / Where used                                   | Contrast bg / surface |
| -------------------------- | ------- | --------------------------------------------------- | --------------------- |
| --bg                       | #FFFFFF | พื้นหลัก, topbar, field, popup, legend, login panel | 1.00 / 1.06           |
| --surface                  | #F6F8FA | login page, muted surface, outline hover            | 1.06 / 1.00           |
| --text                     | #1F2937 | ข้อความหลัก, field, popup                           | 14.68 / 13.79         |
| --text-muted               | #57606A | label, code, metadata, หัวตาราง                     | 6.39 / 6.00           |
| --border                   | #D0D7DE | เส้นแบ่ง/กรอบทั่วไป                                 | 1.45 / 1.36           |
| --input                    | #848D97 | ขอบ input/select                                    | 3.37 / 3.16           |
| --primary                  | #0077B6 | ปุ่มหลัก, link, active nav, focus, survey mark      | 4.87 / 4.57           |
| --primary-soft             | #E6F3FA | selected row, บัญชีสาธิต                            | 1.13 / 1.06           |
| --sea                      | #DCE7EA | พื้นแผนที่ก่อน tile โหลด                            | 1.26 / 1.18           |
| --danger                   | #8F1D1D | validation, error, session notice                   | 8.89 / 8.35           |
| POINT_STROKE               | #0077B6 | ขอบจุด/เส้นแหล่งที่เลือก, จุดที่เลือก               | 4.87 / 4.57           |
| POINT_FILL                 | #FFFFFF | พื้นจุด, ขอบจุดที่เลือก                             | 1.00 / 1.06           |
| SITE_OUTLINE               | #1B2A3A | เส้นขอบ polygon                                     | 14.59 / 13.71         |
| province outline (literal) | #8A7F68 | เส้นประจังหวัด                                      | 3.95 / 3.71           |
| error surface (literal)    | #F7ECE4 | error box / login error                             | 1.16 / 1.09           |
| error border (literal)     | #D9B8A5 | ขอบ error box                                       | 1.85 / 1.74           |
| warning surface (literal)  | #F3E6C8 | basemap warning                                     | 1.24 / 1.16           |
| warning text (literal)     | #4A3A12 | basemap warning                                     | 11.02 / 10.35         |

ค่า literal ยังไม่มี CSS custom property สี primary บนขาวและขาวบน primary = 4.87:1; muted บน surface = 6.00:1 เส้นแบ่งทั่วไป contrast ต่ำกว่าขอบ field โดยตั้งใจ ไม่ใช้สีสถานะอ่อนเป็นตัวหนังสือบนขาว

บัญชีสาธิตใช้ --text (#1F2937) บน --primary-soft (#E6F3FA) คำนวณได้ 12.98:1 ผ่าน WCAG AA สำหรับข้อความปกติ; email/password แต่ละค่าอยู่ใน span ที่ white-space:nowrap จึงไม่ตัดกลางคำ และห่อบรรทัดระหว่างส่วน Email กับ / Pass ได้

### Status colors

ใช้ค่าเฉลี่ย cover_percent ในวันที่สำรวจล่าสุด ไม่ปัดก่อนจัดช่วง ข้อความ range ใน UI คงเดิม เช่น 50 ถึง 74% แต่ขอบเขตคำนวณคือ <75

| Status    | Hex     | ช่วงจริง / Label                | Contrast bg / surface |
| --------- | ------- | ------------------------------- | --------------------- |
| very_good | #1E5A3C | ≥75 / ดีมาก                     | 8.13 / 7.64           |
| good      | #3E8A55 | ≥50 และ <75 / ดี                | 4.22 / 3.97           |
| fair      | #8DBF73 | ≥25 และ <50 / ปานกลาง           | 2.14 / 2.01           |
| poor      | #D9E8B8 | <25 / เสื่อมโทรม                | 1.30 / 1.22           |
| no_data   | #F2EEE4 | ไม่มี survey / ไม่มีข้อมูลสำรวจ | 1.16 / 1.09           |
| hatch ink | #8A8F94 | เส้นทแยงบน no_data              | 3.26 / 3.06           |

Swatch no_data เป็น repeating-linear-gradient 45deg พื้น0–3px หมึก3–4.5px; MapLibre ใช้ภาพ8×8px เงื่อนไข (x+y)%8<2 เป็นหมึก alpha255 พื้น alpha235 ถ้าสร้างภาพไม่ได้ใช้สี no_data แทน สถานะมีข้อความกำกับเสมอ

### Typography

IBM Plex Sans Thai 400/500 ผ่าน next/font/google ที่ src/assets/fonts/fonts.ts, subsets thai/latin, display swap, variable `--font-plex`; fallback Tahoma, sans-serif; self-host ตอน build ตัวเลข .num, code และ round rows ใช้ tabular-nums

| ใช้                                                      | Size               | Weight / Line height                     |
| -------------------------------------------------------- | ------------------ | ---------------------------------------- |
| body                                                     | 15px               | 400 / 1.55                               |
| topbar h1                                                | 1.05rem            | 500 / inherit                            |
| h2/h3                                                    | 0.8rem             | 500 / inherit                            |
| login h1                                                 | 1.3rem             | 500 / inherit                            |
| popup h2                                                 | 1rem               | 500 / leading-snug (CardTitle)           |
| site/table controls, Label, pagination range, popup body | text-sm            | shadcn defaults                          |
| demo accounts box (.demo-accounts)                       | 13px               | 400 / inherit                            |
| session, map warning, table total                        | 0.8rem             | 400 / session-user1.3, อื่น inherit      |
| list/map heading containers และ metadata                 | 0.75rem            | 400 / inherit; h2 ภายในยังใช้ 0.8rem/500 |
| site code/meta, legend, table header, note               | 0.72rem            | header500, อื่น400 / inherit             |
| dt, rounds h3                                            | 0.7rem             | 400 / inherit                            |
| Button                                                   | text-sm = 0.875rem | 500 / 1.25rem (Tailwind)                 |

### Spacing, Radius, Borders, Elevation

ไม่มี named spacing tokens ใน code ค่าที่ใช้คือ0,2,4,6,7,8,9,10,12,14,16,18,20,24,28px เช่น filter gap10, sidebar padding16/gap18, topbar gap24/padding20, facts gap8×12, table padding16/20/24 ใช้ค่าจาก selectors ไม่แปลงเป็น scale ใหม่

Legend และ login panel ใช้ radius 6px ส่วน Button, Input, Select, Tabs และ Card ใช้ radius/spacing ตาม shadcn Base Nova เส้นแบ่งใช้ border และ input ใช้ token --input สีของ focus มาจาก --ring

Popup ใช้พื้นและขอบจาก shadcn Card และ Select ใช้ shadow-md สำหรับเมนูที่ลอยเหนือ controls

### Iconography and Motion

Select/Pagination ใช้ lucide-react สำหรับ chevrons ระบุทิศทางและ check ระบุค่าที่เลือก (aria-hidden); login คง inline SVG mail/eye ใน src/assets/icons/login-icons.tsx (aria-hidden); ปุ่มตาใช้ชื่อคงที่ แสดงรหัสผ่าน และ aria-pressed ระบุสถานะ ปิด popup ใช้ Lucide X พร้อม aria-label ปิด, survey ใช้วงกลม, status ใช้ swatch+ข้อความ Navigation/Scale เป็น MapLibre controls เดิม

Button ใช้ transition และ hover จาก shadcn Base Nova Skeleton ไม่มี animation Map fitBounds duration500ms padding48 maxZoom14 Code ไม่ประกาศ prefers-reduced-motion override ของตัวเองและไม่ส่ง essential:true ให้ fitBounds การลด motion ของกล้องขึ้นกับ MapLibre ยังไม่มี browser proof ใน T026 จึงไม่อ้างว่ารองรับทุก animation แล้ว

## Layout

Desktop ≥768px: app สูง100svh, topbar min56px; main flex/scroll แนวตั้ง; map-layout grid `352px minmax(0,1fr)` เพื่อให้ pagination อยู่ในแถวเดียว min-height480px; sidebar scroll; map/table เป็น view ของ route / เดียว แผนที่คง instance เมื่อซ่อนด้วย view-hidden

Mobile ≤767px รวม375px: topbar wrap ชื่อและ session ก่อน เมนูเต็มแถวล่าง; app height auto/min100svh; sidebar อยู่เหนือ map padding12; map-container70svh; table padding12 และ filter field กว้าง100%; table scroll แนวนอนเฉพาะ .table-scroll Login panel กว้าง100% max420px padding24; login page padding24px 16px

Map overlays: warning/status relative z2; legend absolute right10 bottom28 z3; popup absolute z5 กว้าง min(300px,100%−16px) scroll ภายใน เริ่ม translate8px/8px แล้ว SiteMap จัดตำแหน่งตาม anchor/ขอบ8px โดยนับพื้นที่ใต้ warning และ gap14pxด้วย MapLibre controls อยู่ใน control containers ของ library ไม่มี app z-index override

แปลงอ้างอิง (ขั้น 9) ใช้เส้นสี muted `#57606A` กว้าง 1.15 px ที่ opacity 0.65 ใต้ polygon ของแหล่งเพื่อให้สีสถานะอ่านง่าย ปุ่มใน legend ใช้ outline ขนาด sm มีสัญลักษณ์เส้นและ `aria-pressed` เริ่มปิดและแสดงได้ตั้งแต่ zoom 7

## Components

Controls ใช้ focus-visible ring ของ shadcn และ heading ที่รับ focus ใช้ outline

| Component / Anatomy                                                   | Tokens                                                       | States / Accessibility                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button                                                                | primary, background, border, ring                            | ใช้ default, sm, icon หรือ icon-sm ตาม component; ใช้ขนาดของ shadcn ตามที่เจ้าของขอ                                                                                                                                                                                                            |
| Input/Select + Label                                                  | background, input, ring                                      | ใช้ขนาดมาตรฐานของ shadcn, placeholder muted, filter validation alert                                                                                                                                                                                                                           |
| Filter group: province/status/search/reset/error                      | background, muted, input, primary, danger                    | search max200 debounce300ms; reset ใช้ Button link sm; invalid filters หยุดคำขอใหม่                                                                                                                                                                                                            |
| Site list item: code, status, ghost Button ชื่อแหล่ง                  | background, muted, accent, border                            | hover ใช้ bg-muted, selected ใช้ bg-accent และ aria-pressed; คืน focus ไปแถวเดิม                                                                                                                                                                                                               |
| Table + Pagination                                                    | background, muted, border, primary                           | th scope col; เปิด map popup เมื่อเลือกชื่อ; ปิด pagination controls ระหว่างโหลดหรือ validation; ขอบหน้าใช้ disabled และคืน focus ไปปุ่มอื่นหรือสถานะหน้า                                                                                                                                      |
| Site popup: CardHeader, CardAction, CardContent                       | card, text, muted, border, status                            | title wrap ในคอลัมน์ของตัวเอง; detail/history error retry แยก; Escape/close คืน focus; shared URL ใน table เปิดรายละเอียดในแท็บตาราง                                                                                                                                                           |
| Popup arrow                                                           | card, border                                                 | ลูกศรสี่เหลี่ยมหมุน 45° ชี้ anchor ซ่อนเมื่อไม่มีตำแหน่ง                                                                                                                                                                                                                                       |
| Survey popup: CardHeader, CardAction, CardContent, CardFooter         | card, muted, primary                                         | cover/species/note/coordinates; creator เมื่อมีใน payload; footer เปิดรายละเอียดแหล่ง                                                                                                                                                                                                          |
| Legend: 5 statuses + survey toggle                                    | background, border, muted, status/primary                    | swatch aria-hidden; Toggle จุดสำรวจมี aria-pressed และคำอธิบายกฎซูม                                                                                                                                                                                                                            |
| Scale/Navigation: library controls                                    | MapLibre stylesheet, metric                                  | bottom-left metric; top-right zoom ไม่มี compass; semantics ของ library; ไม่มี custom busy/error state                                                                                                                                                                                         |
| Login: title/subtitle + roles + form + return link                    | surface/bg/text/muted, primary/danger/field-border           | กล่องบัญชีสาธิตกดเพื่อกรอกฟอร์ม (ไม่มีปุ่ม login ตาม role); ปุ่ม disabled ระหว่าง checking/busy/logoutPending; validation focus ช่องแรกผิด, server error focus summary; clear password หลังส่ง; signed-in ไม่ redirect                                                                         |
| Demo accounts: ul/li/button + strong email/password                   | primary-soft/text, radius6, 13px                             | บัญชีสาธิตจาก prop accounts ที่ /login สร้างด้วย demoAccounts(env) ใน src/lib/demo-accounts.ts (DEMO_*_PASSWORD, fallback .env.example); กดกรอกเท่านั้น, Admin เริ่มต้น, disabled checking/busy/logoutPending; value spans nowrap; ห่อระหว่าง Email กับ / Pass ได้; เลือกแล้วล้าง field errors |
| Login field: Label, Input, icon Button                                | background, input, ring                                      | Email พร้อมไอคอน; Password ใช้ Button ghost icon, aria-label แสดงรหัสผ่าน และ aria-pressed                                                                                                                                                                                                     |
| Session: checking/account/login link + notice                         | text/muted/primary/danger                                    | checking role status; email/role+logout เมื่อ signed-in; anonymous login link; logoutPending ซ่อน link; rate limit ปิด retry; Alert ของ expiry และ logout ลอยมุมขวาล่างของ viewport พร้อมปุ่มขนาด sm ตามรายละเอียดด้านล่าง                                                                     |
| Notices: shadcn Alert loading/status, error/retry, empty/reset, stale | border skeleton; danger/error surface/border; warning colors | loading/empty ใช้ default Alert role=status, error ใช้ destructive Alert role=alert พร้อมปุ่ม ลองใหม่ เมื่อ retry ได้; live polite/aria-busy; stale ระบุชั้นเดิมที่ไม่ล่าสุด; retry เฉพาะชั้นล้ม; empty แยกจาก failure; basemap warning แยก API failure; ไม่มี animation                       |

## Map styling

| Layer            | Paint / Interaction                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sea / basemap    | sea #DCE7EA; basemap สีเดิมทุกแบบ ไม่มี saturation/contrast/brightness override; attribution ของแต่ละแบบคงอยู่; Label และ Select "แผนที่ฐาน" มุมซ้ายล่าง ซ่อนเมื่อแผนที่เปิดไม่ได้ |
| provinces-line   | #8A7F68 width1.2 dash[3,2] ใต้ sites แม้ไม่มี sites                                                                                                                                |
| sites-fill       | status color opacity0.78                                                                                                                                                           |
| sites-nodata     | hatch opacity0.9 (fallback no_data opacity0.9)                                                                                                                                     |
| sites-line       | SITE_OUTLINE width1.2                                                                                                                                                              |
| selected         | POINT_STROKE width3.5; polygon hover ใช้ pointer ไม่เพิ่ม fill                                                                                                                     |
| surveys-circle   | POINT_FILL radius4.5 stroke POINT_STROKE width1.5 เหนือ polygon                                                                                                                    |
| surveys-hover    | radius7 stroke2 พื้น POINT_FILL                                                                                                                                                    |
| surveys-selected | POINT_STROKE radius6.5 stroke POINT_FILL width2                                                                                                                                    |

เปิดจุดสำรวจที่ซูม ≥12 หรือเฉพาะแหล่งที่เลือกเมื่อซูมต่ำกว่า 12 ปุ่มใน legend ปิดชั้นนี้ได้ทุกระดับ คลิกภายใน 8px เลือกจุดใกล้ที่สุดก่อน polygon; click น้ำว่างปิด popup; popup ตาม anchor เมื่อ pan; selection จากรายการ fitBounds; geometry ใช้ lon,lat

## Token to code mapping

| Token / Rule                                                                                         | Source                                                                                        |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| --bg, --surface, --text, --text-muted, --border, --input, --primary, --primary-soft, --sea, --danger | src/assets/styles/globals.css :root                                                           |
| status colors/ranges/labels, POINT_STROKE, POINT_FILL, SITE_OUTLINE                                  | src/lib/map-state.ts; .swatch-* ใน globals.css ใช้ค่าคู่กัน                                   |
| --font-plex, subsets, weights                                                                        | src/assets/fonts/fonts.ts                                                                     |
| Button variants/sizing/focus/transition                                                              | src/components/ui/button.tsx และ Tailwind defaults                                            |
| typography/spacing/borders/shadow/breakpoint/z-order/notices                                         | src/assets/styles/globals.css                                                                 |
| hatch/province paint/point radii/fitBounds/Scale                                                     | src/features/map/site-map.tsx                                                                 |
| font config / MapLibre CSS / inline SVG                                                              | src/assets/fonts/fonts.ts / src/assets/styles/maplibre.css / src/assets/icons/login-icons.tsx |
| .demo-accounts font-size 13px / demo account values                                                  | src/assets/styles/globals.css / src/lib/demo-accounts.ts ผ่าน src/app/login/page.tsx          |
| components/copy/aria                                                                                 | src/features/map/, src/features/auth/, src/guards/session-guard.tsx                           |

### How to change the theme

1. แก้ค่าในเอกสารนี้พร้อมคำนวณ contrast ตามสูตรข้างต้น แยกสีข้อความ/field-border จากเส้นแบ่ง
2. แก้ :root และ selectors ใน globals.css; สี map/status แก้ map-state.ts, swatch CSS และ literal ใน site-map.tsx คู่กัน อย่าปรับ OSM raster paint หากไม่มี scope ใหม่
3. เปลี่ยน font ใน src/assets/fonts/fonts.ts หรือ Button ใน ui/button; ไม่ใส่ business state ใน shared UI
4. รัน test:unit, typecheck, lint, format:check, build; ตรวจ desktop/375px, keyboard/focus, selected/disabled/error/stale จริงก่อนอ้าง visual acceptance
5. อัปเดต Changelog และอ้าง version จาก wireframes

## shadcn composition and cache

ตามคำขอของเจ้าของ Controls ใช้ขนาดมาตรฐานของ shadcn ยกเลิกข้อกำหนดพื้นที่กดขั้นต่ำ 44 px

ใช้ Button, Pagination, Alert, Select, Input, Label, Tabs, Table, Badge และ Card จาก shadcn CLI 4.23.0 (Base UI / Nova) Tailwind v4 แมปตัวแปรสีของ shadcn ไปยัง palette ของหน้านี้ผ่าน @theme inline และ :root ใน globals.css Badge แสดงสถานะและจำนวนแหล่งในมุมมอง Sidebar, filters, list, map heading และ table ใช้ --background และคั่นด้วยเส้น --border

Pagination ใช้ Select size sm, ช่วง {from}–{to} จาก {total} ขนาด text-sm ตามข้อมูลที่แสดง และ PaginationPrevious/PaginationNext size icon-sm พร้อม aria-label ภาษาไทย ทั้งหมดเรียงแถวเดียวที่ sidebar และตัดขึ้นแถวใหม่บนจอแคบเฉพาะเมื่อพื้นที่ไม่พอ

Session Alert ลอยเหนือแผนที่ที่มุมขวาล่าง ห่างขอบ 16px ที่ viewport 375px กล่องกว้าง 343px และอยู่ห่างขอบทั้งสองด้าน 16px เมื่อเซสชันหมดอายุใช้ default Alert ที่มีไอคอน Info, role=status, หัวข้อ เซสชันหมดอายุ และข้อความ ข้อมูลที่ต้องเข้าสู่ระบบถูกซ่อน กรุณาเข้าสู่ระบบใหม่ ปุ่ม ตกลง ใช้ Button ขนาด sm อยู่ใต้ข้อความและปิด Alert ก่อนเปิด /login เมื่อออกจากระบบไม่สำเร็จใช้ Alert ในตำแหน่งเดียวกันที่มี role=alert พร้อมปุ่มลองอีกครั้งขนาด sm การแสดง Alert ไม่ย้าย focus

Geometry requests snap bbox ออกสู่ grid 0.25 องศา และ debounce 600ms. Cache อยู่ใน memory ต่อ map-store, TTL 5 นาที, สูงสุด 200 entries รวมทั้งสองชั้นข้อมูลแบบ LRU; key รวม layer/bbox/filters. เปลี่ยน filters หรือ session identity ล้างทั้ง cache และ clear() ใช้กับ writes ในอนาคตได้. Pan กลับหรือ pan เล็กใน snapped bbox เดิมใช้ข้อมูลเดิม; พื้นที่ grid ใหม่ยังส่ง bbox query. Loading/error ยังคง stale notice ของชั้นข้อมูลเดิม และไม่แสดง cache เก่าเป็นผลสำเร็จของ key ใหม่.

## Changelog

| Version | Date       | Change                                                                                                       |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| v1.5    | 2026-11-25 | Controls ใช้ขนาด shadcn, Card popup, พื้น sidebar, URL state และกฎชั้นจุดสำรวจ                               |
| v1.4    | 2026-11-25 | Tailwind v4, shadcn CLI Base Nova และ Session Alert มุมขวาล่าง                                               |
| v1.3    | 2026-11-25 | shadcn Base components, pagination row, expired status Alert และ bounded memory geometry cache               |
| v1.2    | 2026-11-23 | กล่องบัญชีสาธิต 13px และแสดงรหัสผ่านจาก DEMO_*_PASSWORD ของ environment                                      |
| v1.1    | 2026-11-23 | T027 assets รวม styles/fonts/icons; บัญชีสาธิต, Admin เริ่มต้น, outlined notched fields และ password toggle  |
| v1.0    | 2026-11-23 | ถอดค่าธีม bright จาก code ตาม wireframe v0.3 เป็น UI design system แยกจาก root DESIGN.md; ไม่มีการเปลี่ยน UI |
