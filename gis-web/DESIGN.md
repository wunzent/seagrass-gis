# UI Design System

## Overview

ทิศทาง **Nautical survey chart** พื้นขาวสว่าง ใช้เส้นแบ่งและตัวเลขสำรวจ เอกสารนี้เป็น single source of truth ของธีมเว็บ ถอดค่าจาก code ปัจจุบันโดยไม่ปรับสี OpenStreetMap raster ดู [ARCHITECTURE](ARCHITECTURE.md) สำหรับโครงสร้างโปรแกรม

## Foundations

### Color tokens

Contrast คำนวณจาก hex จริงด้วย WCAG relative luminance: sRGB แต่ละช่อง /255; c≤0.04045 ใช้ c/12.92 มิฉะนั้น ((c+0.055)/1.055)^2.4; L=0.2126R+0.7152G+0.0722B; ratio=(Lสว่าง+0.05)/(Lมืด+0.05) ปัดสองตำแหน่ง คอลัมน์ท้ายเทียบสีทึบกับ `--bg` / `--surface` ไม่ใช่ polygon หลัง blend กับ tile

| Token                      | Hex     | Role / Where used                                                  | Contrast bg / surface |
| -------------------------- | ------- | ------------------------------------------------------------------ | --------------------- |
| --bg                       | #FFFFFF | พื้นหลัก, topbar, field, popup, legend, login panel                | 1.00 / 1.06           |
| --surface                  | #F6F8FA | sidebar, login page, outline hover, disabled login input           | 1.06 / 1.00           |
| --text                     | #1F2937 | ข้อความหลัก, field, popup                                          | 14.68 / 13.79         |
| --text-muted               | #57606A | label, code, metadata, หัวตาราง                                    | 6.39 / 6.00           |
| --border                   | #D0D7DE | เส้นแบ่ง/กรอบทั่วไป                                                | 1.45 / 1.36           |
| --field-border             | #848D97 | ขอบ input/select                                                   | 3.37 / 3.16           |
| --primary                  | #0077B6 | ปุ่มหลัก, link, active nav, focus, survey mark                     | 4.87 / 4.57           |
| --primary-soft             | #E6F3FA | selected row, popup close hover, password toggle hover, บัญชีสาธิต | 1.13 / 1.06           |
| --sea                      | #DCE7EA | พื้นแผนที่ก่อน tile โหลด                                           | 1.26 / 1.18           |
| --danger                   | #8F1D1D | validation, error, session notice                                  | 8.89 / 8.35           |
| POINT_STROKE               | #0077B6 | ขอบจุด/เส้นแหล่งที่เลือก, จุดที่เลือก                              | 4.87 / 4.57           |
| POINT_FILL                 | #FFFFFF | พื้นจุด, ขอบจุดที่เลือก                                            | 1.00 / 1.06           |
| SITE_OUTLINE               | #1B2A3A | เส้นขอบ polygon                                                    | 14.59 / 13.71         |
| province outline (literal) | #8A7F68 | เส้นประจังหวัด                                                     | 3.95 / 3.71           |
| error surface (literal)    | #F7ECE4 | error box / login error                                            | 1.16 / 1.09           |
| error border (literal)     | #D9B8A5 | ขอบ error box                                                      | 1.85 / 1.74           |
| warning surface (literal)  | #F3E6C8 | basemap warning                                                    | 1.24 / 1.16           |
| warning text (literal)     | #4A3A12 | basemap warning                                                    | 11.02 / 10.35         |

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

| ใช้                                                    | Size               | Weight / Line height                     |
| ------------------------------------------------------ | ------------------ | ---------------------------------------- |
| body                                                   | 15px               | 400 / 1.55                               |
| topbar h1                                              | 1.05rem            | 500 / inherit                            |
| h2/h3                                                  | 0.8rem             | 500 / inherit                            |
| login h1 / close glyph                                 | 1.3rem             | h1 500; close line-height1               |
| popup h2                                               | 0.88rem            | 500 / inherit                            |
| field, list name, table, notice, login label/subtitle  | 0.85rem            | 400 / inherit                            |
| demo accounts box (.demo-accounts)                     | 13px               | 400 / inherit                            |
| popup                                                  | 0.82rem            | 400 / inherit                            |
| pagination, session, map warning, table total          | 0.8rem             | 400 / session-user1.3, อื่น inherit      |
| filter label, list/map heading containers และ metadata | 0.75rem            | 400 / inherit; h2 ภายในยังใช้ 0.8rem/500 |
| site code/meta, legend, table header, note             | 0.72rem            | header500, อื่น400 / inherit             |
| dt, rounds h3                                          | 0.7rem             | 400 / inherit                            |
| Button                                                 | text-sm = 0.875rem | 500 / 1.25rem (Tailwind)                 |

### Spacing, Radius, Borders, Elevation

ไม่มี named spacing tokens ใน code ค่าที่ใช้คือ0,2,4,6,7,8,9,10,12,14,16,18,20,24,28px เช่น filter gap10, sidebar padding16/gap18, topbar gap24/padding20, facts gap8×12, popup body10/12/12, table padding16/20/24 ใช้ค่าจาก selectors ไม่แปลงเป็น scale ใหม่

Radius ของ field, Button, legend, popup, login panel =6px; survey mark50%; ไม่มี radius8px ใน CSS ปัจจุบัน เส้นหลัก1px, topbar/list-heading/table-header1.5px, active nav2px; field ใช้ field-border ส่วนเส้นแบ่งใช้ border; swatch border1px #1B2A3A40; survey mark1.5px primary Focus outline2px offset2 (popup offset−2)

มี shadow เฉพาะ popup: `0 6px 18px #1b2a3a2e` panel/legend ไม่มี shadow

### Iconography and Motion

ไม่มี icon library เพิ่ม ใช้ inline SVG mail/eye ใน src/assets/icons/login-icons.tsx (aria-hidden); ปุ่มตาใช้ชื่อคงที่ แสดงรหัสผ่าน และ aria-pressed ระบุสถานะ ปิด popup ใช้ × พร้อม accessible label, survey ใช้วงกลม, status ใช้ swatch+ข้อความ Navigation/Scale เป็น MapLibre controls เดิม

Button transition-colors ใช้ Tailwind default150ms cubic-bezier(0.4,0,0.2,1); hover default brightness95 Skeleton ไม่มี animation Map fitBounds duration500ms padding48 maxZoom14 Code ไม่ประกาศ prefers-reduced-motion override ของตัวเองและไม่ส่ง essential:true ให้ fitBounds การลด motion ของกล้องขึ้นกับ MapLibre ยังไม่มี browser proof ใน T026 จึงไม่อ้างว่ารองรับทุก animation แล้ว

## Layout

Desktop ≥768px: app สูง100svh, topbar min56px; main flex/scroll แนวตั้ง; map-layout grid `272px minmax(0,1fr)` min-height480px; sidebar scroll; map/table เป็น view ของ route / เดียว แผนที่คง instance เมื่อซ่อนด้วย view-hidden

Mobile ≤767px รวม375px: topbar wrap ชื่อและ session ก่อน เมนูเต็มแถวล่าง; app height auto/min100svh; sidebar อยู่เหนือ map padding12; map-container70svh; table padding12 และ filter label กว้าง100%; table scroll แนวนอนเฉพาะ .table-scroll Login panel กว้าง100% max420px padding24; login page padding24px 16px

Map overlays: warning/status relative z2; legend absolute right10 bottom28 z3; popup absolute z5 กว้าง min(300px,100%−16px) scroll ภายใน เริ่ม translate8px/8px แล้ว SiteMap จัดตำแหน่งตาม anchor/ขอบ8px โดยนับพื้นที่ใต้ warning และ gap14pxด้วย MapLibre controls อยู่ใน control containers ของ library ไม่มี app z-index override

## Components

ทุกแถวใช้ global focus-visible outline; Button ใช้ ring2/offset2 แทน ไม่มี states เพิ่มจาก code

| Component / Anatomy                                        | Tokens                                                                               | States / Accessibility                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button: native button + children                           | primary/white หรือ border/bg/text, radius6, min44, px16 py8                          | default/outline เท่านั้น ไม่มี size variants; hover brightness95 หรือ surface; active/error ไม่มี override; disabled pointer-events none/opacity50; aria-disabled opacity50/cursor-not-allowed; busy เป็น label+disabled จาก caller                                                            |
| Input/Select: label + native control                       | bg/text/field-border, radius6; filter padding6×9 min40; login padding8×44×8×10 min44 | hover/active ไม่มี override; focus global; placeholder muted; login disabled input และ label ใช้ surface; required/autocomplete/aria-invalid/describedby; filter validation alert                                                                                                              |
| Filter group: province/status/search/reset/error           | surface, muted, field-border, primary, danger                                        | search max200 debounce300ms; error ยกเลิก commit; reset min44; pending หยุด resource ใหม่แต่ไม่ปิด fields; labels ครบ                                                                                                                                                                          |
| Site list item: li/button + code/status + swatch/name      | muted, border, primary-soft                                                          | min48, hover underline ชื่อ; selected aria-pressed+soft background; native keyboard; focus ref กลับแถว; loading rows หายแต่ nav instances คงเดิม                                                                                                                                               |
| Table: toolbar + scroll + table + pagination               | text/muted/border/primary                                                            | th scope col; name button min44; numeric right/tabular; เปิด map popup เมื่อเลือก; nav aria-disabled ระหว่างโหลด/validation กัน activation; ขอบหน้าใช้ disabled และย้าย focus ไปปุ่มที่ใช้ได้หรือสถานะหน้า                                                                                     |
| Site popup: dialog + sticky heading/close + facts + rounds | bg/text/muted/border, status, shadow                                                 | non-modal aria-labelledby/busy; เปิดทันทีตอนโหลด; detail/history error retry แยก; detail404 ปิดและ notice, history404 ไม่ flash retry; empty ใช้ ไม่มี; list/table focus heading, map click ไม่ย้าย focus; Escape/close คืน focus เมื่ออยู่ใน popup; ไม่ trap focus                            |
| Survey popup: heading + facts + site action                | bg/text/muted/primary, shadow                                                        | cover/species/note/coordinates; creator เมื่อมีใน payload; click ไม่ request เพิ่ม; selected point ทึบ; เปิดรายละเอียดแหล่งเปลี่ยน popup; focus/close เช่น site                                                                                                                                |
| Legend: group heading + ul/li + swatch/point               | bg/border/muted, status/primary                                                      | 5สถานะ+จุดสำรวจ; swatch aria-hidden มี label/range; ไม่มี hover/active/disabled/busy/error states                                                                                                                                                                                              |
| Scale/Navigation: library controls                         | MapLibre stylesheet, metric                                                          | bottom-left metric; top-right zoom ไม่มี compass; semantics ของ library; ไม่มี custom busy/error state                                                                                                                                                                                         |
| Login: title/subtitle + roles + form + return link         | surface/bg/text/muted, primary/danger/field-border                                   | Viewer/Editor/Admin เมื่อ discovery200; group aria-busy, ปุ่ม disabled ระหว่าง checking/busy/logoutPending; validation focus ช่องแรกผิด, server error focus summary; clear password หลังส่ง; signed-in ไม่ redirect                                                                            |
| Demo accounts: ul/li/button + strong email/password        | primary-soft/text, radius6, min44, 13px                                              | บัญชีสาธิตจาก prop accounts ที่ /login สร้างด้วย demoAccounts(env) ใน src/lib/demo-accounts.ts (DEMO_*_PASSWORD, fallback .env.example); กดกรอกเท่านั้น, Admin เริ่มต้น, disabled checking/busy/logoutPending; value spans nowrap; ห่อระหว่าง Email กับ / Pass ได้; เลือกแล้วล้าง field errors |
| Login field: label บนขอบ + input + icon/toggle             | bg/field-border, primary focus, radius6, min44                                       | Email พร้อม decorative SVG; Password พร้อมปุ่มตา type=button, aria-label คงที่ แสดงรหัสผ่าน และ aria-pressed ระบุสถานะ; validation/summary เดิม                                                                                                                                                |
| Session: checking/account/login link + notice              | text/muted/primary/danger                                                            | checking role status; email/role+logout เมื่อ signed-in; anonymous login link; logoutPending ซ่อน link; rate limit ปิด retry; alert+retry source เดิม; ไม่มี JWT ใน UI/store                                                                                                                   |
| Notices: status/skeleton, alert/retry, empty/reset, stale  | border skeleton; danger/error surface/border; warning colors                         | loading status/live polite/aria-busy; stale ระบุชั้นเดิมที่ไม่ล่าสุด; retry เฉพาะชั้นล้ม; empty แยกจาก failure; basemap warning แยก API failure; ไม่มี animation                                                                                                                               |

## Map styling

| Layer            | Paint / Interaction                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------- |
| sea / basemap    | sea #DCE7EA; OSM สีเดิม ไม่มี saturation/contrast/brightness override; attribution คงอยู่ |
| provinces-line   | #8A7F68 width1.2 dash[3,2] ใต้ sites แม้ไม่มี sites                                       |
| sites-fill       | status color opacity0.78                                                                  |
| sites-nodata     | hatch opacity0.9 (fallback no_data opacity0.9)                                            |
| sites-line       | SITE_OUTLINE width1.2                                                                     |
| selected         | POINT_STROKE width3.5; polygon hover ใช้ pointer ไม่เพิ่ม fill                            |
| surveys-circle   | POINT_FILL radius4.5 stroke POINT_STROKE width1.5 เหนือ polygon                           |
| surveys-hover    | radius7 stroke2 พื้น POINT_FILL                                                           |
| surveys-selected | POINT_STROKE radius6.5 stroke POINT_FILL width2                                           |

คลิกภายใน8px เลือกจุดใกล้ที่สุดก่อน polygon; click น้ำว่างปิด popup; popup ตาม anchor เมื่อ pan; selection จากรายการ fitBounds; geometry ใช้ lon,lat

## Token to code mapping

| Token / Rule                                                                                                | Source                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| --bg, --surface, --text, --text-muted, --border, --field-border, --primary, --primary-soft, --sea, --danger | src/assets/styles/globals.css :root                                                           |
| status colors/ranges/labels, POINT_STROKE, POINT_FILL, SITE_OUTLINE                                         | src/lib/map-state.ts; .swatch-* ใน globals.css ใช้ค่าคู่กัน                                   |
| --font-plex, subsets, weights                                                                               | src/assets/fonts/fonts.ts                                                                     |
| Button variants/sizing/focus/transition                                                                     | src/components/ui/button.tsx และ Tailwind defaults                                            |
| typography/spacing/borders/shadow/breakpoint/z-order/notices                                                | src/assets/styles/globals.css                                                                 |
| hatch/province paint/point radii/fitBounds/Scale                                                            | src/features/map/site-map.tsx                                                                 |
| font config / MapLibre CSS / inline SVG                                                                     | src/assets/fonts/fonts.ts / src/assets/styles/maplibre.css / src/assets/icons/login-icons.tsx |
| .demo-accounts font-size 13px / demo account values                                                         | src/assets/styles/globals.css / src/lib/demo-accounts.ts ผ่าน src/app/login/page.tsx          |
| components/copy/aria                                                                                        | src/features/map/, src/features/auth/, src/guards/session-guard.tsx                           |

### How to change the theme

1. แก้ค่าในเอกสารนี้พร้อมคำนวณ contrast ตามสูตรข้างต้น แยกสีข้อความ/field-border จากเส้นแบ่ง
2. แก้ :root และ selectors ใน globals.css; สี map/status แก้ map-state.ts, swatch CSS และ literal ใน site-map.tsx คู่กัน อย่าปรับ OSM raster paint หากไม่มี scope ใหม่
3. เปลี่ยน font ใน src/assets/fonts/fonts.ts หรือ Button ใน ui/button; ไม่ใส่ business state ใน shared UI
4. รัน npm run styles, test:unit, typecheck, lint, format:check, build; ตรวจ desktop/375px, keyboard/focus, selected/disabled/error/stale จริงก่อนอ้าง visual acceptance
5. อัปเดต Changelog และอ้าง version จาก wireframes; tailwind.css เป็น generated output

## Changelog

| Version | Date       | Change                                                                                                       |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| v1.2    | 2026-11-23 | กล่องบัญชีสาธิต 13px และแสดงรหัสผ่านจาก DEMO_*_PASSWORD ของ environment                                      |
| v1.1    | 2026-11-23 | T027 assets รวม styles/fonts/icons; บัญชีสาธิต, Admin เริ่มต้น, outlined notched fields และ password toggle  |
| v1.0    | 2026-11-23 | ถอดค่าธีม bright จาก code ตาม wireframe v0.3 เป็น UI design system แยกจาก root DESIGN.md; ไม่มีการเปลี่ยน UI |
