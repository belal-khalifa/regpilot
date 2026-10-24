-- REG-256 One drop for all documents. Run once in Supabase > SQL Editor before using the branch.
-- Lets a document be stored before RegPilot knows what it is; extraction then sorts it.
-- Safe for the live site: it only adds an allowed value, nothing existing changes.
alter type public.document_type add value if not exists 'unsorted';
