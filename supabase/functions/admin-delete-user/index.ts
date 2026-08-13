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

    // 1. Xác thực Caller
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

    // 2. Admin Client (Server-side)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 3. Kiểm tra vai trò Admin
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single();

    if (callerProfile?.role !== 'admin') {
      return new Response(JSON.stringify({ success: false, message: 'Từ chối truy cập: Chỉ Admin mới có quyền xóa tài khoản.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { targetUserId, reassignTeacherId } = await req.json();

    if (!targetUserId) {
      return new Response(JSON.stringify({ success: false, message: 'Thiếu ID người dùng.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (targetUserId === caller.id) {
      return new Response(JSON.stringify({ success: false, message: 'Không thể tự xóa tài khoản đang đăng nhập.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Kiểm tra xem người bị xóa có phải Giáo viên đang quản lý lớp không
    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', targetUserId)
      .single();

    if (targetProfile?.role === 'teacher') {
      const { count } = await supabaseAdmin
        .from('classes')
        .select('*', { count: 'exact', head: true })
        .eq('teacher_id', targetUserId);

      if (count && count > 0) {
        if (!reassignTeacherId) {
          return new Response(
            JSON.stringify({
              success: false,
              message: `Giáo viên này đang quản lý ${count} lớp học. Vui lòng chọn Giáo viên mới để nhận lớp trước khi xóa.`,
              requires_reassign: true,
              owned_classes_count: count,
            }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        // Chuyển giao các lớp học sang Giáo viên mới
        await supabaseAdmin
          .from('classes')
          .update({ teacher_id: reassignTeacherId })
          .eq('teacher_id', targetUserId);
      }
    }

    // 5. Xóa Auth User bằng Supabase Admin API (deleteUser)
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);

    if (deleteError) {
      return new Response(JSON.stringify({ success: false, message: deleteError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Đã xóa tài khoản thành công.',
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
