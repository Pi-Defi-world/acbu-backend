DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_class
		WHERE relname = 'on_ramp_swaps'
			AND relkind = 'r'
	) THEN
		CREATE INDEX IF NOT EXISTS "idx_on_ramp_swap_status_created_at"
		ON "on_ramp_swaps"("status", "created_at");
	END IF;
END $$;
