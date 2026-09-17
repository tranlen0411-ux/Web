# Tính năng: Học sinh nộp nhiều ảnh bài làm; Giáo viên chấm và ghi chú trực tiếp trên ảnh (Phase 1)

## 1. Tổng quan Kiến trúc Phase 1 Security Correction

Phase 1 thiết lập nền tảng Backend vững chắc và an toàn bảo mật tuyệt đối trong cơ sở dữ liệu Supabase:
- **Hỗ trợ 1-N Attachments cho mỗi Submission**: Học sinh có thể đính kèm nhiều ảnh (JPG, PNG, WebP tối đa 10 MiB) cho từng câu hỏi bài làm.
- **Tính Bất Biến (Immutability) của Ảnh Gốc**: Ảnh gốc được lưu độc bản, không ghi đè, không cho phép học sinh/giáo viên sửa hoặc xóa sau khi nộp.
- **Thu Hồi Quyền Giáo Viên Cũ (Stale Teacher Access Revocation)**: Giáo viên chỉ được xem hoặc chấm bài khi *hiện tại đang phụ trách lớp học* chứa bài làm (hoặc là Admin). Hoàn toàn loại bỏ quyền truy cập chỉ dựa trên tư cách tác giả cũ (`teacher_id = auth.uid()`).
- **Chuẩn Hóa Storage RLS Policies (Chống Dual Permissive Policy Risk & Broadening)**:
  - Bảng `storage.objects` bucket `exercise-submissions` chỉ duy trì đúng **1 INSERT policy duy nhất** (`Exercise submissions student insert policy`) và **1 SELECT policy** (`Exercise submissions select policy`).
  - Toàn bộ các ràng buộc an toàn của Hosted được bảo toàn tuyệt đối: kiểm tra `status IN ('draft', 'revision_requested')`, xác minh `submission_id` tồn tại và thuộc quyền sở hữu của `auth.uid()`, chặn các phần mở rộng nguy hiểm (`.svg`, `.exe`, `.html`, `.js`, `.sh`, `.bat`) và path traversal (`%..%`).
  - Hỗ trợ song song cả đường dẫn cũ (`{uid}/{submission_id}/...`) và cấu trúc mới (`students/{uid}/submissions/{submission_id}/attachments/{attachment_id}/original.{ext}`).
  - Xóa bỏ mọi fallback lỏng lẻo nhằm chống tình trạng mở rộng quyền (permissive broadening).
- **Xác Minh Đối Tượng Storage & Metadata khi Finalize**: Trước khi chuyển attachment sang trạng thái `finalized`, RPC bắt buộc kiểm tra sự tồn tại thực tế của tệp trong `storage.objects`, đồng thời kiểm tra kích thước và MIME type từ `metadata` của Storage.
- **Mô hình Annotation Vector/JSON Append-Only**: Nét vẽ, chữ nhận xét, dấu chấm bài (tick/cross/circle) được lưu dưới dạng JSON vector độc lập. Mỗi lần lưu hoặc hoàn tất chấm bài sẽ sinh ra một phiên bản mới (`version >= 1`), hỗ trợ khôi phục lịch sử và hoàn tác.
- **Kiểm soát Xung đột Phiên bản (Optimistic Concurrency Control - OCC)**: Giáo viên gửi kèm `expected_version`. Nếu có tab hoặc giáo viên khác đã chấm, server tự động trả lỗi `VERSION_CONFLICT` để chống ghi đè dữ liệu.
- **Idempotency Key Deduplication**: Gửi lại cùng `idempotency_key` sẽ nhận lại bản ghi hiện có mà không sinh thêm version rác.
- **Bảo mật RLS & Class Ownership Model**: Cách ly tuyệt đối dữ liệu giữa các lớp và các học sinh.

---

## 2. Phân biệt các Cấp độ Xác thực Tệp Tin (Verification Taxonomy)

| Cấp độ | Nguồn dữ liệu | Cách thức xác thực | Trạng thái Phase 1 |
| :--- | :--- | :--- | :--- |
| **Declared MIME & Size** | Khai báo từ Client khi gọi `prepare` | Kiểm tra whitelist (`image/jpeg`, `image/png`, `image/webp`) và `0 < byte_size <= 10 MiB` | ✅ **VERIFIED** |
| **Storage Metadata MIME & Size** | Metadata do Supabase Storage ghi nhận trong `storage.objects` | RPC `finalize` truy vấn `storage.objects`, so khớp kích thước metadata với khai báo và kiểm tra MIME metadata | ✅ **VERIFIED** (`STORAGE_METADATA_VERIFIED: YES`) |
| **Storage RLS Insertion Security** | Ràng buộc bảo mật tầng Storage Table | Storage RLS policy kiểm tra quyền sở hữu bài nháp, trạng thái `draft`, chặn extension thực thi và chống ghi đè | ✅ **VERIFIED** (`STORAGE_RLS_VERIFIED: YES`) |
| **Binary Content / Magic Bytes** | Dữ liệu nhị phân bên trong tệp ảnh | Phân tích header nhị phân (magic bytes) của tệp nhị phân thô | ⚠️ **NO** (SQL thuần không thể phân tích byte nhị phân thô; cần Edge Function/Worker nếu triển khai) (`BINARY_MAGIC_BYTES_VERIFIED: NO`) |
| **Hosted Storage Verification** | Kiểm thử trực tiếp trên môi trường Supabase Cloud Hosted | Test trên hạ tầng Storage thực tế | ⚠️ **NO** (Đã chạy audit đối chiếu schema read-only; chưa chạy migration/upload thật trên Prod; `HOSTED_STORAGE_BEHAVIOR_VERIFIED: READ_ONLY_AUDITED`) |

---

## 3. Mô hình CSDL (Database Schema)

### 3.1. Bảng `public.academic_submission_attachments`
| Cột | Kiểu dữ liệu | Ràng buộc / Mô tả |
| :--- | :--- | :--- |
| `id` | UUID | Khóa chính |
| `submission_id` | UUID | FK -> `academic_submissions(id)` ON DELETE CASCADE |
| `question_id` | UUID | FK -> `academic_exercise_questions(id)` ON DELETE CASCADE |
| `student_id` | UUID | FK -> `profiles(id)` ON DELETE CASCADE |
| `storage_bucket` | TEXT | Mặc định `'exercise-submissions'` |
| `storage_path` | TEXT | UNIQUE, format `students/{uid}/submissions/{subId}/attachments/{attId}/original.{ext}` |
| `original_file_name`| TEXT | Tên file gốc sạch |
| `mime_type` | TEXT | CHECK `mime_type IN ('image/jpeg', 'image/png', 'image/webp')` |
| `byte_size` | BIGINT | CHECK `byte_size > 0 AND byte_size <= 10485760` (10 MiB) |
| `width` / `height` | INT | Kích thước ảnh (pixels) |
| `sha256` | TEXT | Hash toàn vẹn (tùy chọn) |
| `sort_order` | INT | Thứ tự hiển thị ảnh |
| `upload_status` | TEXT | CHECK `upload_status IN ('pending', 'finalized', 'deleted')` |
| `created_by` | UUID | FK -> `profiles(id)` |
| `created_at` / `finalized_at` | TIMESTAMPTZ | Dấu thời gian khởi tạo / hoàn tất |

### 3.2. Bảng `public.academic_submission_annotation_versions`
| Cột | Kiểu dữ liệu | Ràng buộc / Mô tả |
| :--- | :--- | :--- |
| `id` | UUID | Khóa chính |
| `submission_id` | UUID | FK -> `academic_submissions(id)` ON DELETE CASCADE |
| `attachment_id` | UUID | FK -> `academic_submission_attachments(id)` ON DELETE CASCADE |
| `teacher_id` | UUID | FK -> `profiles(id)` (Giáo viên chấm) |
| `version` | INT | Version tăng dần (`version >= 1`), UNIQUE(`attachment_id`, `version`) |
| `status` | TEXT | CHECK `status IN ('draft', 'final')` |
| `schema_version` | INT | Phiên bản format JSON vector (mặc định 1) |
| `annotation_json` | JSONB | Chứa danh sách strokes, stamps, text notes (Max 512 KiB) |
| `rendered_preview_bucket` / `path` | TEXT | Ảnh preview flattened (tùy chọn) |
| `idempotency_key` | UUID | UNIQUE(`teacher_id`, `idempotency_key`) |
| `created_at` / `updated_at` | TIMESTAMPTZ | Dấu thời gian |

---

## 4. Bộ RPCs Bảo Mật (SECURITY DEFINER + search_path='')

1. `prepare_academic_submission_attachment(p_submission_id, p_question_id, p_original_file_name, p_mime_type, p_byte_size, p_sort_order)`
   - Học sinh gọi để đăng ký upload ảnh mới cho bài nháp.
2. `finalize_academic_submission_attachment(p_attachment_id, p_width, p_height, p_sha256)`
   - Xác nhận hoàn tất upload ảnh: kiểm tra đối tượng thực tế trong `storage.objects`, xác minh size và mime type từ Storage metadata. Idempotent deduplication.
3. `get_academic_submission_grading_workspace(p_submission_id)`
   - Giáo viên (hiện phụ trách lớp) hoặc Admin tải toàn bộ dữ liệu bài làm, câu hỏi, attachments và annotation draft mới nhất.
4. `save_academic_submission_annotation_draft(p_attachment_id, p_annotation_json, p_expected_version, p_idempotency_key, p_schema_version, p_rendered_preview_path)`
   - Giáo viên (hiện phụ trách lớp) lưu bản nháp chấm bài với cơ chế OCC chống xung đột phiên bản và Idempotency deduplication.
5. `finalize_academic_submission_grading_with_annotations(p_submission_id, p_manual_grades, p_annotations, p_teacher_feedback, p_request_revision)`
   - Hoàn tất chấm điểm bài nộp, đánh dấu annotation final, tính tổng điểm và thưởng sao học sinh.
6. `get_student_graded_submission(p_submission_id)`
   - Học sinh xem bài đã chấm kèm nhận xét và bản vẽ chính thức của giáo viên (bản nháp được ẩn an toàn).

---

## 5. Kiểm thử Tự động (PGlite Test Suite - 38 Test Cases)

Toàn bộ 38 kịch bản kiểm tra an toàn & bảo mật trong `tests/academic_submission_image_annotations.test.mjs` đã đạt PASS 100%:
- **Fix 1 Verification**: Thu hồi quyền giáo viên cũ khi chuyển lớp (RLS trả 0 rows, Workspace/Draft/Finalize RPC bị FORBIDDEN; giáo viên mới và Admin được phép).
- **Fix 2 Verification**: Bắt lỗi object không tồn tại, sai bucket, sai path, quá dung lượng metadata, lệch size metadata, sai MIME metadata, lệch MIME metadata, idempotent finalize, chặn cross-student finalize.
- **Fix 3 Verification (Storage RLS Hardening)**: Xác nhận chỉ duy nhất 1 INSERT policy tồn tại (không dual permissive policy); kiểm tra upload draft vs graded trên legacy path và new path; chặn extension nguy hiểm (.svg, .exe, .html, .js, .sh, .bat); chặn cross-student upload; ngăn chặn mở rộng quyền (permissive broadening) vào các thư mục mồ côi.
- **Bảo mật chung**: Chống IDOR/BOLA học sinh và giáo viên chéo lớp; kiểm tra tính bất biến sau nộp bài; OCC version conflict; ẩn bản nháp trước học sinh.
