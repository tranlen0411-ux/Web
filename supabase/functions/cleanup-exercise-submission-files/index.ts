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
      return new Response(
        JSON.stringify({ success: false, message: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, message: 'Server environment missing Supabase configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Client với token JWT của Caller để xác minh danh tính
    const supabaseCaller = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseCaller.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, message: 'Unauthorized: Invalid user token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { paths } = await req.json();
    if (!Array.isArray(paths) || paths.length === 0) {
      return new Response(
        JSON.stringify({ success: true, deleted: [], still_referenced: [], failed: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Giới hạn tối đa 50 path mỗi payload request
    if (paths.length > 50) {
      return new Response(
        JSON.stringify({ success: false, message: 'Payload exceeds maximum limit of 50 paths per request' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Client Service Role chỉ dùng trong môi trường Edge Function bảo mật
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Lấy thông tin role người dùng
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const isAdmin = profile?.role === 'admin';
    const uniquePaths = Array.from(new Set(paths)) as string[];

    const deleted: string[] = [];
    const still_referenced: string[] = [];
    const failed: string[] = [];

    for (const filePath of uniquePaths) {
      // Xác minh học sinh chỉ được yêu cầu xóa file trong thư mục của chính mình
      if (!isAdmin && !filePath.startsWith(`${user.id}/`)) {
        failed.push(filePath);
        continue;
      }

      // Kiểm tra tham chiếu CSDL với Service Role bỏ qua RLS hạn chế
      const { data: refCheck } = await supabaseAdmin
        .from('academic_submission_answers')
        .select('id')
        .eq('file_url', filePath);

      if (refCheck && refCheck.length > 0) {
        still_referenced.push(filePath);

        // Cập nhật trạng thái job trong bảng hàng đợi
        await supabaseAdmin
          .from('exercise_file_cleanup_jobs')
          .update({ status: 'still_referenced', processed_at: new Date().toISOString() })
          .eq('file_path', filePath);
      } else {
        // CHÍNH THỨC GỌI SUPABASE STORAGE REMOVE() API (KHÔNG DÙNG SQL DELETE)
        const { error: removeErr } = await supabaseAdmin.storage
          .from('exercise-submissions')
          .remove([filePath]);

        if (removeErr) {
          console.error(`Storage API remove error for ${filePath}:`, removeErr);
          failed.push(filePath);

          await supabaseAdmin
            .from('exercise_file_cleanup_jobs')
            .update({ status: 'failed', last_error: removeErr.message, processed_at: new Date().toISOString() })
            .eq('file_path', filePath);
        } else {
          deleted.push(filePath);

          await supabaseAdmin
            .from('exercise_file_cleanup_jobs')
            .update({ status: 'deleted', processed_at: new Date().toISOString() })
            .eq('file_path', filePath);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        deleted,
        still_referenced,
        failed,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('Edge Function exception:', err);
    return new Response(
      JSON.stringify({ success: false, message: err.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
