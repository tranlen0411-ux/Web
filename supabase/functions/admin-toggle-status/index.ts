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
      return new Response(JSON.stringify({ success: false, message: 'Từ chối truy cập: Chỉ Admin mới có quyền thực hiện.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { targetUserId, isDisabled } = await req.json();

    if (!targetUserId) {
      return new Response(JSON.stringify({ success: false, message: 'Thiếu ID người dùng.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (targetUserId === caller.id) {
      return new Response(JSON.stringify({ success: false, message: 'Không thể tự khóa tài khoản đang đăng nhập.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Ban / Unban qua Supabase Auth Admin API (updateUserById với ban_duration)
    const banDuration = isDisabled ? '876000h' : 'none'; // 876000h = ~100 năm
    const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
      ban_duration: banDuration,
    });

    if (banError) {
      return new Response(JSON.stringify({ success: false, message: banError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Cập nhật đồng bộ public.profiles.is_disabled
    await supabaseAdmin
      .from('profiles')
      .update({
        is_disabled: isDisabled,
        updated_at: new Date().toISOString(),
      })
      .eq('id', targetUserId);

    return new Response(
      JSON.stringify({
        success: true,
        message: isDisabled ? 'Đã khóa tài khoản thành công.' : 'Đã mở khóa tài khoản thành công.',
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
