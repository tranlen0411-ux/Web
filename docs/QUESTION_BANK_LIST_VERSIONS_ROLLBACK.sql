-- docs/QUESTION_BANK_LIST_VERSIONS_ROLLBACK.sql
-- Rollback for Question Bank Version History RPC
-- Target Database: szptvqkoiphrhlionfoh (Supabase NEW)

DROP FUNCTION IF EXISTS public.rpc_qb_list_versions(UUID, TEXT, UUID);
