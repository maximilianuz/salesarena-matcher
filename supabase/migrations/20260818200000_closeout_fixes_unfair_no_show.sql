-- Corrige la ausencia automática cuando los dos dicen que la sesión SÍ se hizo.
--
-- El problema: la asistencia se registra por el click al enlace de Meet DENTRO
-- de la app. Pero la app agenda el evento en Google Calendar con recordatorios,
-- así que mucha gente entra desde ahí —desde el mail, desde la notificación del
-- teléfono— y ese camino no pasa por la app. A los 10 minutos el barrido la
-- resuelve como 'no_show' y le suma una falta. Tres faltas en el mes dejan a la
-- persona fuera de la rotación.
--
-- Y no había forma de discutirlo: el formulario de reporte manual solo aparece
-- mientras el compañero sigue 'confirmado', y el barrido ya lo había resuelto.
--
-- El arreglo usa algo que la app YA pregunta. El cierre de sesión incluye "¿la
-- sesión se hizo?", que es la única pregunta sobre un hecho COMPARTIDO. Si las
-- dos personas dicen que se hizo, entonces una ausencia marcada por el sistema
-- es simplemente falsa, y se corrige.
--
-- Tres condiciones que hacen esto seguro:
--   * Solo se tocan las filas marcadas por el SISTEMA (reported_by = 'system').
--     Un reporte hecho por una persona no se pisa nunca.
--   * Hacen falta las DOS respuestas y que NINGUNA diga 'no_se_hizo'. Nadie
--     puede borrarse una ausencia por su cuenta.
--   * Solo corrige de 'no_show' hacia 'asistio', nunca al revés.

CREATE OR REPLACE FUNCTION public.reconcile_attendance_from_closeouts(p_meeting_id UUID)
RETURNS INT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_respuestas INT;
  v_niegan     INT;
  v_corregidas INT := 0;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE happened = 'no_se_hizo')
  INTO v_respuestas, v_niegan
  FROM public.session_closeouts
  WHERE meeting_id = p_meeting_id;

  -- Sin las dos respuestas no hay consenso, y con una sola negando la sesión
  -- queda en disputa: en los dos casos no se toca nada.
  IF v_respuestas < 2 OR v_niegan > 0 THEN
    RETURN 0;
  END IF;

  -- La puntualidad queda en NULL a propósito: el cierre no pregunta si alguien
  -- llegó tarde, y el score trata NULL como "a tiempo". Ante la duda se resuelve
  -- a favor de quien estuvo, que es de quien ya sabemos que la sesión ocurrió.
  UPDATE public.meeting_attendees
  SET status = 'asistio',
      punctuality = NULL,
      reported_by = 'closeout_consensus',
      reported_at = now()
  WHERE meeting_id = p_meeting_id
    AND status = 'no_show'
    AND reported_by = 'system';

  GET DIAGNOSTICS v_corregidas = ROW_COUNT;
  RETURN v_corregidas;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_attendance_from_closeouts(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reconcile_attendance_from_closeouts(uuid) TO service_role;

-- Se engancha al final de submit_session_closeout: la corrección ocurre en el
-- momento en que la segunda respuesta completa el consenso, sin que nadie tenga
-- que reclamar nada ni esperar a la próxima corrida del cron.
CREATE OR REPLACE FUNCTION public.submit_session_closeout(
  p_meeting_id UUID,
  p_happened TEXT,
  p_engagement TEXT,
  p_learned TEXT,
  p_cordial BOOLEAN,
  p_concern TEXT DEFAULT NULL,
  p_praise TEXT DEFAULT NULL
)
RETURNS public.session_closeouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email   TEXT := lower(nullif(auth.jwt() ->> 'email', ''));
  v_subject TEXT;
  v_room    TEXT;
  v_end     TIMESTAMPTZ;
  v_row     public.session_closeouts;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_meeting_participant(p_meeting_id) THEN
    RAISE EXCEPTION 'NOT_A_PARTICIPANT' USING ERRCODE = '42501';
  END IF;

  SELECT m.room_id INTO v_room FROM public.meetings m WHERE m.id = p_meeting_id;
  IF v_room IS NULL THEN
    RAISE EXCEPTION 'MEETING_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_end := public.meeting_end_at(p_meeting_id);
  IF v_end IS NULL OR now() < v_end THEN
    RAISE EXCEPTION 'MEETING_NOT_FINISHED' USING ERRCODE = 'P0020';
  END IF;
  IF now() > v_end + make_interval(hours => public.closeout_window_hours()) THEN
    RAISE EXCEPTION 'CLOSEOUT_WINDOW_CLOSED' USING ERRCODE = 'P0021';
  END IF;

  IF public.closeout_is_open(p_meeting_id) THEN
    RAISE EXCEPTION 'CLOSEOUT_ALREADY_OPEN' USING ERRCODE = 'P0023';
  END IF;

  SELECT lower(a.member_email) INTO v_subject
  FROM public.meeting_attendees a
  WHERE a.meeting_id = p_meeting_id AND lower(a.member_email) <> v_email
  LIMIT 1;

  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'NO_COUNTERPART' USING ERRCODE = 'P0022';
  END IF;

  INSERT INTO public.session_closeouts (
    meeting_id, room_id, author_email, subject_email,
    happened, engagement, learned, cordial, concern, praise, updated_at
  ) VALUES (
    p_meeting_id, v_room, v_email, v_subject,
    p_happened, p_engagement, p_learned, COALESCE(p_cordial, true),
    nullif(btrim(left(COALESCE(p_concern, ''), 600)), ''),
    nullif(btrim(left(COALESCE(p_praise, ''), 240)), ''),
    now()
  )
  ON CONFLICT (meeting_id, author_email) DO UPDATE SET
    happened   = EXCLUDED.happened,
    engagement = EXCLUDED.engagement,
    learned    = EXCLUDED.learned,
    cordial    = EXCLUDED.cordial,
    concern    = EXCLUDED.concern,
    praise     = EXCLUDED.praise,
    updated_at = now()
  RETURNING * INTO v_row;

  -- Si esta respuesta completó el consenso de que la sesión ocurrió, se
  -- deshacen las ausencias que el barrido automático había puesto mal.
  PERFORM public.reconcile_attendance_from_closeouts(p_meeting_id);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_session_closeout(uuid, text, text, text, boolean, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_session_closeout(uuid, text, text, text, boolean, text, text) TO authenticated;
