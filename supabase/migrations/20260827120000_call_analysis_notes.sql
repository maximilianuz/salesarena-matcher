-- Pestaña "Análisis de Llamada": cada miembro de una sala puede analizar una
-- llamada (una grabación de ejemplo que suele vivir afuera, en Skool — no se
-- puede incrustar acá) tomando notas cronometradas, clasificándolas por fase,
-- registrando objeciones, un checklist técnico y un plan de acción. Nace como
-- puerto del prototipo standalone (Analisis-de-Llamada.html) que ya usa
-- Maximiliano; acá gana persistencia real y el cruce de notas del grupo deja
-- de depender de exportar/importar archivos .json a mano.
--
-- Modelo de datos: UNA fila en call_analyses por persona+llamada (cada quien
-- arma la suya, igual que "Duplicar análisis" en el prototipo). Las notas y
-- objeciones son tablas hijas para poder filtrarlas/editarlas de a una. Los
-- demás bloques del prototipo (checklist técnico, iceberg, color de
-- personalidad, plan de cierre) son objetos chicos y de forma fija — igual
-- que como ya vivían en el JSON de sesión original — así que quedan como
-- columnas JSONB en vez de convertirse en tablas propias.
--
-- Seguridad: mismo patrón que 20260813120000 (is_room_member vía función
-- SECURITY DEFINER, sin políticas para anon). LECTURA de sala completa —así
-- funciona "Grupo": comparar lo que anotó cada uno de la misma llamada—.
-- ESCRITURA solo de quien es dueño de su propio análisis; nadie edita el
-- análisis de otro. room_id vive duplicado en notas/objeciones (no solo vía
-- join con call_analyses) para poder filtrar por sala directamente en RLS y
-- en el filtro de Realtime, igual que el resto de las tablas de la app.

-- ============================================================
-- 1. TABLAS
-- ============================================================
CREATE TABLE IF NOT EXISTS call_analyses (
  id BIGSERIAL PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  member_email TEXT NOT NULL,
  member_name TEXT NOT NULL DEFAULT '',
  -- Título de la llamada/material analizado. Varias personas usando el MISMO
  -- título es lo que la vista "Grupo" usa para saber qué análisis comparar
  -- entre sí (reemplaza al nombre del archivo exportado en el prototipo).
  titulo TEXT NOT NULL DEFAULT 'Sin título',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  principios JSONB NOT NULL DEFAULT '{}'::jsonb,
  tec JSONB NOT NULL DEFAULT '{}'::jsonb,
  ice JSONB NOT NULL DEFAULT '{}'::jsonb,
  color JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_analyses_room_idx ON call_analyses(room_id);
CREATE INDEX IF NOT EXISTS call_analyses_member_idx ON call_analyses(room_id, member_email);
CREATE INDEX IF NOT EXISTS call_analyses_titulo_idx ON call_analyses(room_id, titulo);

CREATE TABLE IF NOT EXISTS call_notes (
  id BIGSERIAL PRIMARY KEY,
  analysis_id BIGINT NOT NULL REFERENCES call_analyses(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  t INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  fase TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_notes_analysis_idx ON call_notes(analysis_id);
CREATE INDEX IF NOT EXISTS call_notes_room_idx ON call_notes(room_id);

CREATE TABLE IF NOT EXISTS call_objections (
  id BIGSERIAL PRIMARY KEY,
  analysis_id BIGINT NOT NULL REFERENCES call_analyses(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  minuto TEXT NOT NULL DEFAULT '',
  frase TEXT NOT NULL DEFAULT '',
  lecturas TEXT NOT NULL DEFAULT '',
  verificada TEXT NOT NULL DEFAULT '',
  notas TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_objections_analysis_idx ON call_objections(analysis_id);
CREATE INDEX IF NOT EXISTS call_objections_room_idx ON call_objections(room_id);

-- ============================================================
-- 2. RLS — call_analyses
-- ============================================================
ALTER TABLE call_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Room members can view call analyses" ON call_analyses;
CREATE POLICY "Room members can view call analyses"
  ON call_analyses FOR SELECT
  TO authenticated
  USING (public.is_room_member(room_id));

DROP POLICY IF EXISTS "Room members can create their own call analysis" ON call_analyses;
CREATE POLICY "Room members can create their own call analysis"
  ON call_analyses FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_room_member(room_id)
    AND lower(member_email) = lower(nullif(auth.jwt() ->> 'email', ''))
  );

DROP POLICY IF EXISTS "Owners manage their own call analysis" ON call_analyses;
CREATE POLICY "Owners manage their own call analysis"
  ON call_analyses FOR UPDATE
  TO authenticated
  USING (lower(member_email) = lower(nullif(auth.jwt() ->> 'email', '')))
  WITH CHECK (lower(member_email) = lower(nullif(auth.jwt() ->> 'email', '')));

DROP POLICY IF EXISTS "Owners delete their own call analysis" ON call_analyses;
CREATE POLICY "Owners delete their own call analysis"
  ON call_analyses FOR DELETE
  TO authenticated
  USING (lower(member_email) = lower(nullif(auth.jwt() ->> 'email', '')));

DROP POLICY IF EXISTS "Service role manages call analyses" ON call_analyses;
CREATE POLICY "Service role manages call analyses"
  ON call_analyses FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 3. RLS — call_notes (el dueño se valida contra call_analyses.member_email)
-- ============================================================
ALTER TABLE call_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Room members can view call notes" ON call_notes;
CREATE POLICY "Room members can view call notes"
  ON call_notes FOR SELECT
  TO authenticated
  USING (public.is_room_member(room_id));

DROP POLICY IF EXISTS "Owners manage notes on their own analysis" ON call_notes;
CREATE POLICY "Owners manage notes on their own analysis"
  ON call_notes FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM call_analyses a
      WHERE a.id = call_notes.analysis_id
        AND lower(a.member_email) = lower(nullif(auth.jwt() ->> 'email', ''))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM call_analyses a
      WHERE a.id = call_notes.analysis_id
        AND a.room_id = call_notes.room_id
        AND lower(a.member_email) = lower(nullif(auth.jwt() ->> 'email', ''))
    )
  );

DROP POLICY IF EXISTS "Service role manages call notes" ON call_notes;
CREATE POLICY "Service role manages call notes"
  ON call_notes FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 4. RLS — call_objections (mismo patrón que call_notes)
-- ============================================================
ALTER TABLE call_objections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Room members can view call objections" ON call_objections;
CREATE POLICY "Room members can view call objections"
  ON call_objections FOR SELECT
  TO authenticated
  USING (public.is_room_member(room_id));

DROP POLICY IF EXISTS "Owners manage objections on their own analysis" ON call_objections;
CREATE POLICY "Owners manage objections on their own analysis"
  ON call_objections FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM call_analyses a
      WHERE a.id = call_objections.analysis_id
        AND lower(a.member_email) = lower(nullif(auth.jwt() ->> 'email', ''))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM call_analyses a
      WHERE a.id = call_objections.analysis_id
        AND a.room_id = call_objections.room_id
        AND lower(a.member_email) = lower(nullif(auth.jwt() ->> 'email', ''))
    )
  );

DROP POLICY IF EXISTS "Service role manages call objections" ON call_objections;
CREATE POLICY "Service role manages call objections"
  ON call_objections FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 5. REALTIME — para que "Grupo" se actualice solo cuando otra persona anota
-- ============================================================
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['call_analyses', 'call_notes', 'call_objections']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'supabase_realtime no existe: la pestaña de análisis usará solo el refresco al volver a la pestaña.';
END $$;
