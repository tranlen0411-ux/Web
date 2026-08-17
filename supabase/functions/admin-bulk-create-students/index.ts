import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STRICT_EXACT_ORIGINS = [
  'https://web-len9.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

const getStrictCorsHeaders = (origin: string | null) => {
  if (!origin) return null;
  const cleanOrigin = origin.trim().replace(/\/$/, '');
  if (!STRICT_EXACT_ORIGINS.includes(cleanOrigin)) {
    return null;
  }

  return {
    'Access-Control-Allow-Origin': cleanOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-idempotency-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  };
};

serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = getStrictCorsHeaders(origin);

  if (!corsHeaders) {
    return new Response(
      JSON.stringify({ success: false, message: 'Từ chối truy cập: Origin không thuộc danh sách được phép.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ success: false, message: 'Từ chối truy cập: Chưa cung cấp token JWT xác thực.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, message: 'Cấu hình Server Env chưa hoàn tất.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // LẤY ADMIN_ID DUY NHẤT TỪ JWT ĐÃ ĐƯỢC SUPABASE XÁC MINH (KHÔNG TIN CLIENT)
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

    const verifiedAdminUserId = caller.id;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: callerProfile, error: profileCheckErr } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', verifiedAdminUserId)
      .maybeSingle();

    if (profileCheckErr || !callerProfile || callerProfile.role !== 'admin') {
      return new Response(
        JSON.stringify({ success: false, message: 'Từ chối truy cập: Chỉ Quản trị viên (Admin) mới có quyền nhập học sinh hàng loạt.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    const isAllowProductionBulkCreate = Deno.env.get('ALLOW_PRODUCTION_BULK_CREATE') === 'true';
    if (!dryRun && !isAllowProductionBulkCreate) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Từ chối thực thi: Biến môi trường ALLOW_PRODUCTION_BULK_CREATE chưa được bật trên Server Production. Nút tạo thật bị khóa!' 
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!classId || !students || !Array.isArray(students) || students.length === 0) {
      return new Response(
        JSON.stringify({ success: false, message: 'Vui lòng cung cấp mã Lớp học và danh sách học sinh hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, message: 'Thiếu idempotencyKey hợp lệ cho yêu cầu xử lý.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (students.length > 50) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mỗi đợt nhập hàng loạt chỉ được tối đa 50 học sinh.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    const normClassName = targetClass.name.trim().toLowerCase().replace(/\s+/g, ' ');
    if (normClassName !== 'lớp 2.12') {
      return new Response(
        JSON.stringify({ success: false, message: `Lớp chọn có tên "${targetClass.name}" không phải là "Lớp 2.12". Từ chối batch!` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (targetClass.grade_level !== 2) {
      return new Response(
        JSON.stringify({ success: false, message: `Lớp 2.12 có grade_level = ${targetClass.grade_level} (yêu cầu grade_level = 2). Từ chối batch!` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (targetClass.code !== 'LOP212-3A5818') {
      return new Response(
        JSON.stringify({ success: false, message: `Lớp 2.12 có mã code "${targetClass.code}" (yêu cầu mã chính thức "LOP212-3A5818"). Từ chối batch!` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!targetClass.teacher_id) {
      return new Response(
        JSON.stringify({ success: false, message: 'Lớp 2.12 chưa được gán Giáo viên phụ trách. Từ chối batch!' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: teacherProf, error: tErr } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', targetClass.teacher_id)
      .maybeSingle();

    const normTeacherName = teacherProf?.full_name?.trim().toLowerCase().replace(/\s+/g, ' ') || '';
    if (tErr || !teacherProf || teacherProf.role !== 'teacher' || normTeacherName !== 'lã nguyễn diễm hương') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: `Lớp 2.12 hiện đang do Giáo viên "${teacherProf?.full_name || 'Không rõ'}" phụ trách (Yêu cầu chính thức: Cô Lã Nguyễn Diễm Hương). Từ chối batch!` 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const seenNamesInBatch = new Set<string>();
    const cleanedStudentsInput: Array<{ stt: number; fullName: string; isDuplicateInBatch: boolean; isInvalidInput: boolean }> = [];

    for (let i = 0; i < students.length; i++) {
      const item = students[i];
      const stt = item.stt || i + 1;
      const rawName = item.fullName || item.full_name || '';
      const cleanName = rawName.trim().replace(/\s+/g, ' ');

      if (!cleanName || cleanName.length > 100) {
        cleanedStudentsInput.push({ stt, fullName: rawName || 'Tên rỗng', isDuplicateInBatch: false, isInvalidInput: true });
        continue;
      }

      const lowerName = cleanName.toLowerCase();
      let isDup = false;
      if (seenNamesInBatch.has(lowerName)) {
        isDup = true;
      } else {
        seenNamesInBatch.add(lowerName);
      }

      cleanedStudentsInput.push({ stt, fullName: cleanName, isDuplicateInBatch: isDup, isInvalidInput: false });
    }

    const sortedNamesString = cleanedStudentsInput.map(s => s.fullName).sort().join('|');
    const rawFingerprintText = `${classId}_dry:${dryRun}_${sortedNamesString}`;
    const textEncoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', textEncoder.encode(rawFingerprintText));
    const payloadFingerprint = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    let batchId: string | null = null;
    let claimToken: string | null = null;

    if (idempotencyKey && typeof idempotencyKey === 'string') {
      const { data: claimRes, error: claimErr } = await supabaseCaller.rpc('claim_batch_idempotency', {
        p_idempotency_key: idempotencyKey,
        p_payload_fingerprint: payloadFingerprint,
      });

      if (claimErr || !claimRes) {
        return new Response(
          JSON.stringify({ success: false, message: 'Lỗi xác minh Idempotency Key từ CSDL.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (claimRes.status === 'PAYLOAD_MISMATCH') {
        return new Response(
          JSON.stringify({ success: false, message: claimRes.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else if (claimRes.status === 'COMPLETED') {
        // REQUEST REPLAYED: KHÔNG TRẢ LẠI PIN, TRẢ RESPONSE SANITIZED KÈM REPLAYED: TRUE
        return new Response(
          JSON.stringify({
            ...claimRes.response_data,
            batchId: claimRes.batch_id,
            replayed: true,
            credentialsAvailable: false,
            message: 'Batch này đã hoàn tất từ trước. Mã PIN không thể lấy lại từ yêu cầu lặp.'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else if (claimRes.status === 'COMPLETED_PENDING_DELIVERY') {
        return new Response(
          JSON.stringify({
            ...claimRes.response_data,
            batchId: claimRes.batch_id,
            replayed: true,
            credentialsAvailable: false,
            requiresPinReset: true,
            message: 'Batch đã hoàn tất nhưng PIN không được phát lại. Hãy dùng quy trình cấp lại PIN.'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else if (claimRes.status === 'PROCESSING_LEASE_ACTIVE') {
        return new Response(
          JSON.stringify({ success: false, message: claimRes.message }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else if (claimRes.claim_token && claimRes.batch_id) {
        batchId = claimRes.batch_id;
        claimToken = claimRes.claim_token;
      } else {
        return new Response(
          JSON.stringify({ success: false, message: claimRes.message || 'Không thể sở hữu claim_token xử lý batch.' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

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
        if (item.isInvalidInput) {
          dryResults.push({
            stt: item.stt,
            fullName: item.fullName,
            status: 'INVALID_INPUT',
            studentCode: '-',
            studentId: '-',
            note: 'Dữ liệu tên học sinh bị rỗng hoặc quá độ dài cho phép.',
          });
          reviewRequiredCount++;
          continue;
        }

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

        const { data: matchedProfiles, error: matchedProfilesErr } = await supabaseAdmin
          .from('profiles')
          .select('id, student_code, email')
          .eq('role', 'student')
          .ilike('full_name', item.fullName);

        if (matchedProfilesErr) {
          return new Response(JSON.stringify({ success: false, message: 'Không thể đối chiếu hồ sơ học sinh.' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

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
          const { data: cmRec, error: cmLookupErr } = await supabaseAdmin
            .from('class_members')
            .select('id')
            .eq('class_id', classId)
            .eq('student_id', prof.id)
            .maybeSingle();

          if (cmLookupErr) {
            return new Response(JSON.stringify({ success: false, message: 'Không thể đối chiếu lớp hiện tại của học sinh.' }),
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }

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
              status: 'DUPLICATE_REQUIRES_REVIEW',
              studentCode: prof.student_code || '-',
              studentId: prof.id,
              note: 'Đã có tài khoản trùng tên trên hệ thống. Yêu cầu Admin xác minh UUID trước khi gán lớp.',
            });
            reviewRequiredCount++;
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

      if (idempotencyKey && batchId && claimToken) {
        const { data: compOk, error: compErr } = await supabaseAdmin.rpc('complete_batch_idempotency', {
          p_batch_id: batchId,
          p_claim_token: claimToken,
          p_response_data: dryRunResponse,
          p_is_success: true,
        });
        if (compErr || compOk !== true) {
          return new Response(JSON.stringify({ success: false, message: 'Không thể hoàn tất nhật ký Dry-run.' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }

      return new Response(
        JSON.stringify(dryRunResponse),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    if (!batchId || !claimToken) {
      return new Response(JSON.stringify({ success: false, message: 'Batch Production không có quyền sở hữu hợp lệ.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const failRow = async (rowKey: string) => {
      const { data, error } = await supabaseAdmin.rpc('fail_student_row', {
        p_batch_id: batchId,
        p_claim_token: claimToken,
        p_row_key: rowKey,
      });
      if (error || data !== true) {
        throw new Error('ROW_STATE_UPDATE_FAILED');
      }
      return true;
    };

    for (const item of cleanedStudentsInput) {
      if (idempotencyKey && batchId && claimToken) {
        const { data: hbOk, error: hbErr } = await supabaseAdmin.rpc('heartbeat_batch_idempotency', {
          p_batch_id: batchId,
          p_claim_token: claimToken,
        });

        if (hbErr || hbOk !== true) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              message: 'Khóa xử lý Batch đã hết hạn (Lease Expired) hoặc bị chiếm quyền bởi worker khác. Dừng xử lý an toàn!' 
            }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      if (item.isInvalidInput) {
        finalResults.push({
          stt: item.stt,
          fullName: item.fullName,
          status: 'SKIPPED_INVALID_INPUT',
          note: 'Bỏ qua do dữ liệu rỗng hoặc sai độ dài.',
        });
        failedCount++;
        continue;
      }

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

      const rowMaterial = `${batchId}|${item.stt}|${item.fullName.trim().toLowerCase().replace(/\s+/g, ' ')}`;
      const rowDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rowMaterial));
      const rowKey = Array.from(new Uint8Array(rowDigest)).map(b => b.toString(16).padStart(2, '0')).join('');

      const { data: rowClaim, error: rowClaimErr } = await supabaseAdmin.rpc('claim_student_row', {
        p_batch_id: batchId,
        p_claim_token: claimToken,
        p_row_key: rowKey,
        p_stt: item.stt,
        p_full_name: item.fullName,
      });
      if (rowClaimErr || !rowClaim?.claimed) {
        if (rowClaim?.status === 'COMPLETED') {
          finalResults.push({ stt: item.stt, fullName: item.fullName,
            status: 'ALREADY_COMPLETED_NO_CREDENTIALS', studentCode: rowClaim.student_code || '-',
            studentId: rowClaim.student_id || '-', note: 'Dòng đã hoàn tất trước đó; cần cấp lại PIN nếu chưa nhận được.' });
          continue;
        }
        return new Response(JSON.stringify({ success: false, message: 'Không thể sở hữu dòng xử lý; batch đã dừng an toàn.' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { data: matchedProfiles, error: matchedProfilesErr } = await supabaseAdmin
        .from('profiles')
        .select('id, student_code, email')
        .eq('role', 'student')
        .ilike('full_name', item.fullName);

      if (matchedProfilesErr) {
        const rowFailed = await failRow(rowKey);
        if (!rowFailed) {
          return new Response(JSON.stringify({ success: false, message: 'Không thể ghi trạng thái dòng sau lỗi đối chiếu.' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ success: false, message: 'Không thể đối chiếu hồ sơ học sinh.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (matchedProfiles && matchedProfiles.length > 0) {
        if (!(await failRow(rowKey))) {
          return new Response(JSON.stringify({ success: false, message: 'Không thể ghi trạng thái dòng cần xác minh.' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        finalResults.push({
          stt: item.stt,
          fullName: item.fullName,
          status: 'SKIPPED_DUPLICATE_REQUIRES_REVIEW',
          note: `Phát hiện ${matchedProfiles.length} tài khoản trùng tên. Bắt buộc Admin xác minh UUID/Mã HS thủ công.`,
        });
        failedCount++;
        continue;
      }

      let newlyCreatedUserId: string | null = null;
      let successFullyCreated = false;
      let resultRecorded = false;

      for (let attempt = 1; attempt <= 5; attempt++) {
        const randomCodeNum = 1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000);
        const studentCode = `HS212-${randomCodeNum}`;
        const pin = (1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000)).toString();
        const internalEmail = `hs_${studentCode.toLowerCase()}@hoclapvui.edu.vn`;
        const passwordBytes = crypto.getRandomValues(new Uint8Array(24));
        const internalPassword = Array.from(passwordBytes, b => b.toString(16).padStart(2, '0')).join('');

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
          if (createAuthErr?.message?.toLowerCase().includes('already') || createAuthErr?.message?.toLowerCase().includes('unique')) {
            continue;
          }
          finalResults.push({
            stt: item.stt,
            fullName: item.fullName,
            status: 'FAILED_AUTH_CREATION',
            note: 'Không thể khởi tạo tài khoản đăng nhập.',
          });
          await failRow(rowKey);
          failedCount++;
          resultRecorded = true;
          break;
        }

        newlyCreatedUserId = authData.user.id;
        await new Promise((res) => setTimeout(res, 150));

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
          if (profileErr.code === '23505' && attempt < 5) {
            const { error: delAuthErr } = await supabaseAdmin.auth.admin.deleteUser(newlyCreatedUserId);
            if (delAuthErr) {
              await failRow(rowKey);
              finalResults.push({ stt: item.stt, fullName: item.fullName, status: 'CLEANUP_FAILED', note: 'Không thể dọn Auth sau lỗi trùng mã.' });
              failedCount++;
              resultRecorded = true;
              break;
            }
            newlyCreatedUserId = null;
            continue;
          }

          const { error: delAuthErr } = await supabaseAdmin.auth.admin.deleteUser(newlyCreatedUserId);
          finalResults.push({
            stt: item.stt,
            fullName: item.fullName,
            status: delAuthErr ? 'CLEANUP_FAILED' : 'FAILED_PROFILE_CREATION',
            note: delAuthErr ? 'Không thể dọn dẹp tài khoản Auth mồ côi.' : 'Lỗi khởi tạo hồ sơ học sinh.',
          });
          await failRow(rowKey);
          failedCount++;
          resultRecorded = true;
          break;
        }

        const { data: pinOk, error: pinErr } = await supabaseAdmin.rpc('set_student_pin_service', {
          p_student_id: newlyCreatedUserId,
          p_pin: pin,
        });

        if (pinErr || pinOk !== true) {
          const { error: delProfErr } = await supabaseAdmin.from('profiles').delete().eq('id', newlyCreatedUserId);
          const { error: delAuthErr } = await supabaseAdmin.auth.admin.deleteUser(newlyCreatedUserId);

          finalResults.push({
            stt: item.stt,
            fullName: item.fullName,
            status: (delProfErr || delAuthErr) ? 'CLEANUP_FAILED' : 'FAILED_PIN_SETTING',
            note: (delProfErr || delAuthErr) ? 'Dọn dẹp tài khoản lỗi PIN thất bại.' : 'Lỗi khởi tạo mã PIN bảo mật.',
          });
          await failRow(rowKey);
          failedCount++;
          resultRecorded = true;
          break;
        }

        const { error: cmErr } = await supabaseAdmin
          .from('class_members')
          .insert({
            class_id: classId,
            student_id: newlyCreatedUserId,
            joined_at: new Date().toISOString(),
          });

        if (cmErr) {
          const { error: delProfErr } = await supabaseAdmin.from('profiles').delete().eq('id', newlyCreatedUserId);
          const { error: delAuthErr } = await supabaseAdmin.auth.admin.deleteUser(newlyCreatedUserId);

          finalResults.push({
            stt: item.stt,
            fullName: item.fullName,
            status: (delProfErr || delAuthErr) ? 'CLEANUP_FAILED' : 'FAILED_CLASS_ASSIGNMENT',
            note: (delProfErr || delAuthErr) ? 'Dọn dẹp tài khoản lỗi gán lớp thất bại.' : 'Lỗi gán học sinh vào Lớp 2.12.',
          });
          await failRow(rowKey);
          failedCount++;
          resultRecorded = true;
          break;
        }

        const { data: rowCompleted, error: rowCompleteErr } = await supabaseAdmin.rpc('complete_student_row', {
          p_batch_id: batchId,
          p_claim_token: claimToken,
          p_row_key: rowKey,
          p_student_id: newlyCreatedUserId,
          p_student_code: studentCode,
        });
        if (rowCompleteErr || rowCompleted !== true) {
          const { error: delCmErr } = await supabaseAdmin.from('class_members').delete()
            .eq('class_id', classId).eq('student_id', newlyCreatedUserId);
          const { error: delProfErr } = await supabaseAdmin.from('profiles').delete().eq('id', newlyCreatedUserId);
          const { error: delAuthErr } = await supabaseAdmin.auth.admin.deleteUser(newlyCreatedUserId);
          await failRow(rowKey);
          finalResults.push({ stt: item.stt, fullName: item.fullName,
            status: (delCmErr || delProfErr || delAuthErr) ? 'CLEANUP_FAILED' : 'FAILED_ROW_COMPLETION',
            note: 'Không thể xác nhận tiến độ dòng; tài khoản vừa tạo đã được thu hồi.' });
          failedCount++;
          resultRecorded = true;
          break;
        }

        finalResults.push({
          stt: item.stt,
          fullName: item.fullName,
          status: 'CREATED_AND_ASSIGNED',
          studentCode,
          pin,
          studentId: newlyCreatedUserId,
          note: 'Tạo tài khoản và gán vào Lớp 2.12 thành công!',
        });
        createdCount++;
        successFullyCreated = true;
        resultRecorded = true;
        break;
      }

      if (!successFullyCreated && !resultRecorded) {
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
      replayed: false,
      credentialsAvailable: true,
      message: `Đã hoàn thành thực thi nạp batch cho Lớp 2.12.`,
      className: targetClass.name,
      classCode: targetClass.code,
      batchId,
      summary: {
        total: cleanedStudentsInput.length,
        created: createdCount,
        assignedExisting: assignedExistingCount,
        failed: failedCount,
      },
      results: finalResults,
    };

    if (idempotencyKey && batchId && claimToken) {
      const { data: compOk, error: compErr } = await supabaseAdmin.rpc('complete_batch_idempotency', {
        p_batch_id: batchId,
        p_claim_token: claimToken,
        p_response_data: prodResponse,
        p_is_success: true,
      });
      if (compErr || compOk !== true) {
        return new Response(JSON.stringify({ success: false, message: 'Tài khoản đã xử lý nhưng không thể hoàn tất batch; cần Admin kiểm tra.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    return new Response(
      JSON.stringify(prodResponse),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, message: 'Đã xảy ra lỗi hệ thống khi xử lý danh sách học sinh.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
