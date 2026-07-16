# Solución para Bloqueo de DNS (DNS Blocking)

## Problema
Si experimentas que la aplicación no carga o da errores de conexión, mientras otros usuarios pueden acceder sin problema, es probable que tu ISP o red corporativa esté **bloqueando DNS** al servidor de Supabase.

Síntomas:
- "No se puede conectar a gxqkfqxgmmn1eqdmssva.supabase.co"
- Errores de `timeout` o `net::ERR_NAME_NOT_RESOLVED`
- Otros usuarios en tu equipo pueden acceder normalmente

## Solución

### Para Usuarios Finales

Si tienes este problema, **proporciona el siguiente archivo `.env.local` a tu administrador**:

```env
VITE_SUPABASE_URL=https://[YOUR_PROJECT_ID].supabase.co
VITE_SUPABASE_ANON_KEY=[YOUR_ANON_KEY]
SUPABASE_SERVICE_ROLE_KEY=[YOUR_SERVICE_ROLE_KEY]
VITE_USE_PROXY=true
```

Note: Get these values from your Supabase Dashboard > Settings > API

**La línea `VITE_USE_PROXY=true` activa el proxy automático.**

### Instalación (para Administradores)

#### 1. Desplegar la función proxy Edge
```bash
supabase functions deploy db-proxy --no-verify-jwt
```

**Importante:** El flag `--no-verify-jwt` es crítico. La función proxy está protegida por validación de tokens en el servidor.

#### 2. Distribuir la configuración
Proporciona el `.env.local` con `VITE_USE_PROXY=true` a usuarios con problemas de conexión.

## Cómo Funciona

1. **Sin Proxy (conexión directa):**
   - Cliente → Supabase REST API
   - Si DNS está bloqueado, falla

2. **Con Proxy (conexión robusta):**
   - Cliente → Supabase Auth (generalmente no bloqueado)
   - Cliente → Proxy Edge Function (en dominio Supabase, pero diferente endpoint)
   - Proxy Edge Function → Supabase internamente
   - Resuelve DNS blocking porque pasa por servidor, no por cliente

## Alternativas si el Proxy no Funciona

Si el proxy tampoco funciona, intenta:

1. **Usar un VPN** - Cambia tu IP y evita el bloqueo de ISP
2. **Usar un proxy DNS** - Cambia tu servidor DNS (ej: 1.1.1.1)
3. **Contactar a tu ISP** - Pide que desbloquee `gxqkfqxgmmn1eqdmssva.supabase.co`

## Verificación

Para confirmar que el proxy está funcionando:

1. En la consola del navegador (F12 → Console), ejecuta:
```javascript
console.log(localStorage.getItem('sb-gxqkfqxgmmn1eqdmssva-auth-token'));
```

2. Si ves un token JWT, la autenticación funcionó.

3. Intenta crear una disponibilidad (heatmap). Si funciona, el proxy está activo.

## Rendimiento

- **Latencia:** +50-100ms comparado con conexión directa
- **Impacto:** Mínimo (la mayoría de operaciones son <500ms)
- **Fallback:** Si la conexión directa funciona, se usa automáticamente (sin proxy)

## Soporte Técnico

Si tienes problemas:

1. Verifica que la función proxy esté desplegada: `supabase functions list`
2. Revisa logs: `supabase functions logs db-proxy`
3. Prueba el proxy manualmente:
```bash
curl -X POST https://gxqkfqxgmmn1eqdmssva.supabase.co/functions/v1/db-proxy \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"operation":"select","table":"rooms","filters":{}}'
```
