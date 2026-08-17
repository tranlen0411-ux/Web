import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 1. CẤU HÌNH HEADERS & CORS AN TOÀN (CÓ NO-STORE CHO PHẢN HỒI NẠP THÔNG TIN)
const getCorsHeaders = (origin: string | null) => {
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
  ];
  
  let allowOrigin = '*';
  if (origin) {
    if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      allowOrigin = origin;
    }
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  };
};

serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // Xử lý Preflight CORS OPTIONS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // =========================================================================
    // 2. XÁC THỰC ADMIN CHẶT CHẼ TỪ JWT AUTHORIZATION HEADER
    // (TUYỆT ĐỐI KHÔNG LOG JWT HOẶC HEADER BẢO MẬT)
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

    // Xác minh chữ ký & token expiry bằng Supabase Anon Client + User JWT
    const supabaseCaller = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller }, error: callerError } = await supabaseCaller.auth.getUser();
    if (callerError || !caller) {
      return new Response(
        JSON.stringify({ success: false, message: 'Từ chối truy cập: Mã token JWT không hợp lệ hoặc đã hết hạn.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // LẤY VÀ XÁC MINH USER ID TRỰC TIẾP TỪ JWT ĐÃ XÁC THỰC (KHÔNG LẤY TỪ REQUEST BODY)
    const verifiedAdminUserId = caller.id;

    // Khởi tạo Supabase Admin Client bằng Service Role Key (Chỉ sử dụng phía Server)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Tra cứu vai trò từ public.profiles bằng verifiedAdminUserId
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', verifiedAdminUserId)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== 'admin') {
      return new Response(
        JSON.stringify({ success: false, message: 'Từ chối truy cập: Chỉ tài khoản Quản trị viên (Admin) mới có quyền nhập học sinh hàng loạt.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================================
    // 3. ĐỌC & KIỂM TRA BATCH ĐẦU VÀO (GIỚI HẠN TỐI ĐA 50 DÒNG)
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

    const { classId, students, dryRun = false } = body;

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
    // 4. XÁC MINH CHÍNH XÁC LỚP ĐÍCH THUỘC "LỚP 2.12" (KHỐI 2, MÃ LOP212-3A5818)
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

    const normClassName = targetClass.name.trim().toLowerCase().replace(/\s+/g, ' ');
    if (normClassName !== 'lớp 2.12' || targetClass.grade_level !== 2 || targetClass.code !== 'LOP212-3A5818') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: `Lớp chọn không đúng thông tin Lớp 2.12 chính thức (Yêu cầu: Lớp 2.12, Khối 2, Mã: LOP212-3A5818. Hiện tại: "${targetClass.name}", Khối ${targetClass.grade_level}, Mã: "${targetClass.code}").` 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Lấy tên Giáo viên phụ trách để hiển thị báo cáo
    let teacherFullName = 'Lã Nguyễn Diễm Hương';
    if (targetClass.teacher_id) {
      const { data: teacherProf } = await supabaseAdmin
        .from('profiles')
        .select('full_name')
        .eq('id', targetClass.teacher_id)
        .maybeSingle();
      if (teacherProf?.full_name) {
        teacherFullName = teacherProf.full_name;
      }
    }

    // =========================================================================
    // 5. LOẠI BỎ DÒNG TRÙNG VÀ DÒNG KHÔNG HỢP LỆ NỘI BỘ BATCH
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
    // 6. CHẾ ĐỘ DRY-RUN (PREVIEW BẢN XEM TRƯỚC - CHƯA TẠO DỮ LIỆU)
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

        // Truy vấn profiles theo tên tiếng Việt đã gộp khoảng trắng
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
            studentCode: 'Dự kiến sinh mới',
            studentId: '-',
            note: 'Chưa có tài khoản. Sẵn sàng tạo mới Auth + Profile + PIN và gán Lớp 2.12.',
          });
          readyCount++;
        } else if (matchedProfiles.length === 1) {
          const prof = matchedProfiles[0];
          // Kiểm tra xem đã có trong class_members Lớp 2.12 chưa
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

      return new Response(
        JSON.stringify({
          success: true,
          dryRun: true,
          message: `Bản xem trước Dry-Run hoàn tất cho ${cleanedStudentsInput.length} học sinh Lớp 2.12.`,
          className: targetClass.name,
          classCode: targetClass.code,
          teacherName: teacherFullName,
          summary: {
            total: cleanedStudentsInput.length,
            readyToCreate: readyCount,
            alreadyInClass: alreadyInClassCount,
            reviewRequired: reviewRequiredCount,
          },
          results: dryResults,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================================
    // 7. THỰC THI THẬT (PRODUCTION EXECUTION WITH CLEANUP COMPENSATION)
    // =========================================================================
    // Hàm sinh mã student_code độc nhất chống trùng bằng vòng lặp EXISTS trên DB
    const generateSafeStudentCode = async (): Promise<string> => {
      let attempts = 0;
      while (attempts < 10) {
        attempts++;
        const randomNum = Math.floor(100 + Math.random() * 899); // 3 chữ số ngẫu nhiên
        const candidate = `HS212-${randomNum}`;
        
        const { data: exists } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('student_code', candidate)
          .maybeSingle();

        if (!exists) {
          return candidate;
        }
      }
      // Fallback timestamp nếu quá 10 lần trùng
      return `HS${Date.now().toString().slice(-6)}`;
    };

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
          note: `Phát hiện ${matchedProfiles.length} tài khoản trùng tên nền tảng. Cần xác minh thủ công.`,
        });
        failedCount++;
        continue;
      }

      if (matchedProfiles && matchedProfiles.length === 1) {
        const existingProf = matchedProfiles[0];
        // Kiểm tra xem đã gia nhập lớp chưa
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
            note: 'Đã có tài khoản từ trước, đã gán vào Lớp 2.12.',
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

      // NẾU CHƯA CÓ TÀI KHOẢN -> KHỞI TẠO TÀI KHOẢN MỚI 100% VỚI CLEANUP COMPENSATION
      const studentCode = await generateSafeStudentCode();
      const pin = Math.floor(1000 + Math.random() * 9000).toString(); // PIN 4 chữ số
      const internalEmail = `hs_${studentCode.toLowerCase()}@hoclapvui.edu.vn`;
      const internalPassword = `Pin_${pin}_Auth!`;

      let newlyCreatedUserId: string | null = null;

      try {
        // Bước 1: Tạo Auth User
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
          finalResults.push({
            stt: item.stt,
            fullName: item.fullName,
            status: 'FAILED_AUTH_CREATION',
            note: `Lỗi tạo Auth: ${createAuthErr?.message || 'Không thể tạo Auth User'}`,
          });
          failedCount++;
          continue;
        }

        newlyCreatedUserId = authData.user.id;

        // Đợi 200ms cho trigger handle_new_user
        await new Promise((res) => setTimeout(res, 200));

        // Bước 2: Upsert public.profiles
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
          // CLEANUP COMPENSATION: Xóa Auth User mới tạo nếu Profile thất bại
          await supabaseAdmin.auth.admin.deleteUser(newlyCreatedUserId);
          finalResults.push({
            stt: item.stt,
            fullName: item.fullName,
            status: 'FAILED_PROFILE_CREATION',
            note: `Lỗi tạo Profile: ${profileErr.message}. Đã dọn dẹp Auth User mồ côi.`,
          });
          failedCount++;
          continue;
        }

        // Bước 3: Đặt PIN Hash qua RPC set_student_pin
        const { error: pinErr } = await supabaseAdmin.rpc('set_student_pin', {
          p_student_id: newlyCreatedUserId,
          p_pin: pin,
        });

        if (pinErr) {
          console.error(`Lỗi gán PIN cho ${studentCode}:`, pinErr.message);
        }

        // Bước 4: Thêm vào class_members
        const { error: cmErr } = await supabaseAdmin
          .from('class_members')
          .insert({
            class_id: classId,
            student_id: newlyCreatedUserId,
            joined_at: new Date().toISOString(),
          });

        if (cmErr) {
          // CLEANUP COMPENSATION: Xóa Auth User & Profile mới tạo nếu Class Member thất bại
          await supabaseAdmin.from('profiles').delete().eq('id', newlyCreatedUserId);
          await supabaseAdmin.auth.admin.deleteUser(newlyCreatedUserId);
          finalResults.push({
            stt: item.stt,
            fullName: item.fullName,
            status: 'FAILED_CLASS_ASSIGNMENT',
            note: `Lỗi gán lớp: ${cmErr.message}. Đã dọn dẹp tài khoản mồ côi.`,
          });
          failedCount++;
          continue;
        }

        // HOÀN TẤT THÀNH CÔNG 100%
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

      } catch (procErr: any) {
        // Cleanup compensation an toàn nếu gặp exception ngoài dự kiến
        if (newlyCreatedUserId) {
          try { await supabaseAdmin.from('class_members').delete().eq('student_id', newlyCreatedUserId); } catch (_e) {}
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
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dryRun: false,
        message: `Đã hoàn thành thực thi tạo batch cho Lớp 2.12.`,
        className: targetClass.name,
        classCode: targetClass.code,
        summary: {
          total: cleanedStudentsInput.length,
          created: createdCount,
          assignedExisting: assignedExistingCount,
          failed: failedCount,
        },
        results: finalResults,
      }),
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
