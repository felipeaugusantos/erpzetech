DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='entregas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.entregas;
  END IF;
END $$;