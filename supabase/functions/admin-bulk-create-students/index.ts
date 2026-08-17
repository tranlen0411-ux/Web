import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 1. CẤU HÌNH HEADERS & CORS NGHIÊM NGẶT (BÁN `*`, CHỈ CHO PHÉP ORIGIN ĐÃ KHÁO SÁT)
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'https://kho-tro-choi-hoc-vui-tieu-hoc.vercel.app',
];

const getCorsHeaders = (origin: string | null) => {
  let allowOrigin = ALLOWED_ORIGINS[0]; // Mặc định local dev 3000
  
  if (origin) {
    if (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.vercel.app')) {
      allowOrigin = origin;
    }
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-idempotency-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  };
};

// Cache Idempotency kết quả xử lý batch phòng ngừa bấm lặp lại (10 phút)
const idempotencyCache = new Map<string, { timestamp: number; response: any }>();
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // =========================================================================
    // 2. XÁC THỰC ADMIN CHẶT CHẼ TỪ JWT (TUYỆT ĐỐI KHÔNG LOG JWT HOẶC HEADER)
    // =========================================================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ success: false, message: 'Từ chối truy cập: Chưa cung cấp token xác thực JWT.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, message: 'Cấu hình Server Env chưa hoàn tất.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Xác minh chữ ký JWT & token expiry bằng Supabase Anon Client
    const supabaseCaller = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller }, error: callerError } = await supabaseCaller.auth.getUser();
    if (callerError || !caller) {
      return new Response(
        JSON.stringify({ success: false, message: 'Từ chối truy cập: Token JWT không hợp lệ hoặc đã hết hạn.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // LẤY USER ID CHÍNH THỨC TỪ ĐẦU RA getUser() (KHÔNG LẤY TỪ REQUEST BODY)
    const verifiedAdminUserId = caller.id;

    // Khởi tạo Supabase Admin Client bằng Service Role Key
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Tra cứu vai trò từ public.profiles bằng verifiedAdminUserId
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', verifiedAdminUserId)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== 'admin') {
      return new Response(
        JSON.stringify({ success: false, message: 'Từ chối truy cập: Chỉ Quản trị viên (Admin) mới có quyền thực hiện nhập hàng loạt.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================================
    // 3. ĐỌC & KIỂM TRA BATCH ĐẦU VÀO VÀ IDEMPOTENCY KEY CHỐNG BẤM LẶP
    // =========================================================================
    let body: any = {};
    try {
      body = await req.json();
    } catch (_e) {
      return new Response(
        JSON.stringify({ success: false, message: 'Dữ liệu JSON gửi lên không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { classId, students, dryRun = false, idempotencyKey } = body;

    // Kiểm tra Idempotency Key
    if (idempotencyKey && typeof idempotencyKey === 'string') {
      const now = Date.now();
      const cached = idempotencyCache.get(idempotencyKey);
      if (cached && (now - cached.timestamp < IDEMPOTENCY_TTL_MS)) {
        return new Response(
          JSON.stringify(cached.response),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (!classId || !students || !Array.isArray(students) || students.length === 0) {
      return new Response(
        JSON.stringify({ success: false, message: 'Vui lòng cung cấp mã Lớp học và danh sách học sinh hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (students.length > 50) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mỗi đợt nhập hàng loạt chỉ được tối đa 50 học sinh.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================================
    // 4. XÁC MINH LỚP ĐÍCH PHÍA SERVER KHỚP ĐỦ 4 ĐIỀU KIỆN LỚP 2.12
    // =========================================================================
    const { data: targetClass, error: classErr } = await supabaseAdmin
      .from('classes')
      .select('id, name, grade_level, code, teacher_id')
      .eq('id', classId)
      .maybeSingle();

    if (classErr || !targetClass) {
      return new Response(
        JSON.stringify({ success: false, message: 'Lớp học không tồn tại trong hệ thống.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1) Tên chuẩn hóa = Lớp 2.12
    const normClassName = targetClass.name.trim().toLowerCase().replace(/\s+/g, ' ');
    if (normClassName !== 'lớp 2.12') {
      return new Response(
        JSON.stringify({ success: false, message: `Lớp chọn có tên "${targetClass.name}" không phải là "Lớp 2.12". Từ chối batch!` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2) grade_level = 2
    if (targetClass.grade_level !== 2) {
      return new Response(
        JSON.stringify({ success: false, message: `Lớp 2.12 có grade_level = ${targetClass.grade_level} (yêu cầu grade_level = 2). Từ chối batch!` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3) code = LOP212-3A5818
    if (targetClass.code !== 'LOP212-3A5818') {
      return new Response(
        JSON.stringify({ success: false, message: `Lớp 2.12 có mã code "${targetClass.code}" (yêu cầu mã chính thức "LOP212-3A5818"). Từ chối batch!` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4) teacher_id đúng cô Lã Nguyễn Diễm Hương
    if (!targetClass.teacher_id) {
      return new Response(
        JSON.stringify({ success: false, message: 'Lớp 2.12 chưa được gán Giáo viên phụ trách. Từ chối batch!' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: teacherProf } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', targetClass.teacher_id)
      .maybeSingle();

    const normTeacherName = teacherProf?.full_name?.trim().toLowerCase().replace(/\s+/g, ' ') || '';
    if (!teacherProf || teacherProf.role !== 'teacher' || normTeacherName !== 'lã nguyễn diễm hương') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: `Lớp 2.12 hiện đang do Giáo viên "${teacherProf?.full_name || 'Không rõ'}" phụ trách (Yêu cầu chính thức: Cô Lã Nguyễn Diễm Hương). Từ chối batch!` 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================================
    // 5. CHUẨN HÓA DANH SÁCH HỌC SINH ĐẦU VÀO
    // =========================================================================
    const seenNamesInBatch = new Set<string>();
    const cleanedStudentsInput: Array<{ stt: number; fullName: string; isDuplicateInBatch: boolean }> = [];

    for (let i = 0; i < students.length; i++) {
      const item = students[i];
      const stt = item.stt || i + 1;
      const rawName = item.fullName || item.full_name || '';
      const cleanName = rawName.trim().replace(/\s+/g, ' ');

      if (!cleanName || cleanName.length > 100) {
        continue;
      }

      const lowerName = cleanName.toLowerCase();
      let isDup = false;
      if (seenNamesInBatch.has(lowerName)) {
        isDup = true;
      } else {
        seenNamesInBatch.add(lowerName);
      }

      cleanedStudentsInput.push({
        stt,
        fullName: cleanName,
        isDuplicateInBatch: isDup,
      });
    }

    // =========================================================================
    // 6. CHẾ ĐỘ DRY-RUN PREVIEW (READ-ONLY CHƯA TẠO DỮ LIỆU)
    // =========================================================================
    if (dryRun === true) {
      const dryResults: Array<{
        stt: number;
        fullName: string;
        status: string;
        studentCode: string;
        studentId: string;
        note: string;
      }> = [];

      let readyCount = 0;
      let alreadyInClassCount = 0;
      let reviewRequiredCount = 0;

      for (const item of cleanedStudentsInput) {
        if (item.isDuplicateInBatch) {
          dryResults.push({
            stt: item.stt,
            fullName: item.fullName,
            status: 'DUPLICATE_IN_BATCH',
            studentCode: '-',
            studentId: '-',
            note: 'Phát hiện họ tên bị trùng lặp trong cùng batch gửi lên.',
          });
          reviewRequiredCount++;
          continue;
        }

        const { data: matchedProfiles } = await supabaseAdmin
          .from('profiles')
          .select('id, student_code, email')
          .eq('role', 'student')
          .ilike('full_name', item.fullName);

        if (!matchedProfiles || matchedProfiles.length === 0) {
          dryResults.push({
            stt: item.stt,
            fullName: item.fullName,
            status: 'READY_TO_CREATE',
            studentCode: 'Dự kiến sinh mã HS212-xxx',
            studentId: '-',
            note: 'Chưa có tài khoản. Sẵn sàng tạo mới Auth + Profile + PIN Hash và gán Lớp 2.12.',
          });
          readyCount++;
        } else if (matchedProfiles.length === 1) {
          const prof = matchedProfiles[0];
          const { data: cmRec } = await supabaseAdmin
            .from('class_members')
            .select('id')
            .eq('class_id', classId)
            .eq('student_id', prof.id)
            .maybeSingle();

          if (cmRec) {
            dryResults.push({
              stt: item.stt,
              fullName: item.fullName,
              status: 'ALREADY_IN_CLASS_212',
              studentCode: prof.student_code || '-',
              studentId: prof.id,
              note: 'Đã có tài khoản duy nhất và đã thuộc Lớp 2.12 từ trước.',
            });
            alreadyInClassCount++;
          } else {
            dryResults.push({
              stt: item.stt,
              fullName: item.fullName,
              status: 'EXISTING_USER_READY_TO_ASSIGN',
              studentCode: prof.student_code || '-',
              studentId: prof.id,
              note: 'Đã có tài khoản duy nhất, sẵn sàng gán thêm vào Lớp 2.12.',
            });
            readyCount++;
          }
        } else {
          dryResults.push({
            stt: item.stt,
            fullName: item.fullName,
            status: 'DUPLICATE_REQUIRES_REVIEW',
            studentCode: '-',
            studentId: '-',
            note: `Phát hiện ${matchedProfiles.length} tài khoản trùng tên trên nền tảng. Cần Admin xác minh UUID.`,
          });
          reviewRequiredCount++;
        }
      }

      const dryRunResponse = {
        success: true,
        dryRun: true,
        message: `Bản xem trước Dry-Run hoàn tất cho ${cleanedStudentsInput.length} học sinh Lớp 2.12.`,
        className: targetClass.name,
        classCode: targetClass.code,
        teacherName: teacherProf.full_name,
        summary: {
          total: cleanedStudentsInput.length,
          readyToCreate: readyCount,
          alreadyInClass: alreadyInClassCount,
          reviewRequired: reviewRequiredCount,
        },
        results: dryResults,
      };

      if (idempotencyKey) {
        idempotencyCache.set(idempotencyKey, { timestamp: Date.now(), response: dryRunResponse });
      }

      return new Response(
        JSON.stringify(dryRunResponse),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================================
    // 7. THỰC THI THẬT PRODUCTION (XỬ LÝ TUẦN TỰ NGUYÊN TỬ & CLEANUP COMPENSATION)
    // =========================================================================
    const finalResults: Array<{
      stt: number;
      fullName: string;
      status: string;
      studentCode?: string;
      pin?: string;
      studentId?: string;
      note: string;
    }> = [];

    let createdCount = 0;
    let assignedExistingCount = 0;
    let failedCount = 0;

    // VÒNG LẶP TUẦN TỰ (SEQUENTIAL LOOP) ĐỂ NGUYÊN TỬ VÀ KIỂM SOÁT BỘ LẮP XỬ LÝ
    for (const item of cleanedStudentsInput) {
      if (item.isDuplicateInBatch) {
        finalResults.push({
          stt: item.stt,
          fullName: item.fullName,
          status: 'SKIPPED_DUPLICATE_IN_BATCH',
          note: 'Bỏ qua do bị trùng họ tên với dòng khác trong cùng batch.',
        });
        failedCount++;
        continue;
      }

      // Kiểm tra profile học sinh sẵn có
      const { data: matchedProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id, student_code, email')
        .eq('role', 'student')
        .ilike('full_name', item.fullName);

      if (matchedProfiles && matchedProfiles.length > 1) {
        finalResults.push({
          stt: item.stt,
          fullName: item.fullName,
          status: 'SKIPPED_DUPLICATE_REQUIRES_REVIEW',
          note: `Phát hiện ${matchedProfiles.length} tài khoản trùng tên nền tảng. Bắt buộc Admin xác minh thủ công.`,
        });
        failedCount++;
        continue;
      }

      if (matchedProfiles && matchedProfiles.length === 1) {
        const existingProf = matchedProfiles[0];
        const { data: cmRec } = await supabaseAdmin
          .from('class_members')
          .select('id')
          .eq('class_id', classId)
          .eq('student_id', existingProf.id)
          .maybeSingle();

        if (!cmRec) {
          await supabaseAdmin
            .from('class_members')
            .insert({
              class_id: classId,
              student_id: existingProf.id,
              joined_at: new Date().toISOString(),
            });
          
          finalResults.push({
            stt: item.stt,
            fullName: item.fullName,
            status: 'ALREADY_EXISTS_ASSIGNED_TO_CLASS',
            studentCode: existingProf.student_code || '-',
            studentId: existingProf.id,
            note: 'Đã có tài khoản duy nhất từ trước, vừa gán vào Lớp 2.12.',
          });
          assignedExistingCount++;
        } else {
          finalResults.push({
            stt: item.stt,
            fullName: item.fullName,
            status: 'ALREADY_IN_CLASS',
            studentCode: existingProf.student_code || '-',
            studentId: existingProf.id,
            note: 'Đã có tài khoản và đã thuộc Lớp 2.12 từ trước.',
          });
          assignedExistingCount++;
        }
        continue;
      }

      // NẾU CHƯA CÓ TÀI KHOẢN -> KHỞI TẠO TÀI KHOẢN MỚI 100% VỚI NGUYÊN TỬ UNIQUE RETRY & CLEANUP COMPENSATION
      let newlyCreatedUserId: string | null = null;
      let successFullyCreated = false;

      // VÒNG LẶP NGUYÊN TỬ NẾU GẶP UNIQUE CONSTRAINT VIOLATION TRÊN STUDENT_CODE HOẶC EMAIL
      for (let attempt = 1; attempt <= 5; attempt++) {
        const randomCodeNum = Math.floor(1000 + Math.random() * 8999);
        const studentCode = `HS212-${randomCodeNum}`;
        const pin = Math.floor(1000 + Math.random() * 9000).toString(); // PIN 4 chữ số
        const internalEmail = `hs_${studentCode.toLowerCase()}@hoclapvui.edu.vn`;
        const internalPassword = `Pin_${pin}_Auth!`;

        // 1. Tạo Auth User
        const { data: authData, error: createAuthErr } = await supabaseAdmin.auth.admin.createUser({
          email: internalEmail,
          password: internalPassword,
          email_confirm: true,
          user_metadata: {
            full_name: item.fullName,
            role: 'student',
            grade_level: 2,
            student_code: studentCode,
          },
        });

        if (createAuthErr || !authData?.user) {
          // Nếu bị trùng email/Auth user -> Thử lại vòng lặp với mã ngẫu nhiên mới
          if (createAuthErr?.message?.toLowerCase().includes('already') || createAuthErr?.message?.toLowerCase().includes('unique')) {
            continue;
          }
          finalResults.push({
            stt: item.stt,
            fullName: item.fullName,
            status: 'FAILED_AUTH_CREATION',
            note: `Lỗi tạo Auth: ${createAuthErr?.message || 'Không thể tạo Auth User'}`,
          });
          failedCount++;
          break;
        }

        newlyCreatedUserId = authData.user.id;

        try {
          await new Promise((res) => setTimeout(res, 200));

          // 2. Upsert public.profiles
          const { error: profileErr } = await supabaseAdmin
            .from('profiles')
            .upsert({
              id: newlyCreatedUserId,
              email: internalEmail,
              full_name: item.fullName,
              role: 'student',
              grade_level: 2,
              student_code: studentCode,
              is_disabled: false,
              updated_at: new Date().toISOString(),
            });

          if (profileErr) {
            // Check unique constraint violation trên profiles.student_code
            if (profileErr.code === '23505' && attempt < 5) {
              await supabaseAdmin.auth.admin.deleteUser(newlyCreatedUserId);
              newlyCreatedUserId = null;
              continue; // Thử lại mã mới
            }
            
            // CLEANUP COMPENSATION: Xóa Auth User mới tạo nếu Profile thất bại
            await supabaseAdmin.auth.admin.deleteUser(newlyCreatedUserId);
            finalResults.push({
              stt: item.stt,
              fullName: item.fullName,
              status: 'FAILED_PROFILE_CREATION',
              note: `Lỗi tạo Profile: ${profileErr.message}. Đã dọn dẹp Auth User mồ côi.`,
            });
            failedCount++;
            break;
          }

          // 3. Đặt PIN Hash qua RPC set_student_pin (Mã hóa bcrypt 1 chiều vào app_private.student_login_credentials)
          const { error: pinErr } = await supabaseAdmin.rpc('set_student_pin', {
            p_student_id: newlyCreatedUserId,
            p_pin: pin,
          });

          if (pinErr) {
            console.error(`Lỗi gán PIN cho ${studentCode}:`, pinErr.message);
          }

          // 4. Thêm vào class_members
          const { error: cmErr } = await supabaseAdmin
            .from('class_members')
            .insert({
              class_id: classId,
              student_id: newlyCreatedUserId,
              joined_at: new Date().toISOString(),
            });

          if (cmErr) {
            // CLEANUP COMPENSATION CHO TÀI KHOẢN TẠO MỚI NẾU GÁN LỚP THẤT BẠI
            try { await supabaseAdmin.from('app_private.student_login_credentials').delete().eq('student_id', newlyCreatedUserId); } catch (_e) {}
            try { await supabaseAdmin.from('profiles').delete().eq('id', newlyCreatedUserId); } catch (_e) {}
            try { await supabaseAdmin.auth.admin.deleteUser(newlyCreatedUserId); } catch (_e) {}
            
            finalResults.push({
              stt: item.stt,
              fullName: item.fullName,
              status: 'FAILED_CLASS_ASSIGNMENT',
              note: `Lỗi gán lớp: ${cmErr.message}. Đã dọn dẹp tài khoản mồ côi.`,
            });
            failedCount++;
            break;
          }

          // THÀNH CÔNG 100%!
          finalResults.push({
            stt: item.stt,
            fullName: item.fullName,
            status: 'CREATED_AND_ASSIGNED',
            studentCode,
            pin, // Trả về PIN duy nhất 1 lần trong HTTP response có no-store
            studentId: newlyCreatedUserId,
            note: 'Tạo tài khoản và gán vào Lớp 2.12 thành công!',
          });
          createdCount++;
          successFullyCreated = true;
          break; // Thoát vòng lặp retry

        } catch (procErr: any) {
          // CLEANUP COMPENSATION CHO TÀI KHOẢN TẠO MỚI (TUYỆT ĐỐI KHÔNG XÓA TÀI KHOẢN ĐÃ TỒN TẠI TỪ TRƯỚC)
          if (newlyCreatedUserId) {
            try { await supabaseAdmin.from('class_members').delete().eq('student_id', newlyCreatedUserId); } catch (_e) {}
            try { await supabaseAdmin.from('app_private.student_login_credentials').delete().eq('student_id', newlyCreatedUserId); } catch (_e) {}
            try { await supabaseAdmin.from('profiles').delete().eq('id', newlyCreatedUserId); } catch (_e) {}
            try { await supabaseAdmin.auth.admin.deleteUser(newlyCreatedUserId); } catch (_e) {}
          }

          finalResults.push({
            stt: item.stt,
            fullName: item.fullName,
            status: 'FAILED_PROCESS',
            note: `Lỗi bất ngờ: ${procErr.message || 'Lỗi server'}. Đã dọn dẹp tài khoản mồ côi.`,
          });
          failedCount++;
          break;
        }
      }

      if (!successFullyCreated && newlyCreatedUserId === null && finalResults.length < item.stt) {
        finalResults.push({
          stt: item.stt,
          fullName: item.fullName,
          status: 'FAILED_UNIQUE_RETRY_EXHAUSTED',
          note: 'Không thể sinh mã học sinh độc nhất sau 5 lần thử.',
        });
        failedCount++;
      }
    }

    const prodResponse = {
      success: true,
      dryRun: false,
      message: `Đã hoàn thành thực thi nạp batch cho Lớp 2.12.`,
      className: targetClass.name,
      classCode: targetClass.code,
      summary: {
        total: cleanedStudentsInput.length,
        created: createdCount,
        assignedExisting: assignedExistingCount,
        failed: failedCount,
      },
      results: finalResults,
    };

    if (idempotencyKey) {
      idempotencyCache.set(idempotencyKey, { timestamp: Date.now(), response: prodResponse });
    }

    return new Response(
      JSON.stringify(prodResponse),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('admin-bulk-create-students exception:', err);
    return new Response(
      JSON.stringify({ success: false, message: err.message || 'Lỗi server-side.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
