import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ORIGINS = new Set(['https://web-len9.vercel.app','http://localhost:3000','http://localhost:5173','http://127.0.0.1:3000','http://127.0.0.1:5173']);
const headersFor = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin',
  'Cache-Control': 'no-store, no-cache, must-revalidate', 'Content-Type': 'application/json',
});

serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (!ORIGINS.has(origin)) return new Response(JSON.stringify({success:false,message:'Origin không được phép.'}),{status:403,headers:{'Content-Type':'application/json'}});
  const headers = headersFor(origin);
  if (req.method === 'OPTIONS') return new Response('ok',{headers});
  if (req.method !== 'POST') return new Response(JSON.stringify({success:false,message:'Method không hợp lệ.'}),{status:405,headers});
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return new Response(JSON.stringify({success:false,message:'Chưa đăng nhập.'}),{status:401,headers});
  const url=Deno.env.get('SUPABASE_URL')??'', anon=Deno.env.get('SUPABASE_ANON_KEY')??'', service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
  if (!url||!anon||!service) return new Response(JSON.stringify({success:false,message:'Cấu hình máy chủ chưa hoàn tất.'}),{status:500,headers});
  const callerClient=createClient(url,anon,{global:{headers:{Authorization:authHeader}}});
  const adminClient=createClient(url,service);
  const {data:{user},error:userErr}=await callerClient.auth.getUser();
  if (userErr||!user) return new Response(JSON.stringify({success:false,message:'Phiên đăng nhập không hợp lệ.'}),{status:401,headers});
  const {data:adminProfile,error:adminErr}=await adminClient.from('profiles').select('role').eq('id',user.id).maybeSingle();
  if (adminErr||adminProfile?.role!=='admin') return new Response(JSON.stringify({success:false,message:'Chỉ Admin được cấp lại PIN.'}),{status:403,headers});
  let body: {studentId?: string}; try { body=await req.json(); } catch { return new Response(JSON.stringify({success:false,message:'Dữ liệu không hợp lệ.'}),{status:400,headers}); }
  if (!body.studentId || !/^[0-9a-f-]{36}$/i.test(body.studentId)) return new Response(JSON.stringify({success:false,message:'Học sinh không hợp lệ.'}),{status:400,headers});
  const {data:student,error:studentErr}=await adminClient.from('profiles').select('id,role,is_disabled').eq('id',body.studentId).maybeSingle();
  if (studentErr||!student||student.role!=='student'||student.is_disabled===true) return new Response(JSON.stringify({success:false,message:'Không thể cấp lại PIN cho tài khoản này.'}),{status:400,headers});
  const {data:membership,error:membershipErr}=await adminClient.from('class_members')
    .select('class_id, classes!inner(code,name,grade_level)')
    .eq('student_id',student.id)
    .eq('classes.code','LOP212-3A5818')
    .eq('classes.grade_level',2)
    .maybeSingle();
  if (membershipErr||!membership) return new Response(JSON.stringify({success:false,message:'Học sinh không thuộc Lớp 2.12.'}),{status:400,headers});
  const {data:allowed,error:limitErr}=await adminClient.rpc('claim_student_pin_reset',{p_admin_id:user.id,p_student_id:student.id});
  if (limitErr||allowed!==true) return new Response(JSON.stringify({success:false,message:'Đã vượt giới hạn cấp lại PIN. Vui lòng thử sau.'}),{status:429,headers});
  const pin=crypto.getRandomValues(new Uint32Array(1))[0].toString().padStart(10,'0').slice(-4);
  const {data:pinOk,error:pinErr}=await adminClient.rpc('set_student_pin_service',{p_student_id:student.id,p_pin:pin});
  if (pinErr||pinOk!==true) return new Response(JSON.stringify({success:false,message:'Không thể cấp lại PIN.'}),{status:500,headers});
  return new Response(JSON.stringify({success:true,studentId:student.id,pin,credentialsAvailable:true}),{status:200,headers});
});
