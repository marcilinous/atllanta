-- candidates.name is a legacy duplicate of full_name (the app writes full_name
-- and reads full_name || name), but was NOT NULL with no default, so UI
-- candidate creation (which only sets full_name) failed. Make it nullable.
ALTER TABLE public.candidates ALTER COLUMN name DROP NOT NULL;