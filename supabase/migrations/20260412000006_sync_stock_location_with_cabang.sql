-- Keep legacy stock.location in sync with master cabang naming when the column exists.
-- This migration is safe for environments that no longer have stock.location.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stock'
      AND column_name = 'location'
  ) THEN
    -- Backfill existing rows to the latest cabang naming.
    UPDATE public.stock s
    SET location = c.nama_cabang
    FROM public.cabang c
    WHERE s.cabang_id = c.id
      AND s.location IS DISTINCT FROM c.nama_cabang;

    -- Ensure new/updated stock rows always use cabang name for location.
    EXECUTE $sql$
      CREATE OR REPLACE FUNCTION public.stock_sync_location_from_cabang()
      RETURNS TRIGGER AS $fn$
      BEGIN
        SELECT nama_cabang
        INTO NEW.location
        FROM public.cabang
        WHERE id = NEW.cabang_id;

        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;
    $sql$;

    DROP TRIGGER IF EXISTS tr_stock_sync_location_from_cabang ON public.stock;
    EXECUTE $sql$
      CREATE TRIGGER tr_stock_sync_location_from_cabang
      BEFORE INSERT OR UPDATE OF cabang_id
      ON public.stock
      FOR EACH ROW
      EXECUTE FUNCTION public.stock_sync_location_from_cabang();
    $sql$;

    -- Keep stock.location updated when cabang name changes.
    CREATE OR REPLACE FUNCTION public.cabang_propagate_name_to_stock_location()
    RETURNS TRIGGER AS $fn$
    BEGIN
      UPDATE public.stock
      SET location = NEW.nama_cabang
      WHERE cabang_id = NEW.id
        AND location IS DISTINCT FROM NEW.nama_cabang;

      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS tr_cabang_propagate_name_to_stock_location ON public.cabang;
    CREATE TRIGGER tr_cabang_propagate_name_to_stock_location
    AFTER UPDATE OF nama_cabang
    ON public.cabang
    FOR EACH ROW
    WHEN (OLD.nama_cabang IS DISTINCT FROM NEW.nama_cabang)
    EXECUTE FUNCTION public.cabang_propagate_name_to_stock_location();
  END IF;
END
$$;