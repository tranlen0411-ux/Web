// supabase/functions/question-bank-api/index.ts
// Question Bank User-Facing BFF REST Router V1 Entrypoint

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleQuestionBankRequest } from './router.ts';

serve((req: Request): Promise<Response> => handleQuestionBankRequest(req));
