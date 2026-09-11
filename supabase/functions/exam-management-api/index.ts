// supabase/functions/exam-management-api/index.ts
// Deno Deploy Entry Point for Exam Builder Management BFF

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleExamManagementRequest } from './handler.ts';

serve(async (req: Request) => {
  return await handleExamManagementRequest(req);
});
