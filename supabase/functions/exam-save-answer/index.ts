// supabase/functions/exam-save-answer/index.ts
// Deno Deploy Entrypoint for Student Save Answer BFF

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleSaveAnswerRequest } from './handler.ts';

serve(async (req: Request) => {
  return await handleSaveAnswerRequest(req);
});
