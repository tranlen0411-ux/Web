import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
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

    // 1. Xác thực Caller bằng Anon Key + User JWT
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

    // 2. Tạo Admin Client sử dụng Service Role Key (Server-side)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 3. Kiểm tra vai trò Admin của Caller từ public.profiles
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single();

    if (callerProfile?.role !== 'admin') {
      return new Response(JSON.stringify({ success: false, message: 'Từ chối truy cập: Chỉ Admin mới có quyền tạo tài khoản.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Lấy thông tin đầu vào
    const { email, password, fullName, role, gradeLevel } = await req.json();

    if (!email || !password || !fullName) {
      return new Response(JSON.stringify({ success: false, message: 'Thiếu thông tin bắt buộc.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const targetRole = role === 'teacher' ? 'teacher' : 'student';
    const parsedGrade = parseInt(gradeLevel);
    const targetGrade = (!isNaN(parsedGrade) && parsedGrade >= 1 && parsedGrade <= 5) ? parsedGrade : 1;

    // 5. Tạo Auth User bằng Supabase Admin API (duy nhất 1 lần)
    const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName.trim(),
        role: targetRole,
        grade_level: targetGrade,
      },
    });

    if (createError || !authData?.user) {
      return new Response(JSON.stringify({ success: false, message: createError?.message || 'Không thể tạo tài khoản Auth.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newUserId = authData.user.id;

    // 6. Đợi Trigger handle_new_user() hoàn tất trước khi cập nhật hồ sơ
    await new Promise((res) => setTimeout(res, 500));

    // 7. Cập nhật hồ sơ (Profile) kèm sinh student_code duy nhất cho Học sinh (Student)
    let assignedStudentCode: string | null = null;
    let profileUpdateSuccess = false;
    let lastProfileError: any = null;

    if (targetRole === 'teacher') {
      // Đối với Giáo viên: Không gán student_code
      const { error: teacherProfErr } = await supabaseAdmin
        .from('profiles')
        .upsert({
          id: newUserId,
          email: email.trim().toLowerCase(),
          full_name: fullName.trim(),
          role: 'teacher',
          grade_level: targetGrade,
          student_code: null,
          is_disabled: false,
          updated_at: new Date().toISOString(),
        });

      if (!teacherProfErr) {
        profileUpdateSuccess = true;
      } else {
        lastProfileError = teacherProfErr;
      }
    } else {
      // Đối với Học sinh: Sinh student_code dạng HS<grade>-<4 chữ số ngẫu nhiên>, retry tối đa 5 lần nếu trùng mã (Postgres 23505)
      const prefix = `HS${targetGrade}`;

      for (let attempt = 1; attempt <= 5; attempt++) {
        const randomCodeNum = 1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000);
        const studentCode = `${prefix}-${randomCodeNum}`;

        const { error: studentProfErr } = await supabaseAdmin
          .from('profiles')
          .upsert({
            id: newUserId,
            email: email.trim().toLowerCase(),
            full_name: fullName.trim(),
            role: 'student',
            grade_level: targetGrade,
            student_code: studentCode,
            is_disabled: false,
            updated_at: new Date().toISOString(),
          });

        if (!studentProfErr) {
          assignedStudentCode = studentCode;
          profileUpdateSuccess = true;
          break;
        }

        lastProfileError = studentProfErr;

        // Nếu gặp lỗi vi phạm ràng buộc UNIQUE (23505), thử lại với mã mới cho CÙNG Auth user UUID
        if (studentProfErr.code === '23505' && attempt < 5) {
          continue;
        }

        // Lỗi khác hoặc đã hết 5 lần thử -> Dừng vòng lặp để thực hiện bồi hoàn an toàn
        break;
      }
    }

    // 8. Xử lý bồi hoàn an toàn tuần tự (Sequential Compensation Safety) nếu cập nhật Profile thất bại
    if (!profileUpdateSuccess) {
      // 8.1. Thu hồi tài khoản Auth trước
      const { error: delAuthErr } = await supabaseAdmin.auth.admin.deleteUser(newUserId);
      if (delAuthErr) {
        return new Response(
          JSON.stringify({
            success: false,
            code: 'CLEANUP_FAILED',
            message: 'Tạo tài khoản thất bại và không thể dọn dẹp tài khoản Auth mồ côi.',
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 8.2. Chỉ khi xóa Auth thành công mới tiến hành dọn dẹp Profile (nếu chưa bị xóa phân tầng)
      const { error: delProfErr } = await supabaseAdmin.from('profiles').delete().eq('id', newUserId);
      if (delProfErr) {
        return new Response(
          JSON.stringify({
            success: false,
            code: 'CLEANUP_FAILED',
            message: 'Tạo tài khoản thất bại và không thể hoàn tất dọn dẹp hồ sơ.',
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 8.3. Dọn dẹp hoàn tất an toàn -> Trả về lỗi tạo hồ sơ ban đầu
      return new Response(
        JSON.stringify({
          success: false,
          message: lastProfileError?.message || 'Không thể khởi tạo hồ sơ người dùng sau các lần thử.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 9. Trả về kết quả thành công
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Tạo tài khoản mới thành công!',
        user: authData.user,
        studentCode: assignedStudentCode || undefined,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, message: err.message || 'Lỗi server-side.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
