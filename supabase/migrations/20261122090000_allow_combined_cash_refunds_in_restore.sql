-- Restore must accept every cash receipt the checkout can produce with a
-- negative total: pure deposit returns AND sales combined with a deposit
-- return (e.g. Bregenz 21.11.2026: -1,00 / -1,80 / -3,00 €).
-- Only the validation changes. Amounts, tables, backup format, authorization,
-- empty-generation checks and the atomic insert sequence stay identical.
CREATE OR REPLACE FUNCTION woodmo_private.valid_restore_cash_refund(p_receipt jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_sale_gross numeric := 0;
  v_deposit numeric := 0;
  v_line_gross numeric;
  v_line_deposit numeric;
  v_has_return boolean := false;
BEGIN
  IF p_receipt->>'paymentMethod' IS DISTINCT FROM 'cash'
     OR jsonb_typeof(p_receipt->'items') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_receipt->'taxByRate') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_receipt->'total') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_receipt->'subtotal') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_receipt->'totalPfand') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_receipt->'totalNet') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_receipt->'totalTax') IS DISTINCT FROM 'number' THEN
    RETURN false;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_receipt->'items') LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR coalesce(v_item->>'productId', '') = ''
       OR jsonb_typeof(v_item->'quantity') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_item->'price') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_item->'pfand') IS DISTINCT FROM 'number' THEN
      RETURN false;
    END IF;
    IF (v_item->>'quantity')::numeric <= 0 THEN RETURN false; END IF;

    v_line_gross := (v_item->>'price')::numeric * (v_item->>'quantity')::numeric;
    v_line_deposit := (v_item->>'pfand')::numeric;
    IF v_item->'isPfandRetoure' = 'true'::jsonb THEN
      IF v_item->>'productId' <> '__pfand_retoure__'
         OR v_line_deposit >= 0
         OR round(v_line_gross, 2) <> round(v_line_deposit, 2)
         OR v_item->'taxRate' IS DISTINCT FROM '0'::jsonb
         OR v_item->'taxAmount' IS DISTINCT FROM '0'::jsonb THEN
        RETURN false;
      END IF;
      v_has_return := true;
    ELSE
      IF v_item->>'productId' = '__pfand_retoure__' OR v_line_gross < 0 OR v_line_deposit < 0 THEN
        RETURN false;
      END IF;
      v_sale_gross := v_sale_gross + v_line_gross;
    END IF;
    v_deposit := v_deposit + v_line_deposit;
  END LOOP;

  RETURN v_has_return
    AND (p_receipt->>'total')::numeric < 0
    AND round(v_sale_gross, 2) = round((p_receipt->>'subtotal')::numeric, 2)
    AND round(v_deposit, 2) = round((p_receipt->>'totalPfand')::numeric, 2)
    AND round(v_sale_gross + v_deposit, 2) = round((p_receipt->>'total')::numeric, 2)
    AND round((p_receipt->>'totalNet')::numeric + (p_receipt->>'totalTax')::numeric, 2) = round(v_sale_gross, 2)
    AND (v_sale_gross <> 0 OR (
      (p_receipt->>'totalNet')::numeric = 0 AND (p_receipt->>'totalTax')::numeric = 0
    ));
END;
$$;
REVOKE ALL ON FUNCTION woodmo_private.valid_restore_cash_refund(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.restore_pos_clean_backup_v3(
  p_financial jsonb, p_expected_generation bigint, p_backup_exported_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_generation bigint;
  v_sessions jsonb;
  v_transactions jsonb;
  v_stornos jsonb;
  v_session jsonb;
  v_transaction jsonb;
  v_storno jsonb;
  v_original jsonb;
  v_parent jsonb;
  v_prepared jsonb;
  v_audit_id uuid;
  v_sales_count integer;
  v_sessions_count integer;
  v_storno_count integer;
  v_inserted_sales integer;
  v_inserted_stornos integer;
BEGIN
  -- Authorize on the server: the local admin modal is NOT an auth proof.
  IF auth.uid() IS DISTINCT FROM
     (SELECT u.id FROM auth.users u WHERE u.email='admin@kasse.local' LIMIT 1) THEN
    RAISE EXCEPTION 'Backup-Wiederherstellung nur mit dem Cloud-Administratorkonto erlaubt.'
      USING ERRCODE='42501';
  END IF;
  IF p_backup_exported_at IS NULL OR p_expected_generation IS NULL OR
     p_financial IS NULL OR octet_length(p_financial::text)>15000000 THEN
    RAISE EXCEPTION 'Backup-Zeitstempel oder Umfang ungültig.';
  END IF;
  v_sessions:=p_financial->'cashSessions';
  v_transactions:=p_financial->'transactions';
  v_stornos:=p_financial->'stornos';
  IF jsonb_typeof(v_sessions)<>'array' OR
     jsonb_typeof(v_transactions)<>'array' OR
     jsonb_typeof(v_stornos)<>'array' THEN
    RAISE EXCEPTION 'Finanzdaten im Backup müssen vollständige Listen sein.';
  END IF;
  v_sessions_count:=jsonb_array_length(v_sessions);
  v_sales_count:=jsonb_array_length(v_transactions);
  v_storno_count:=jsonb_array_length(v_stornos);
  IF v_sessions_count>10000 OR v_sales_count>50000 OR v_storno_count>50000 THEN
    RAISE EXCEPTION 'Backup ist für eine einzelne Transaktion zu groß. Archiv-Massenimport erforderlich.';
  END IF;
  IF (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(v_sessions) x)<>v_sessions_count OR
     (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(v_transactions) x)<>v_sales_count OR
     (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(v_stornos) x)<>v_storno_count THEN
    RAISE EXCEPTION 'Backup enthält doppelte oder ungültige Beleg-IDs.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_sessions) s
    WHERE NOT coalesce((s->>'closed')::boolean,false)
      AND NOT coalesce((s->>'discarded')::boolean,false)
      AND s->>'closedAt' IS NULL AND s->>'dailyCloseFinalizedAt' IS NULL
      AND s->'dailyCloseSnapshot' IS NULL
    GROUP BY s->>'location' HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'Konflikt: Mehrere offene Kassen am selben Standort in der Sicherung.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('woodmo-v3-booking-generation-reset'));
  -- Prevent concurrent normal sale/storno writes during the full replay.
  LOCK TABLE public.pos_transactions, public.pos_cash_sessions, public.pos_stornos
    IN SHARE ROW EXCLUSIVE MODE;
  SELECT coalesce(max(id),0) INTO v_generation FROM public.pos_booking_resets;
  IF v_generation<>p_expected_generation THEN
    RAISE EXCEPTION 'Die Kasse wurde inzwischen zurückgesetzt: Import bitte neu prüfen.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.pos_transactions WHERE booking_generation=v_generation) OR
     EXISTS(SELECT 1 FROM public.pos_cash_sessions WHERE booking_generation=v_generation) OR
     EXISTS(SELECT 1 FROM public.pos_stornos WHERE booking_generation=v_generation) THEN
    RAISE EXCEPTION 'Import gesperrt: Die aktuelle Kasse enthält Buchungen oder Kassensitzungen.';
  END IF;

  FOR v_session IN SELECT value FROM jsonb_array_elements(v_sessions) LOOP
    IF jsonb_typeof(v_session)<>'object' OR
       coalesce(v_session->>'id','')='' OR
       v_session->>'location' NOT IN('Friedrichshafen','Bregenz') OR
       jsonb_typeof(v_session->'openingBalance')<>'number' OR
       (v_session->>'openingBalance')::numeric<0 OR
       jsonb_typeof(v_session->'openedAt')<>'number' OR
       NOT(v_session?'date') THEN
      RAISE EXCEPTION 'Ungültige Kassensitzung im Backup.';
    END IF;
    IF EXISTS(SELECT 1 FROM public.pos_cash_sessions WHERE id=v_session->>'id') THEN
      RAISE EXCEPTION 'Kassensitzungs-ID bereits im Archiv vergeben.';
    END IF;
  END LOOP;
  FOR v_transaction IN SELECT value FROM jsonb_array_elements(v_transactions) LOOP
    IF jsonb_typeof(v_transaction)<>'object' OR
       coalesce(v_transaction->>'id','')='' OR
       jsonb_typeof(v_transaction->'timestamp')<>'number' OR
       jsonb_typeof(v_transaction->'total')<>'number' OR
       ((v_transaction->>'total')::numeric<0 AND
         NOT woodmo_private.valid_restore_cash_refund(v_transaction)) OR
       v_transaction->>'paymentMethod' NOT IN('cash','card') OR
       v_transaction->>'location' NOT IN('Friedrichshafen','Bregenz') OR
       jsonb_typeof(v_transaction->'items')<>'array' OR
       jsonb_typeof(v_transaction->'taxByRate')<>'object' THEN
      RAISE EXCEPTION 'Ungültiger Originalbon im Backup.';
    END IF;
    SELECT value INTO v_parent FROM jsonb_array_elements(v_sessions)
      WHERE value->>'id'=v_transaction->>'cashSessionId';
    IF v_parent IS NULL OR v_parent->>'location'<>v_transaction->>'location' OR
       (v_transaction->>'timestamp')::numeric<(v_parent->>'openedAt')::numeric THEN
      RAISE EXCEPTION 'Buchung % hat keine passende Kassensitzung.',v_transaction->>'id';
    END IF;
    IF EXISTS(SELECT 1 FROM public.pos_transactions WHERE id=v_transaction->>'id') THEN
      RAISE EXCEPTION 'Bon-ID bereits im Archiv vergeben.';
    END IF;
  END LOOP;
  FOR v_storno IN SELECT value FROM jsonb_array_elements(v_stornos) LOOP
    IF jsonb_typeof(v_storno)<>'object' OR
       jsonb_typeof(v_storno->'originalSnapshot')<>'object' OR
       v_storno->>'paymentMethod' NOT IN('cash','card') OR
       v_storno->>'location' NOT IN('Friedrichshafen','Bregenz') OR
       length(trim(coalesce(v_storno->>'reason',''))) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'Ungültiger Stornobeleg im Backup.';
    END IF;
    SELECT value INTO v_original FROM jsonb_array_elements(v_transactions)
      WHERE value->>'id'=v_storno->>'originalTransactionId';
    IF v_original IS NULL OR
       v_original->>'cashSessionId'<>v_storno->>'cashSessionId' OR
       v_original->>'location'<>v_storno->>'location' OR
       v_original->>'paymentMethod'<>v_storno->>'paymentMethod' OR
       v_storno->'originalSnapshot'<>v_original OR
       round((v_original->>'total')::numeric*100)<>round((v_storno->>'grossAmount')::numeric*100) OR
       (v_storno->>'paymentMethod'='cash' AND
          (round((v_storno->>'cashEffect')::numeric*100) <> -round((v_original->>'total')::numeric*100) OR
           round((v_storno->>'cardEffect')::numeric*100) <> 0)) OR
       (v_storno->>'paymentMethod'='card' AND
          (round((v_storno->>'cardEffect')::numeric*100) <> -round((v_original->>'total')::numeric*100) OR
           round((v_storno->>'cashEffect')::numeric*100) <> 0)) THEN
      RAISE EXCEPTION 'Stornobeleg % passt nicht zum Originalbon.',v_storno->>'id';
    END IF;
    IF EXISTS(SELECT 1 FROM public.pos_stornos WHERE id=(v_storno->>'id')::uuid) THEN
      RAISE EXCEPTION 'Storno-ID bereits im Archiv vergeben.';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_stornos) s
            GROUP BY s->>'originalTransactionId' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Ein Originalbon hat mehrere Stornobelege.';
  END IF;

  -- Restore ONE cash session at a time, oldest first: insert it temporarily
  -- open, add its receipts and stornos, then write its final (closed) data.
  -- Only one session per location is ever open at once, so the unique index
  -- pos_cash_sessions_one_active_per_location_generation_v3 is respected even
  -- when a backup holds several sessions of the same location and day.
  -- A session that is still open in the backup (max. one per location,
  -- checked above) is restored last.
  v_inserted_sales:=0;
  v_inserted_stornos:=0;
  FOR v_session IN
    SELECT value FROM jsonb_array_elements(v_sessions)
    ORDER BY
      (NOT coalesce((value->>'closed')::boolean,false)
        AND NOT coalesce((value->>'discarded')::boolean,false)
        AND value->>'closedAt' IS NULL AND value->>'dailyCloseFinalizedAt' IS NULL
        AND value->'dailyCloseSnapshot' IS NULL),
      (value->>'openedAt')::numeric, value->>'id'
  LOOP
    v_prepared:=jsonb_set(
      v_session-'closedAt'-'dailyCloseSnapshot'-'dailyCloseFinalizedAt',
      '{closed}','false'::jsonb,true
    );
    INSERT INTO public.pos_cash_sessions(id,location,date,data,booking_generation)
      VALUES(v_session->>'id',v_session->>'location',v_session->>'date',
             v_prepared,v_generation);
    FOR v_transaction IN
      SELECT value FROM jsonb_array_elements(v_transactions)
      WHERE value->>'cashSessionId'=v_session->>'id'
      ORDER BY (value->>'timestamp')::numeric, value->>'id'
    LOOP
      INSERT INTO public.pos_transactions(id,location,timestamp,data,booking_generation)
        VALUES(v_transaction->>'id',v_transaction->>'location',
               (v_transaction->>'timestamp')::bigint,v_transaction,v_generation);
      v_inserted_sales:=v_inserted_sales+1;
    END LOOP;
    FOR v_storno IN
      SELECT value FROM jsonb_array_elements(v_stornos)
      WHERE value->>'cashSessionId'=v_session->>'id'
      ORDER BY (value->>'timestamp')::numeric, value->>'id'
    LOOP
      INSERT INTO public.pos_stornos(
        id,original_transaction_id,cash_session_id,booking_generation,
        location,recorded_at,employee_id,employee_name,reason,payment_method,
        gross_amount_cents,cash_effect_cents,card_effect_cents,original_receipt_snapshot
      ) VALUES(
        (v_storno->>'id')::uuid,v_storno->>'originalTransactionId',
        v_storno->>'cashSessionId',v_generation,v_storno->>'location',
        to_timestamp((v_storno->>'timestamp')::numeric/1000),
        (v_storno->>'employeeId')::uuid,v_storno->>'employeeName',
        v_storno->>'reason',v_storno->>'paymentMethod',
        round((v_storno->>'grossAmount')::numeric*100)::bigint,
        round((v_storno->>'cashEffect')::numeric*100)::bigint,
        round((v_storno->>'cardEffect')::numeric*100)::bigint,
        v_storno->'originalSnapshot'
      );
      v_inserted_stornos:=v_inserted_stornos+1;
    END LOOP;
    UPDATE public.pos_cash_sessions SET data=v_session
      WHERE id=v_session->>'id' AND booking_generation=v_generation;
  END LOOP;
  -- Every receipt and storno belongs to a session (validated above). If a
  -- count differs anyway, abort the whole transaction: nothing is kept.
  IF v_inserted_sales<>v_sales_count OR v_inserted_stornos<>v_storno_count THEN
    RAISE EXCEPTION 'Wiederherstellung unvollständig (% von % Bons, % von % Stornos). Es wurde nichts übernommen.',
      v_inserted_sales,v_sales_count,v_inserted_stornos,v_storno_count;
  END IF;
  INSERT INTO woodmo_private.pos_clean_restore_audit(
    restored_by,target_generation,backup_exported_at,financial_digest,
    sales_count,sessions_count,storno_count
  ) VALUES(
    auth.uid(),v_generation,p_backup_exported_at,md5(p_financial::text),
    v_sales_count,v_sessions_count,v_storno_count
  ) RETURNING id INTO v_audit_id;
  RETURN jsonb_build_object(
    'generation',v_generation,'audit_id',v_audit_id,
    'transactions',v_sales_count,'cash_sessions',v_sessions_count,'stornos',v_storno_count
  );
END;
$$;
REVOKE ALL ON FUNCTION public.restore_pos_clean_backup_v3(jsonb,bigint,timestamptz)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.restore_pos_clean_backup_v3(jsonb,bigint,timestamptz)
  TO authenticated;
