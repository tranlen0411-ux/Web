// supabase/functions/exam-record-integrity-event/index.ts
// Deno Deploy Entrypoint for Student Integrity Event BFF

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleRecordIntegrityEventRequest } from './handler.ts';

serve(async (req: Request) => {
  return await handleRecordIntegrityEventRequest(req);
});
