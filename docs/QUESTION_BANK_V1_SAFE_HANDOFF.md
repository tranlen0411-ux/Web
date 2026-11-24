# QUESTION BANK V1 SAFE HANDOFF — FINAL STATUS
**Mã phiên chốt**: `R2-B6G-PHASE29J-CLOSEOUT`  
**Thời điểm bàn giao**: `2026-11-18T08:45:00+07:00`  
**Workspace**: `D:\Cacduanweb\Web-qb-clone-preview-isolated`  
**Branch hiện hành**: `preview/qb-clone-button-v1` (PR #164)  
**Trạng thái Git**: Ahead `origin/main` by 9 commits. Toàn bộ các file candidate/test nội bộ được cô lập ở trạng thái untracked, KHÔNG commit/push.  
**Cơ sở dữ liệu Production mục tiêu**: Exam Builder Production `szptvqkoiphrhlionfoh`  
**Bảng Production xác thực**: `public.question_bank_versions`

---

## I. TỔNG HỢP HIỆN VẬT MIGRATION CHÍNH THỨC & CANDIDATES (SHA-256 RAW BYTES)

Tất cả các tệp SQL ứng viên và tệp Migration chính thức đều được bảo toàn nguyên vẹn, đóng băng tuyệt đối:

| STT | Tên tệp SQL / Migration | Đường dẫn lưu trữ | Dung lượng (Bytes) | SHA-256 RAW BYTES | Mục đích & Trạng thái |
| :---: | :--- | :--- | :---: | :---: | :--- |
| **0** | `20261115164000_question_bank_v1_unified_dual_head_release.sql` | `supabase/migrations/` | **35,736** | `7597F99412774124CDAB611B47C2274545357A87D224F9D7067B833EFA329B57` | **MIGRATION CHÍNH THỨC V1**: DDL Dual-Head, Backfill, Khóa lạc quan OCC, Bộ 6 RPCs hoàn chỉnh. Đã vá `RETURNING published_version_id`. |
| **1** | `candidate_rpc_qb_list_questions_p57.sql` | `tests/` | **13,137** | `F19010C42626D8176459E7B641EF9AAAF5FD50C63683005B8C16668510809840` | Phân trang, alias, ACL service_role, chống rò rỉ đề nháp |
| **2** | `candidate_rpc_qb_fork_question_prod.sql` | `tests/` | **8,493** | `B2BD648F5C12CC57388A4EB71932061DA9CE1702D4D8A2C52B63029D1A4DE044` | Bản Fork chuẩn Production schema (bảo vệ historical version) |
| **3** | `candidate_rpc_qb_fork_question_p57d.sql` | `tests/` | **8,369** | `049EC09C3AD31F42A9DB30A77237507F9B93B91661F703BAE4E001FB29EE9EA0` | Bản Fork chuẩn Staging schema (hỗ trợ metadata) |
| **4** | `candidate_rpc_qb_list_questions_p56e.sql` | `tests/` | **13,138** | `812A38B5F9CE60AA1E2BCB71495F6FAA4101344741E7F1A536ED71ED18E1E586` | Bản List baseline trước khi điều chỉnh ACL P57 |
| **5** | `candidate_rpc_qb_update_item_metadata_phase29g_patch.sql` | `tests/` | **8,564** | `6AC6C3A7F4BE12318B4786A015509B8B5256247F80CD71DEE8BFDBA9559F0635` | Bản vá sửa lỗi HTTP 500 Phase 29E (đã hợp nhất vào migration chính thức số 0). |

---

## II. TỔNG HỢP KẾT QUẢ CÁC BÀI KIỂM THỬ THỰC NGHIỆM P58A – P58F

Tất cả các bài kiểm thử đều được thực thi trên môi trường PGlite cô lập:

1. **P58A (`tests/question_bank_pglite_p58a_lifecycle_gate.test.mjs`)**:
   - **Kết quả**: **13/13 PASS**.
   - **Phát hiện cốt lõi**: Xác minh lỗ hổng vòng đời phiên bản: khi tạo V2 trên Item đã published, V2 lập tức bị phơi bày trên List, Fork và Student Read do schema V1 dùng chung `current_version_id`.
2. **P58B (Preflight kiến trúc)**:
   - **Kết quả**: Xác minh cơ chế snapshot bất biến của Exam Builder (`exam_questions` và `app_private.exam_answer_keys`), học sinh làm bài thi không bị ảnh hưởng khi Question Bank đổi version.
3. **P58C (`tests/question_bank_pglite_p58c_version_security.test.mjs`)**:
   - **Kết quả**: **14/14 PASS**.
   - **Phát hiện cốt lõi**: Xác nhận tên bảng Production là `public.question_bank_versions`. Chứng minh `rpc_qb_get_student_question` baseline bị rò rỉ V2 khi truyền hoặc không truyền `p_version_id`. Chứng minh mô hình Dual-Head chặn đứng rò rỉ.
4. **P58D (`tests/question_bank_pglite_p58d_backfill_integrity.test.mjs`)**:
   - **Kết quả**: **13/13 PASS**.
   - **Phát hiện cốt lõi**: Phân loại dữ liệu backfill (`SAFE_TO_BACKFILL`, `AMBIGUOUS_REQUIRES_REVIEW`, `INVALID_DATA`). Chứng minh Composite Foreign Key ngăn chặn 100% việc trỏ nhầm version của Item khác.
5. **P58E (`tests/question_bank_pglite_p58e_final_preflight.test.mjs`)**:
   - **Kết quả**: **15/15 PASS**.
   - **Phát hiện cốt lõi**: Chứng minh lỗi `SQLSTATE 42830` khi thiếu UNIQUE trên bảng versions. Xác nhận số liệu Production (18 items: 3 published đều `version_count = 1` $\rightarrow$ zero ambiguity). Chứng minh rủi ro lộ V2 nếu tách rời bước triển khai (cần Single Atomic Transaction).
6. **P58F (`tests/question_bank_pglite_p58f_atomic_release.test.mjs`)**:
   - **Kết quả**: **10/10 PASS**.
   - **Phát hiện cốt lõi**: Phát hiện khiếm khuyết của `ON DELETE SET NULL` (cố gán `id = NULL` gây lỗi `SQLSTATE 23502`). Hiệu chỉnh sang **`ON DELETE RESTRICT` (`SQLSTATE 23001`)** để bảo vệ tính bất biến của lịch sử đề thi.

---

## III. KẾT QUẢ TÍCH HỢP THỰC TẾ STAGING (PHASE 29H) & PGLITE (PHASE 29J)

### 1. Kết quả kiểm thử tích hợp Staging (`rcqgxmcqolxbrahhyxji`):
- **Tạo nháp v1 & Xuất bản v1**: Thành công, `version_count = 1`, `published_version_id = v1`.
- **Tạo nháp v2 (Dual-Head)**: Thành công, `version_count = 2`, `current_version_id = v2`, trong khi `published_version_id` vẫn bảo toàn trỏ vào `v1`. Con trỏ phát hành và con trỏ soạn thảo tách biệt tuyệt đối.
- **Xuất bản v2 với Mẫu công khai (`public_template`)**: Khắc phục triệt để lỗi HTTP 500 của Phase 29E. Giao diện Vercel Preview hiển thị toast thành công, lưu đúng `visibility = 'public'`. Cả hai con trỏ hội tụ về `v2`. Lịch sử `v1` được bảo toàn nguyên vẹn.
- **Bảo mật phân quyền học sinh (Live Student HTTP Test)**:
  - Gọi HTTP GET thực tế từ tài khoản học sinh: **HTTP 200 OK**.
  - Học sinh nhận đúng đề bài v2 mới xuất bản và đủ 4 phương án lựa chọn.
  - **Zero Sensitive Field Leaks**: Không phát hiện bất kỳ trường đáp án nhạy cảm nào (`answer_key`, `correct_answers`, `scoring_guide`) trong phản hồi.
  - Khi học sinh truy cập trái phép vào endpoint soạn thảo (`/authoring`): Hệ thống trả về **HTTP 403 Forbidden**.
- **Bảo toàn Fixture Staging**: Fixture `7218cb34-0a65-4f4e-a4e0-6945f1e2c713` được giữ nguyên trạng thái trên Staging phục vụ nghiệm thu, không xóa hoặc thay đổi trong giai đoạn này.

### 2. Kết quả kiểm thử PGlite Offline (Phase 29J):
- `tests/question_bank_pglite_p69_production_dual_head_validation.test.mjs`: **16/16 PASS (100%)**.
- `tests/question_bank_p29g_publish_contract_regression.test.mjs`: **11/11 PASS (100%)**.
- **Tổng cộng**: **27/27 test cases đạt 100% PASS**.
- Kiểm tra nạp trực tiếp file migration `20261115164000` vào PGlite: DDL, Backfill, Unique constraint, Composite FK, OCC Concurrency guard và Response Contract đều thành công hoàn hảo.

---

## IV. BẢN VÁ RPC `rpc_qb_update_item_metadata` (SECTION 2.5)

Trong Phase 29J-B, hàm `public.rpc_qb_update_item_metadata` đã được cập nhật có kiểm soát để hoàn thiện hợp đồng phản hồi Zero-Trust:
1. **Bổ sung RETURNING**: Thêm `published_version_id` vào mệnh đề `UPDATE ... RETURNING visibility, status, published_version_id INTO v_updated_visibility, v_updated_status, v_updated_published_id;`.
2. **Giá trị thực tế sau ghi đĩa**: Phản hồi JSON trả về `'published_version_id', v_updated_published_id` phản ánh đúng dữ liệu đã ghi xuống bảng, loại trừ rủi ro lệch biến PL/pgSQL.
3. **Bảo toàn hợp đồng an ninh**: Giữ nguyên 100% cơ chế OCC Concurrency Guard (`CONFLICT` khi sai `expected_version_id`), RBAC, Ownership Gate, `SECURITY DEFINER`, và `search_path = 'pg_catalog', 'public', 'pg_temp'`.
4. **Tương thích Visibility**: Mệnh đề `CASE` ánh xạ chuẩn Production (`'public'` $\rightarrow$ `'public_template'`, `'school'` $\rightarrow$ `'school_shared'`) khớp 100% với constraint trên Exam Builder Production `szptvqkoiphrhlionfoh`: `CHECK (visibility = ANY (ARRAY['private', 'school_shared', 'public_template']))`.

---

## V. CÁC GIỚI HẠN KIỂM THỬ ĐÃ BIẾT (KNOWN TESTING LIMITATIONS)

1. **Staging không thay thế Production**: Môi trường Staging và Production có sự khác biệt về dữ liệu thực tế và dải mạng. Kết quả thành công trên Staging là điều kiện cần, nhưng vẫn bắt buộc phải chạy Preflight Check trước khi apply Production.
2. **Chưa có Network Log chi tiết của lần Publish v2**: Thao tác xuất bản v2 trên Vercel Preview đã được xác nhận qua UI toast và đối soát trực tiếp database Staging, nhưng chưa capture raw HTTP HAR log từ trình duyệt người dùng.
3. **Chưa triển khai lên Production**: Toàn bộ mã nguồn DDL và RPC Dual-Head V1 chưa được áp dụng lên cơ sở dữ liệu `szptvqkoiphrhlionfoh`.
4. **Chưa kiểm tra trực tiếp biến môi trường Two-Project**: 5 biến môi trường `CORE_*` và `QUESTION_BANK_*` cần được kiểm tra xác nhận trên hosted dashboard của Supabase trước khi kích hoạt router v1.
5. **Không khẳng định Zero Risk**: Mọi thao tác DDL trên Production đều tiềm ẩn rủi ro khóa bảng (lock contention) nếu có truy vấn người dùng đang chạy dài. Do đó cơ chế `lock_timeout = '3s'` là bắt buộc để fail-closed an toàn.

---

## VI. BẢNG GHI NHẬN CÁC BLOCKER KỸ THUẬT & TRẠNG THÁI HIỆN TẠI

| STT | Tên Blocker | Mô tả chi tiết kỹ thuật | Trạng thái hiện tại | Hướng xử lý tiếp theo |
| :---: | :--- | :--- | :---: | :--- |
| **B-01** | **BFF Query Parameter Defense** | Lọc query param `?version_id` đối với role `student`. | ✅ **ĐÃ GIẢI QUYẾT** | Xác minh ở Phase 29H: Học sinh bị chặn 403 trên authoring, sanitize an toàn. |
| **B-02** | **Full RPC Migration Assembly** | Đóng gói migration hoàn chỉnh DDL + 6 RPCs + vá response contract. | ✅ **ĐÃ GIẢI QUYẾT** | Hoàn tất trong Phase 29J-B (`20261115164000`, SHA-256: `7597F994...`). |
| **B-03** | **Staging vs Production Parity** | Lệch ràng buộc visibility (`public` vs `public_template`). | ✅ **ĐÃ GIẢI QUYẾT** | Đồng bộ toàn tuyến: BFF adapter + RPC CASE statement tự động thích ứng. |
| **B-04** | **Controlled Reversal / Rollback** | Nghiêm cấm `DROP COLUMN` khi có sự cố. | ✅ **ĐÃ CÓ KỊCH BẢN** | Áp dụng Logical Rollback (Forward Recovery): Cập nhật RPC về Single-Head, bảo toàn cột. |
| **B-05** | **Two-Project Environment Variables** | Cần đủ 5 biến `CORE_*` và `QUESTION_BANK_*` trên Edge Runtime. | ⚠️ **CẦN XÁC MINH TRÊN DASHBOARD** | Kiểm tra trên Dashboard của `szptvqkoiphrhlionfoh` trước khi switch traffic. |
| **B-06** | **Preflight Lock Timeout Verification** | Đảm bảo không bị treo bảng do transaction người dùng giữ lock. | ⚠️ **CẦN CHẠY PREFLIGHT TRƯỚC DEPLOY** | Chạy kịch bản test lock với `lock_timeout = '3s'` trên Production trước khi chạy DDL. |
| **B-07** | **Production Migration History Audit** | Xác minh bảng `schema_migrations` chưa có timestamp trùng. | ✅ **ĐÃ XÁC MINH** | Xác nhận timestamp `20261115164000` là duy nhất và chưa từng tồn tại trên Production. |

---

## VII. ĐIỂM TIẾP TỤC SAU NÀY (EXACT RESUMPTION POINT)

Khi tiến hành đợt phát hành Production Question Bank V1, kỹ sư thực hiện theo đúng trình tự:
1. **Bước 1**: Đọc tài liệu này, kiểm tra mã băm file `supabase/migrations/20261115164000_question_bank_v1_unified_dual_head_release.sql` phải đúng `7597F99412774124CDAB611B47C2274545357A87D224F9D7067B833EFA329B57`.
2. **Bước 2**: Chạy Preflight Lock Check với `lock_timeout = '3s'` trên Production `szptvqkoiphrhlionfoh`.
3. **Bước 3**: Tạo snapshot backup dữ liệu (`supabase db dump --data-only`) cho 3 bảng `question_bank_*`.
4. **Bước 4**: Kiểm tra đủ 5 biến môi trường Two-Project trên Edge Runtime.
5. **Bước 5**: Trình Thầy phê duyệt lệnh áp dụng migration bằng Supabase CLI.

---

## VIII. TRẠNG THÁI CÁC MỐC CHẶN AN TOÀN (SAFETY GATES STATUS)
- `STOP_BEFORE_GIT_ADD`: **TUÂN THỦ 100% (CHƯA STAGE)**
- `STOP_BEFORE_COMMIT`: **TUÂN THỦ 100% (ZERO COMMITS)**
- `STOP_BEFORE_PUSH`: **TUÂN THỦ 100% (ZERO PUSHES)**
- `STOP_BEFORE_MERGE`: **TUÂN THỦ 100% (PR #164 REMAINS IN DRAFT)**
- `STOP_BEFORE_DEPLOY`: **TUÂN THỦ 100% (ZERO DEPLOYS)**
- `STOP_BEFORE_DATABASE_WRITE`: **TUÂN THỦ 100% (ZERO DB WRITES)**
- `STOP_BEFORE_PRODUCTION`: **TUÂN THỦ 100% (ZERO PROD ACCESS)**
- `STOP_BEFORE_FIXTURE_CLEANUP`: **TUÂN THỦ 100% (FIXTURE 7218cb34 BẢO TOÀN)**
