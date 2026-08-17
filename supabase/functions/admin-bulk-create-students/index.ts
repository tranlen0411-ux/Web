import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // 1. Kiểm tra JWT Authorization Header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, message: 'Chưa đăng nhập.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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

    // 2. Xác thực Caller bằng Anon Client + Authorization JWT
    const supabaseCaller = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller }, error: callerError } = await supabaseCaller.auth.getUser();
    if (callerError || !caller) {
      return new Response(JSON.stringify({ success: false, message: 'Phiên làm việc hết hạn.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Khởi tạo Admin Client bằng Service Role Key (Chạy an toàn trên Server)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 4. Phân quyền: Chỉ cho phép profiles.role = 'admin' (Từ chối teacher, student, anon, role NULL)
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== 'admin') {
      return new Response(
        JSON.stringify({ success: false, message: 'Từ chối truy cập: Chỉ Quản trị viên mới có quyền tạo học sinh hàng loạt.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Đọc Dữ Liệu Đầu Vào
    let body: any = {};
    try {
      body = await req.json();
    } catch (_e) {
      return new Response(
        JSON.stringify({ success: false, message: 'Dữ liệu JSON gửi lên không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { classId, students } = body;

    if (!classId || !students || !Array.isArray(students) || students.length === 0) {
      return new Response(
        JSON.stringify({ success: false, message: 'Vui lòng cung cấp Lớp học và danh sách học sinh hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 6. Kiểm tra Lớp Đích Tồn Tại
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

    const targetGrade = targetClass.grade_level || 2;

    // 7. Lấy danh sách student_code hiện có để tạo mã không trùng
    const { data: existingProfiles } = await supabaseAdmin
      .from('profiles')
      .select('student_code')
      .eq('role', 'student')
      .not('student_code', 'is', null);

    const usedCodes = new Set<string>();
    let maxNumericCode = 200;

    (existingProfiles || []).forEach((p: any) => {
      if (p.student_code) {
        const codeStr = p.student_code.trim().toUpperCase();
        usedCodes.add(codeStr);
        const match = codeStr.match(/^HS(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNumericCode) {
            maxNumericCode = num;
          }
        }
      }
    });

    const generateUniqueStudentCode = (): string => {
      let candidate = '';
      do {
        maxNumericCode++;
        candidate = `HS${maxNumericCode}`;
      } while (usedCodes.has(candidate));
      usedCodes.add(candidate);
      return candidate;
    };

    const results: Array<{
      stt: number;
      fullName: string;
      status: string;
      studentCode?: string;
      pin?: string;
      studentId?: string;
      note: string;
    }> = [];

    let createdCount = 0;
    let alreadyExistsCount = 0;
    let failedCount = 0;

    // 8. Vòng Lặp Xử Lý Từng Học Sinh Trong Batch
    for (const item of students) {
      const stt = item.stt || results.length + 1;
      const rawName = item.fullName || item.full_name || '';
      const cleanName = rawName.trim().replace(/\s+/g, ' ');

      if (!cleanName) {
        results.push({
          stt,
          fullName: 'Chưa đặt tên',
          status: 'FAILED_VALIDATION',
          note: 'Họ và tên không được để trống.',
        });
        failedCount++;
        continue;
      }

      // Kiểm tra xem đã có profile học sinh khớp họ tên hay chưa
      const { data: matchedProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id, student_code, email')
        .eq('role', 'student')
        .ilike('full_name', cleanName);

      if (matchedProfiles && matchedProfiles.length > 0) {
        const existingProfile = matchedProfiles[0];
        
        // Kiểm tra xem đã gia nhập lớp chưa
        const { data: memberRecord } = await supabaseAdmin
          .from('class_members')
          .select('id')
          .eq('class_id', classId)
          .eq('student_id', existingProfile.id)
          .maybeSingle();

        if (!memberRecord) {
          // Thêm vào class_members của lớp đích
          await supabaseAdmin
            .from('class_members')
            .insert({
              class_id: classId,
              student_id: existingProfile.id,
              joined_at: new Date().toISOString(),
            });
        }

        results.push({
          stt,
          fullName: cleanName,
          status: 'ALREADY_EXISTS',
          studentCode: existingProfile.student_code || '-',
          studentId: existingProfile.id,
          note: memberRecord ? 'Tài khoản đã tồn tại và đã ở trong lớp.' : 'Tài khoản đã tồn tại, vừa gán vào lớp.',
        });
        alreadyExistsCount++;
        continue;
      }

      // Chưa có tài khoản -> Tạo mới Auth User + Profile + PIN + Class Member
      const studentCode = generateUniqueStudentCode();
      const pin = Math.floor(1000 + Math.random() * 9000).toString(); // PIN 4 chữ số
      const internalEmail = `hs_${studentCode.toLowerCase()}@hoclapvui.edu.vn`;
      const internalPassword = `Pin_${pin}_Auth!`;

      // 8.A: Tạo Auth User
      const { data: authData, error: createAuthErr } = await supabaseAdmin.auth.admin.createUser({
        email: internalEmail,
        password: internalPassword,
        email_confirm: true,
        user_metadata: {
          full_name: cleanName,
          role: 'student',
          grade_level: targetGrade,
          student_code: studentCode,
        },
      });

      if (createAuthErr || !authData?.user) {
        results.push({
          stt,
          fullName: cleanName,
          status: 'FAILED_AUTH',
          note: `Lỗi tạo Auth: ${createAuthErr?.message || 'Không thể khởi tạo Auth User'}`,
        });
        failedCount++;
        continue;
      }

      const newUserId = authData.user.id;

      try {
        // 8.B: Đợi trigger tự động khởi tạo profile và cập nhật thông tin chuẩn
        await new Promise((res) => setTimeout(res, 200));

        const { error: profileErr } = await supabaseAdmin
          .from('profiles')
          .upsert({
            id: newUserId,
            email: internalEmail,
            full_name: cleanName,
            role: 'student',
            grade_level: targetGrade,
            student_code: studentCode,
            is_disabled: false,
            updated_at: new Date().toISOString(),
          });

        if (profileErr) {
          // Cleanup compensation: Xóa Auth User mồ côi nếu tạo Profile thất bại
          await supabaseAdmin.auth.admin.deleteUser(newUserId);
          results.push({
            stt,
            fullName: cleanName,
            status: 'FAILED_PROFILE',
            note: `Lỗi tạo Profile: ${profileErr.message}. Đã rollback Auth User.`,
          });
          failedCount++;
          continue;
        }

        // 8.C: Đặt mã PIN Hash bằng RPC set_student_pin
        const { error: pinErr } = await supabaseAdmin.rpc('set_student_pin', {
          p_student_id: newUserId,
          p_pin: pin,
        });

        if (pinErr) {
          console.error(`Warning setting PIN for ${studentCode}:`, pinErr.message);
        }

        // 8.D: Gán vào class_members
        const { error: cmErr } = await supabaseAdmin
          .from('class_members')
          .insert({
            class_id: classId,
            student_id: newUserId,
            joined_at: new Date().toISOString(),
          });

        if (cmErr) {
          // Rollback nếu gán lớp thất bại
          await supabaseAdmin.auth.admin.deleteUser(newUserId);
          results.push({
            stt,
            fullName: cleanName,
            status: 'FAILED_CLASS_ASSIGNMENT',
            note: `Lỗi gán lớp: ${cmErr.message}. Đã rollback tài khoản.`,
          });
          failedCount++;
          continue;
        }

        // Thành công 100%! Trả về thông tin đăng nhập CHỈ TRONG HTTP RESPONSE (Không log)
        results.push({
          stt,
          fullName: cleanName,
          status: 'CREATED_AND_ASSIGNED',
          studentCode,
          pin,
          studentId: newUserId,
          note: 'Tạo tài khoản và gán lớp 2.12 thành công!',
        });
        createdCount++;

      } catch (procErr: any) {
        // Rollback an toàn nếu có exception bất ngờ
        await supabaseAdmin.auth.admin.deleteUser(newUserId).catch(() => {});
        results.push({
          stt,
          fullName: cleanName,
          status: 'FAILED_PROCESS',
          note: `Lỗi xử lý: ${procErr.message || 'Lỗi server-side'}. Đã rollback tài khoản.`,
        });
        failedCount++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Đã hoàn tất xử lý batch ${students.length} học sinh.`,
        summary: {
          total: students.length,
          created: createdCount,
          alreadyExists: alreadyExistsCount,
          failed: failedCount,
        },
        className: targetClass.name,
        classCode: targetClass.code,
        results,
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
