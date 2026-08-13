-- Auditoría 2026-08-13 — Hallazgo 02: sumarse a una sala exige código de acceso.
--
-- Hasta ahora, cualquiera que iniciara sesión con Google y llegara a la URL de
-- una sala quedaba registrado automáticamente. El "enlace de invitación" no
-- protegía nada: era una URL adivinable.
--
-- A partir de acá el alta pasa por join_room(), que valida un código por sala.
-- El enlace de invitación lo lleva incluido (?code=...), así que para quien
-- recibe la invitación el flujo no cambia: abre el link y entra. Lo que ya no
-- se puede es entrar adivinando la URL.
--
-- POR QUÉ UNA TABLA APARTE Y NO rooms.invite_code: la app necesita leer `rooms`
-- para saber si una sala existe antes de que la persona sea miembro. Si el
-- código viviera en esa misma fila, cualquier usuario autenticado podría leerlo
-- con un SELECT y el control no serviría de nada. En una tabla propia sin
-- políticas para anon/authenticated, el código solo es accesible a través de
-- las funciones SECURITY DEFINER de abajo, que verifican quién pregunta.
--
-- Los miembros ACTUALES no se ven afectados: join_room solo interviene en altas
-- nuevas y es idempotente para quien ya pertenece a la sala.

-- ============================================================
-- 1. TABLA DE CÓDIGOS
-- ============================================================
CREATE TABLE IF NOT EXISTS room_access_codes (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE room_access_codes ENABLE ROW LEVEL SECURITY;

-- Deliberadamente SIN políticas para anon/authenticated: nadie lee esta tabla
-- directamente desde el cliente. Todo acceso pasa por las funciones de abajo.
DROP POLICY IF EXISTS "Service role manages access codes" ON room_access_codes;
CREATE POLICY "Service role manages access codes"
  ON room_access_codes FOR ALL TO service_role USING (true) WITH CHECK (true);

-- rooms.invite_code quedó sin uso (ningún código del cliente lo lee ni escribe)
-- y su presencia invita a confundirlo con el código real. Se elimina.
ALTER TABLE rooms DROP COLUMN IF EXISTS invite_code;

-- ============================================================
-- 2. GENERACIÓN DE CÓDIGOS
-- ============================================================
-- Alfabeto sin caracteres ambiguos (0/O, 1/I/L) para que el código se pueda
-- dictar por teléfono sin errores.
CREATE OR REPLACE FUNCTION public.generate_access_code()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public, pg_temp
AS $$
  SELECT string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
           (floor(random() * 31) + 1)::int, 1),
    ''
  )
  FROM generate_series(1, 8);
$$;

-- Toda sala existente recibe un código. Sin esto, ninguna sala admitiría altas
-- nuevas (join_room rechaza las salas sin código configurado).
INSERT INTO room_access_codes (room_id, code)
SELECT r.id, public.generate_access_code()
FROM rooms r
ON CONFLICT (room_id) DO NOTHING;

-- ============================================================
-- 3. ALTA VALIDADA
-- ============================================================
-- SECURITY DEFINER: corre como su dueño, así que puede insertar en members
-- aunque la política de INSERT de esa tabla solo permita el alta manual del
-- administrador. Es el único camino de auto-registro.
CREATE OR REPLACE FUNCTION public.join_room(
  p_room_id TEXT,
  p_access_code TEXT,
  p_name TEXT,
  p_country TEXT,
  p_timezone TEXT
)
RETURNS public.members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email    TEXT := lower(nullif(auth.jwt() ->> 'email', ''));
  v_expected TEXT;
  v_row      public.members;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;

  -- Idempotente: quien ya es miembro entra sin volver a validar el código.
  -- Cubre el doble callback de OAuth y las invitaciones reenviadas.
  SELECT * INTO v_row
  FROM public.members
  WHERE room_id = p_room_id AND lower(email) = v_email;
  IF FOUND THEN
    RETURN v_row;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = p_room_id) THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT code INTO v_expected FROM public.room_access_codes WHERE room_id = p_room_id;

  -- El administrador de plataforma entra siempre: es quien crea las salas y
  -- necesita poder entrar a una recién creada antes de repartir su código.
  IF NOT public.is_platform_admin() THEN
    IF v_expected IS NULL THEN
      RAISE EXCEPTION 'ROOM_CLOSED' USING ERRCODE = 'P0003';
    END IF;
    IF p_access_code IS NULL OR upper(btrim(p_access_code)) <> upper(v_expected) THEN
      RAISE EXCEPTION 'INVALID_CODE' USING ERRCODE = 'P0004';
    END IF;
  END IF;

  INSERT INTO public.members (room_id, email, name, country, timezone, active)
  VALUES (p_room_id, v_email, btrim(p_name), p_country, p_timezone, true)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ============================================================
-- 4. LECTURA Y ROTACIÓN DEL CÓDIGO (solo quien administra)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_room_access_code(p_room_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_code TEXT;
BEGIN
  IF NOT public.is_room_admin(p_room_id) THEN
    RAISE EXCEPTION 'NOT_ROOM_ADMIN' USING ERRCODE = '42501';
  END IF;
  SELECT code INTO v_code FROM public.room_access_codes WHERE room_id = p_room_id;
  RETURN v_code;
END;
$$;

-- Regenerar invalida los enlaces repartidos antes: quien tenga el link viejo
-- deja de poder sumarse. Los miembros ya registrados no se ven afectados.
CREATE OR REPLACE FUNCTION public.rotate_room_access_code(p_room_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_code TEXT;
BEGIN
  IF NOT public.is_room_admin(p_room_id) THEN
    RAISE EXCEPTION 'NOT_ROOM_ADMIN' USING ERRCODE = '42501';
  END IF;
  v_code := public.generate_access_code();
  INSERT INTO room_access_codes (room_id, code, updated_at)
  VALUES (p_room_id, v_code, now())
  ON CONFLICT (room_id) DO UPDATE SET code = EXCLUDED.code, updated_at = now();
  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_access_code() FROM public;
REVOKE ALL ON FUNCTION public.join_room(text, text, text, text, text) FROM public;
REVOKE ALL ON FUNCTION public.get_room_access_code(text) FROM public;
REVOKE ALL ON FUNCTION public.rotate_room_access_code(text) FROM public;

GRANT EXECUTE ON FUNCTION public.join_room(text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_room_access_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_room_access_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_access_code() TO service_role;
