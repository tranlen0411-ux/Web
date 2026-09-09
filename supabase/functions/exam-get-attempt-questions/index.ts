// supabase/functions/exam-get-attempt-questions/index.ts
// Deno Deploy Entrypoint for Student Get Attempt Questions BFF (Phase 3E-B0)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleGetAttemptQuestionsRequest } from './handler.ts';

serve(async (req: Request) => {
  return await handleGetAttemptQuestionsRequest(req);
});
