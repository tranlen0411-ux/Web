# EXAM BUILDER V1 — PHASE 3B ARCHITECTURAL DESIGN & SPECIFICATION
## Student BFF Endpoints: Start Attempt, Save Answer & Submit Attempt (Design & Local Tests)

---

### 1. TỔNG QUAN VÀ MỤC TIÊU (Overview & Goal)

Tài liệu này đặc tả kiến trúc bảo mật Two-Project Architecture cho bộ ba endpoint BFF dành cho Học sinh (Student BFF) của hệ thống Exam Builder V1:
1. **Endpoint 1**: `POST /exam/start-attempt` (Edge Function: `exam-start-attempt`)
2. **Endpoint 2**: `POST /exam/save-answer` (Edge Function: `exam-save-answer`)
3. **Endpoint 3**: `POST /exam/submit-attempt` (Edge Function: `exam-submit-attempt`)

Hệ thống bảo vệ toàn diện dữ liệu đề thi, ngăn chặn tuyệt đối việc rò rỉ đáp án bí mật (`exam_answer_keys`), mạo danh học sinh, mạo danh lớp học, thao túng điểm số, can thiệp file tải lên hoặc chiếm đoạt quyền hạn.

```
+------------------+         +-------------------------------+         +-----------------------+
|  Student Browser | ------> |     Exam Builder Student BFF  | ------> |     NEW Database      |
|  (CORE JWT)      |         |  (Two-Project Security Hub)   |         | (szptvqkoiphrhlionfoh)|
+------------------+         +-------------------------------+         +-----------------------+
                                     |                    ^
                                     | (Verify JWT/Role)  | (Fetch Class/Ownership)
                                     v                    |
                             +-------------------------------+
                             |         CORE Database         |
                             |     (nddimmxpymipalpxlops)    |
                             +-------------------------------+
```

---

### 2. RANH GIỚI TIN CẬY & NGUYÊN TẮC BẢO MẬT (Trust Boundaries)

| Dữ liệu / Thuộc tính | Trạng thái tin cậy | Nguồn xác thực | Cơ chế bảo vệ |
| :--- | :--- | :--- | :--- |
| `student_id` trong Body | **KHÔNG TIN CẬY (UNTRUSTED)** | Bị cấm hoàn toàn | Bị từ chối ngay lập tức (`400 INVALID_REQUEST_FIELD`) |
| `caller_id` / `p_caller_id` trong Body | **KHÔNG TIN CẬY (UNTRUSTED)** | Bị cấm hoàn toàn | Bị từ chối ngay lập tức (`400 INVALID_REQUEST_FIELD`) |
| `role` / `is_admin` trong Body | **KHÔNG TIN CẬY (UNTRUSTED)** | Bị cấm hoàn toàn | Bị từ chối ngay lập tức (`400 INVALID_REQUEST_FIELD`) |
| `class_id` trong Body | **KHÔNG TIN CẬY (UNTRUSTED)** | Bị cấm hoàn toàn | Bị từ chối ngay lập tức (`400 INVALID_REQUEST_FIELD`) |
| `file_url` đính kèm (Upload) | **KHÓA AN TOÀN TẠM THỜI** | Temporary Upload Feature Gate | Cho phép null/omitted cho câu hỏi text; chặn toàn bộ file_url != null với 422 ERR_EXAM_UPLOAD_NOT_READY |
| `service_role_key` trong Body | **KHÔNG TIN CẬY (UNTRUSTED)** | Bị cấm hoàn toàn | Bị từ chối ngay lập tức (`400 INVALID_REQUEST_FIELD`) |
| Danh tính Caller (`callerId`) | **TIN CẬY SAU XÁC THỰC** | CORE `auth.getUser()` | Trích xuất trực tiếp từ JWT sau khi kiểm tra chữ ký số |
| Vai trò người dùng (`actorRole`) | **TIN CẬY SAU XÁC THỰC** | CORE `public.profiles` | Đọc bằng CORE Service Role Key (Read-Only) - Chỉ cho phép `role = student` |
| Thành viên lớp (`class_members`) | **TIN CẬY SAU XÁC THỰC** | CORE `public.class_members` | Đối soát `class_members.student_id === callerId` (Read-Only) |
| Chuỗi `assignment -> class_id` | **TIN CẬY SAU XÁC THỰC** | NEW `exam_assignments` | Phân giải hoàn toàn phía Server-Side |
| Quyền sở hữu lượt thi (`exam_attempts.student_id`) | **TIN CẬY SAU XÁC THỰC** | NEW `exam_attempts` / RPC Lock | Đối soát `attempt.student_id === callerId` nghiêm ngặt trong RPC |
| Bảng đáp án `exam_answer_keys` | **BẢO MẬT TUYỆT ĐỐI** | DB `app_private` schema | BFF KHÔNG BAO GIỜ đọc hoặc trả về dữ liệu bảng này |

---

### 3. ĐẶC TẢ CHI TIẾT CÁC ENDPOINT

#### 3.1. Endpoint 1: `POST /exam/start-attempt`
- **Mục đích**: Khởi tạo hoặc tiếp tục một lượt làm bài thi (hỗ trợ snapshot đề thi, xáo trộn câu hỏi/phương án, an toàn cho phép tiếp tục bản nháp hoặc phát lại idempotent).
- **Request Body**:
  ```json
  {
    "assignment_id": "99999999-9999-4999-8999-999999999901",
    "attempt_id": "77777777-7777-4777-8777-777777777701"
  }
  ```
- **Xác thực & Phân quyền**:
  1. Header: `Authorization: Bearer <CORE_JWT>`
  2. CORE `auth.getUser()` -> xác thực `callerId`.
  3. CORE `profiles` -> kiểm tra `role === 'student'` và `!is_disabled`.
  4. NEW `exam_assignments` -> lấy `resolvedClassId = assignment.class_id`.
  5. CORE `class_members` -> kiểm tra `class_id = resolvedClassId AND student_id = callerId`. Nếu không thuộc lớp -> `403 CLASS_ACCESS_DENIED`.
  6. Thực thi `rpc_exam_start_attempt(p_caller_id = callerId, p_attempt_id = attempt_id, p_assignment_id = assignment_id, p_student_id = callerId)`.
- **Response Allowlist**:
  ```json
  {
    "success": true,
    "data": {
      "attempt_id": "77777777-7777-4777-8777-777777777701",
      "assignment_id": "99999999-9999-4999-8999-999999999901",
      "exam_version_id": "55555555-5555-4555-8555-555555555501",
      "student_id": "11111111-1111-4111-8111-111111111101",
      "attempt_number": 1,
      "status": "draft",
      "attempt_started_at": "2026-09-06T01:00:00Z",
      "expires_at": "2026-09-06T02:00:00Z",
      "max_score": 10.0,
      "question_order": ["..."],
      "option_orders": { "...": ["..."] },
      "resumed_existing": false,
      "idempotent_replay": false,
      "expired": false,
      "already_finalized": false
    }
  }
  ```

---

#### 3.2. Endpoint 2: `POST /exam/save-answer`
- **Mục đích**: Tự động lưu (Autosave) câu trả lời cho một câu hỏi với cơ chế khóa lạc quan (Optimistic Locking).
- **Request Body**:
  ```json
  {
    "attempt_id": "77777777-7777-4777-8777-777777777701",
    "exam_question_id": "88888888-8888-4888-8888-888888888801",
    "student_answer_json": "opt_a",
    "file_url": null,
    "expected_version": 1
  }
  ```
  *(Lưu ý: Đối với câu hỏi văn bản/lựa chọn, `file_url` phải là `null` hoặc bỏ qua không truyền).*
- **Xác thực & Phân quyền**:
  1. CORE `auth.getUser()` -> xác thực `callerId`.
  2. CORE `profiles` -> kiểm tra `role === 'student'` và `!is_disabled`.
  3. **Temporary Upload Feature Gate (Cổng kiểm soát tệp tải lên)**:
     - Nếu `file_url` là `null` hoặc không truyền (`undefined`) -> cho phép tiếp tục luồng lưu bài làm phi đính kèm tệp thông thường.
     - Nếu `file_url` không phải `null` (`file_url != null`) -> từ chối an toàn ngay lập tức với mã lỗi `422 ERR_EXAM_UPLOAD_NOT_READY` ("*Chức năng nộp tệp cho bài thi chưa được kích hoạt.*").
     - Không truy vấn Storage metadata, không sử dụng bucket `exercise-submissions` ở runtime, không lưu tham chiếu tệp rác vào database.
     - Các loại câu hỏi `image_upload` và `file_upload` được hoãn lại cho Phase 3B-Upload.
  4. Thực thi `rpc_exam_save_answer(...)` với `p_file_url = null`.
  5. RPC khóa hàng bản ghi `exam_attempts` `FOR UPDATE` và kiểm tra quyền sở hữu `v_attempt_rec.student_id = p_caller_id`.
- **Response Allowlist**:
  ```json
  {
    "success": true,
    "data": {
      "attempt_id": "77777777-7777-4777-8777-777777777701",
      "exam_question_id": "88888888-8888-4888-8888-888888888801",
      "grading_status": "pending_auto",
      "attempt_version": 2
    }
  }
  ```

---

#### 3.3. Endpoint 3: `POST /exam/submit-attempt`
- **Mục đích**: Nộp bài thi nguyên tử, chốt trạng thái và chấm điểm tự động đối với các câu hỏi trắc nghiệm phía cơ sở dữ liệu.
- **Request Body**:
  ```json
  {
    "attempt_id": "77777777-7777-4777-8777-777777777701",
    "expected_version": 2
  }
  ```
- **Xác thực & Phân quyền**:
  1. CORE `auth.getUser()` -> xác thực `callerId`.
  2. CORE `profiles` -> kiểm tra `role === 'student'` và `!is_disabled`.
  3. Thực thi `rpc_exam_submit_attempt(p_caller_id = callerId, p_attempt_id = attempt_id, p_expected_version = expected_version)`.
  4. RPC chấm điểm server-side sử dụng `app_private.exam_answer_keys` và cập nhật `graded` (hoặc `pending_manual_grade` nếu có câu tự luận/tải tệp).
- **Response Allowlist**:
  ```json
  {
    "success": true,
    "data": {
      "attempt_id": "77777777-7777-4777-8777-777777777701",
      "assignment_id": "99999999-9999-4999-8999-999999999901",
      "exam_version_id": "55555555-5555-4555-8555-555555555501",
      "student_id": "11111111-1111-4111-8111-111111111101",
      "attempt_number": 1,
      "status": "graded",
      "attempt_started_at": "2026-09-06T01:00:00Z",
      "expires_at": "2026-09-06T02:00:00Z",
      "submitted_at": "2026-09-06T01:30:00Z",
      "objective_score": 10.0,
      "manual_score": 0.0,
      "total_score": 10.0,
      "max_score": 10.0,
      "reward_stars_awarded": 0,
      "graded_at": "2026-09-06T01:30:00Z",
      "graded_by": null,
      "version": 3,
      "idempotent_replay": false
    }
  }
  ```

---

### 4. BẢO MẬT LƯU TRỮ VÀ HỢP ĐỒNG TỆP TIN ĐÍNH KÈM (Upload Contract Closure & Feature Gate)

> [!IMPORTANT]
> **QUYẾT ĐỊNH KIẾN TRÚC & TRẠNG THÁI TỆP TẢI LÊN (Architectural Decision & Upload Status)**:
>
> - `EXAM_UPLOAD_STATUS=BLOCKED_PENDING_DEDICATED_UPLOAD_PHASE`
> - `EXAM_UPLOAD_CONTRACT_PROVEN=NO`
> - `DIRECT_EXAM_UPLOAD_READY=NO`
> - `DEDICATED_EXAM_UPLOAD_PHASE_REQUIRED=YES`
> - `OBJECT_OWNERSHIP_CHAIN_PROVEN=NO`
> - `REASON=NO_VALID_EXAM_UPLOAD_CREATION_PATH_EXISTS_YET`
>
> **Kết quả rà soát Storage Contract thực tế (Read-Only Discovery)**:
> 1. **Bucket hiện hữu**: Bucket `exercise-submissions` tồn tại trên dự án **CORE** (`nddimmxpymipalpxlops`), quyền riêng tư `public = false`.
> 2. **Không tái sử dụng cho Exam**: `NOT_REUSED_FOR_EXAM=YES`. Chính sách Storage RLS trên CORE (`Exercise submissions student insert policy`) ràng buộc nghiêm ngặt vào bảng `public.academic_submissions` trên CORE. Trong khi đó, các lượt thi Exam V1 thuộc bảng `exam_attempts` trên dự án **NEW** (`szptvqkoiphrhlionfoh`), do đó không thể thỏa mãn hợp đồng RLS của CORE Storage.
> 3. **Cơ chế đóng an toàn tạm thời (Temporary Fail-Closed Feature Gate)**:
>    - BFF Endpoint `POST /exam/save-answer` từ chối tất cả yêu cầu có `file_url != null` với mã lỗi HTTP 422 `ERR_EXAM_UPLOAD_NOT_READY` ("Chức năng nộp tệp cho bài thi chưa được kích hoạt.").
>    - BFF hoàn toàn không truy vấn metadata Storage trên CORE client (`coreClient.storage`), loại bỏ mã giả định quyền sở hữu.
>    - Cơ sở dữ liệu RPC `rpc_exam_save_answer` giữ nguyên, không cần sửa đổi; cổng kiểm soát BFF đảm bảo không có chuỗi tham chiếu tệp chưa được xác thực nào được chuyển tiếp tới DB.
> 4. **Phạm vi hoàn tất của Phase 3B**:
>    - Hoàn tất và sẵn sàng 100%: Khởi tạo lượt thi (`start-attempt`), lưu câu trả lời văn bản/lựa chọn (`single_choice`, `multiple_choice`, `fill_blank`, `short_answer`, `essay` với `student_answer_json` và `file_url: null`), và nộp bài (`submit-attempt`).
>    - Hoãn lại cho giai đoạn chuyên biệt (Deferred to Phase 3B-Upload): Các loại câu hỏi yêu cầu đính kèm tệp (`image_upload`, `file_upload`) sẽ được thiết kế hạ tầng lưu trữ và upload an toàn riêng biệt trong Phase 3B-Upload.

---

### 5. BẢNG ÁNH XẠ MÃ LỖI (Domain Error Mapping)

| Mã lỗi HTTP | Mã lỗi chuẩn (`error_code`) | Nguyên nhân kích hoạt |
| :--- | :--- | :--- |
| **401 Unauthorized** | `AUTH_REQUIRED` | Thiếu hoặc sai định dạng header `Authorization: Bearer <token>` |
| **401 Unauthorized** | `INVALID_TOKEN` | Token JWT hết hạn, sai chữ ký, hoặc không tồn tại trong CORE Auth |
| **403 Forbidden** | `FORBIDDEN_ROLE` | Người gọi không có role `student` |
| **403 Forbidden** | `ACCOUNT_DISABLED` | Tài khoản học sinh bị khóa (`is_disabled === true`) |
| **403 Forbidden** | `CLASS_ACCESS_DENIED` | Học sinh không thuộc danh sách lớp học được giao bài thi (`public.class_members`) |
| **403 Forbidden** | `ATTEMPT_ACCESS_DENIED` | Học sinh cố ý lưu/nộp bài thi của người khác |
| **404 Not Found** | `ERR_ASSIGNMENT_NOT_FOUND` | Bài giao không tồn tại trong `exam_assignments` |
| **404 Not Found** | `ERR_ATTEMPT_NOT_FOUND` | Lượt làm bài không tồn tại trong `exam_attempts` |
| **404 Not Found** | `ERR_QUESTION_NOT_FOUND` | Câu hỏi không tồn tại trong `exam_questions` |
| **409 Conflict** | `ERR_OPTIMISTIC_LOCK_CONFLICT` | Phiên bản `expected_version` không khớp với `attempt.version` hiện tại |
| **409 Conflict** | `ERR_ATTEMPT_ALREADY_FINALIZED` | Lượt làm bài đã nộp hoặc hoàn tất (`submitted`/`graded`), không được ghi đè |
| **409 Conflict** | `ERR_ATTEMPT_EXPIRED` | Đã hết thời gian làm bài thi theo quy định |
| **409 Conflict** | `ERR_MAX_ATTEMPTS_EXCEEDED` | Học sinh đã hết số lần làm bài cho phép theo cấu hình đề thi |
| **409 Conflict** | `ERR_IDEMPOTENCY_CONFLICT` | Mã `attempt_id` đã tồn tại với tham số khác |
| **422 Unprocessable** | `ERR_EXAM_UPLOAD_NOT_READY` | Chức năng nộp tệp cho bài thi chưa được kích hoạt (Temporary Upload Feature Gate) |
| **422 Unprocessable** | `ERR_VERSION_NOT_PUBLISHED` | Đề thi chưa được xuất bản chính thức |
| **422 Unprocessable** | `ERR_EXAM_NOT_STARTED` / `ERR_EXAM_CLOSED` | Ngoài khung giờ mở/đóng bài thi |
| **422 Unprocessable** | `ERR_INVALID_ANSWER_PAYLOAD` / `ERR_INVALID_OPTION_KEY` | Dữ liệu bài làm không đúng định dạng hoặc phương án không tồn tại |
| **400 Bad Request** | `INVALID_INPUT` / `INVALID_REQUEST_FIELD` | JSON không hợp lệ, thiếu UUID, hoặc chứa trường bị cấm |
| **500 Internal Error** | `INTERNAL_ERROR` | Lỗi máy chủ hoặc cơ sở dữ liệu đã được làm sạch hoàn toàn |

---

### 6. CẤU HÌNH GATEWAY & BIẾN MÔI TRƯỜNG

```toml
[functions.exam-start-attempt]
verify_jwt = false

[functions.exam-save-answer]
verify_jwt = false

[functions.exam-submit-attempt]
verify_jwt = false
```
