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

    const body = await req.json();
    const jobIds = body?.job_ids;
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, deleted: [], still_referenced: [], failed: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Giới hạn tối đa 50 job IDs mỗi payload request
    if (jobIds.length > 50) {
      return new Response(
        JSON.stringify({ success: false, message: 'Payload exceeds maximum limit of 50 job_ids per request' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Client Service Role chỉ dùng trong môi trường Edge Function bảo mật
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Lấy thông tin role người dùng và kiểm tra lỗi profileError
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('Profile fetch error:', profileError);
      return new Response(
        JSON.stringify({ success: false, message: 'Failed to verify user profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isAdmin = profile?.role === 'admin';
    const uniqueJobIds = Array.from(new Set(jobIds)) as string[];

    // 3. Truy vấn các jobs thực tế từ Bảng Hàng Đợi exercise_file_cleanup_jobs
    const { data: jobs, error: jobsError } = await supabaseAdmin
      .from('exercise_file_cleanup_jobs')
      .select('*')
      .in('id', uniqueJobIds);

    if (jobsError) {
      console.error('Jobs fetch error:', jobsError);
      return new Response(
        JSON.stringify({ success: false, message: 'Failed to query cleanup jobs' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const deleted: string[] = [];
    const still_referenced: string[] = [];
    const failed: Array<{ job_id: string; file_path: string; reason: string }> = [];

    for (const job of jobs || []) {
      const jobId = job.id;
      const filePath = job.file_path;

      // Xác minh điều kiện job hợp lệ
      if (job.bucket_id !== 'exercise-submissions') {
        failed.push({ job_id: jobId, file_path: filePath, reason: 'invalid_bucket' });
        continue;
      }

      if (!['pending', 'failed'].includes(job.status)) {
        failed.push({ job_id: jobId, file_path: filePath, reason: 'invalid_job_status' });
        continue;
      }

      if (!isAdmin && job.requested_by !== user.id) {
        failed.push({ job_id: jobId, file_path: filePath, reason: 'unauthorized_job_owner' });
        continue;
      }

      // Validate format file_path trong CSDL
      if (
        typeof filePath !== 'string' ||
        !filePath.trim() ||
        filePath.includes('..') ||
        filePath.startsWith('/') ||
        filePath.length > 500
      ) {
        failed.push({ job_id: jobId, file_path: String(filePath), reason: 'invalid_path_format' });
        continue;
      }

      // Claim job status = 'processing' một cách nguyên tử
      const { data: claimData, error: claimErr } = await supabaseAdmin
        .from('exercise_file_cleanup_jobs')
        .update({ status: 'processing' })
        .eq('id', jobId)
        .in('status', ['pending', 'failed'])
        .select('id');

      if (claimErr || !claimData || claimData.length === 0) {
        console.error(`Failed to claim job ${jobId}:`, claimErr);
        failed.push({ job_id: jobId, file_path: filePath, reason: 'job_claim_failed' });
        continue;
      }

      // FAIL-CLOSED SECURITY PATTERN: Kiểm tra tham chiếu CSDL với Service Role
      const { data: refCheck, error: refError } = await supabaseAdmin
        .from('academic_submission_answers')
        .select('id')
        .eq('file_url', filePath);

      // BẤT KỲ LỖI TRUY VẤN CSDL NÀO ĐỀU PHẢI CHẶN VÀ KHÔNG XÓA FILE (FAIL-CLOSED)
      if (refError) {
        console.error(`Ref check DB error for job ${jobId} (${filePath}):`, refError);
        failed.push({ job_id: jobId, file_path: filePath, reason: 'reference_check_failed' });

        await supabaseAdmin
          .from('exercise_file_cleanup_jobs')
          .update({ status: 'failed', last_error: refError.message, processed_at: new Date().toISOString() })
          .eq('id', jobId);
        continue;
      }

      if (refCheck && refCheck.length > 0) {
        still_referenced.push(filePath);

        await supabaseAdmin
          .from('exercise_file_cleanup_jobs')
          .update({ status: 'still_referenced', processed_at: new Date().toISOString() })
          .eq('id', jobId);
        continue;
      }

      // CHÍNH THỨC GỌI SUPABASE STORAGE REMOVE() API (KHÔNG DÙNG SQL DELETE METADATA)
      const { error: removeErr } = await supabaseAdmin.storage
        .from('exercise-submissions')
        .remove([filePath]);

      if (removeErr) {
        console.error(`Storage API remove error for job ${jobId} (${filePath}):`, removeErr);
        failed.push({ job_id: jobId, file_path: filePath, reason: removeErr.message });

        await supabaseAdmin
          .from('exercise_file_cleanup_jobs')
          .update({ status: 'failed', last_error: removeErr.message, processed_at: new Date().toISOString() })
          .eq('id', jobId);
      } else {
        deleted.push(filePath);

        await supabaseAdmin
          .from('exercise_file_cleanup_jobs')
          .update({ status: 'deleted', processed_at: new Date().toISOString() })
          .eq('id', jobId);
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
