-- Add goal metadata to challenges
DO $$
BEGIN
  CREATE TYPE public.challenge_metric_type AS ENUM ('manual', 'distance', 'duration', 'elevation', 'steps');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE IF EXISTS public.challenges
  ADD COLUMN IF NOT EXISTS metric_type public.challenge_metric_type NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS target_value numeric,
  ADD COLUMN IF NOT EXISTS target_unit text,
  ADD COLUMN IF NOT EXISTS activity_types text[] DEFAULT '{}'::text[];

UPDATE public.challenges
SET metric_type = COALESCE(metric_type, 'manual')
WHERE metric_type IS NULL;

UPDATE public.challenges
SET activity_types = COALESCE(activity_types, '{}'::text[])
WHERE activity_types IS NULL;
