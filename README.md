# Sales Arena Matcher

Aplicación web para coordinar prácticas de role-play entre participantes: registra perfiles y disponibilidad horaria, calcula coincidencias, propone duplas, gestiona su confirmación y conserva el estado de reuniones y asistencia.

## Relación con Sales Arena

Matcher resuelve la coordinación previa: quién puede reunirse, en qué horario y con qué compañero. Sales Arena es el espacio donde se ejecuta la práctica. Ambos proyectos son conceptualmente complementarios, pero este repositorio no demuestra una integración técnica automática entre las dos aplicaciones.

## Funcionalidades verificadas

- Inicio de sesión con Google OAuth mediante Supabase Auth.
- Perfil de participante con nombre, correo, país, zona horaria y estado activo.
- Salas con código de invitación y administración de miembros.
- Carga semanal de disponibilidad y reutilización de plantillas horarias.
- Conversión de horarios locales a slots UTC, incluidos husos con offsets fraccionarios y cruces de semana.
- Mapa de calor y afinidad horaria entre participantes.
- Emparejamiento 1:1 por coincidencia real de horarios, rotación de compañeros y confiabilidad.
- Propuestas con doble confirmación, rechazo, expiración y reasignación.
- Creación de un evento en Google Calendar con enlace de Google Meet cuando ambas personas aceptan.
- Registro de reuniones, compromiso de asistencia, puntualidad, cancelaciones y no-show.
- Cálculo de confiabilidad a partir del historial reciente de asistencia.
- Modo local simulado cuando no se configura una URL válida de Supabase.

El emparejamiento automático también está implementado como la Edge Function `weekly-matcher`. Las migraciones incluidas preparan las tablas, políticas RLS y la programación periódica usada por ese proceso.

## Tecnologías

- React 19 y React DOM.
- Vite 8.
- Supabase: base de datos, Auth y Edge Functions.
- Google OAuth, Google Calendar API y Google Meet mediante enlaces de conferencia creados por Calendar.
- Lucide React para iconos.
- Oxlint para análisis estático.
- Node Test Runner para pruebas unitarias.
- Netlify como configuración de build y rutas de la SPA.

## Requisitos

- Node.js `20.19` o superior dentro de la línea 20, o Node.js `22.12` o superior. Node 22 LTS es una opción recomendada.
- npm.
- Un proyecto de Supabase para usar persistencia, autenticación y emparejamiento automático.
- Proveedor Google habilitado en Supabase Auth y Google Calendar API configurada para crear eventos y enlaces de Meet.
- Supabase CLI únicamente si se van a aplicar migraciones o desplegar la Edge Function.

## Instalación local

```bash
git clone https://github.com/maximilianuz/salesarena-matcher.git
cd salesarena-matcher
npm ci
```

Crea un archivo `.env.local` en la raíz:

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Inicia el servidor de desarrollo:

```bash
npm run dev
```

Vite mostrará la URL local en la terminal. Si `VITE_SUPABASE_URL` no existe o contiene el valor de marcador usado por el proyecto, la interfaz utiliza almacenamiento local y datos simulados; en ese modo no se ejercitan Supabase ni la creación real de eventos de Calendar.

## Variables de entorno

### Aplicación web

| Variable | Uso |
| --- | --- |
| `VITE_SUPABASE_URL` | URL pública del proyecto Supabase usada por el cliente y para invocar `weekly-matcher`. |
| `VITE_SUPABASE_ANON_KEY` | Clave pública anónima utilizada para crear el cliente Supabase del navegador. |

### Edge Function `weekly-matcher`

Estas variables pertenecen al entorno de Supabase Edge Functions; no deben exponerse con el prefijo `VITE_` ni copiarse al código cliente.

| Variable | Uso |
| --- | --- |
| `SUPABASE_URL` | URL del proyecto usada por la Edge Function. Supabase la proporciona al ejecutar funciones desplegadas. |
| `SUPABASE_SERVICE_ROLE_KEY` | Credencial privilegiada usada por la Edge Function para procesar propuestas y asistencia. |
| `CRON_SECRET` | Secreto compartido opcional. Si está configurado, la función exige el encabezado correspondiente en cada invocación. |

La autenticación con Google no lee identificadores o secretos adicionales desde `import.meta.env`: se configura en Supabase Auth. La aplicación solicita el alcance `calendar.events` y usa el token del proveedor para llamar a Google Calendar.

## Scripts

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Inicia Vite en modo desarrollo. |
| `npm test` | Ejecuta las pruebas de `tests/` con el test runner nativo de Node. |
| `npm run lint` | Analiza el proyecto con Oxlint. |
| `npm run build` | Genera el build de producción en `dist/`. |
| `npm run preview` | Sirve localmente el build generado para revisión. |

Validación recomendada antes de proponer cambios:

```bash
npm test
npm run lint
npm run build
```

## Flujo general

1. La persona entra a una sala, inicia sesión y completa su perfil y zona horaria.
2. Carga bloques de disponibilidad en su hora local o reutiliza una plantilla.
3. La aplicación convierte esos bloques a slots UTC y muestra coincidencias y afinidad.
4. `weekly-matcher` genera propuestas 1:1 para miembros activos con horarios compatibles.
5. Cada participante acepta o rechaza su lado de la propuesta. La reunión se confirma únicamente con doble aceptación.
6. Al confirmarse, uno de los clientes crea el evento en Google Calendar, solicita el enlace de Meet y guarda la reunión y sus asistentes en Supabase.
7. La apertura del enlace se registra como señal de ingreso. Después de la reunión se resuelven o reportan asistencia, puntualidad, cancelaciones y no-show; esos datos alimentan la confiabilidad y futuros emparejamientos.

## Estructura del repositorio

```text
src/
  App.jsx              Interfaz y orquestación principal
  matcher.js           Motor puro de emparejamiento
  slots.js             Conversión de disponibilidad y zonas horarias
  supabaseClient.js     Cliente Supabase del navegador
  utils/               Utilidades de autenticación
tests/                  Pruebas del matcher y de los slots horarios
supabase/
  functions/            Edge Function de emparejamiento
  migrations/           Esquema, políticas RLS, cron y ajustes de datos
  DEPLOYMENT.md         Guía específica de despliegue en Supabase
public/                 Recursos estáticos y páginas legales
```

## Seguridad

- No subas `.env`, `.env.local` ni credenciales a Git.
- Usa claves públicas anónimas únicamente en el cliente; nunca expongas `SUPABASE_SERVICE_ROLE_KEY` en variables `VITE_*`.
- No uses credenciales de producción durante desarrollo local o pruebas.
- Evita correos, nombres, disponibilidad y otros datos personales reales en fixtures o pruebas.
- Revisa las políticas RLS y su efecto sobre cada rol antes de cambiar el esquema o las operaciones de base de datos.
- Trata los tokens de Google OAuth como credenciales temporales y no los registres en logs.

## Estado y limitaciones

- La mayor parte de la interfaz está concentrada actualmente en `src/App.jsx`.
- El cliente contiene un modo simulado para desarrollo sin Supabase; ese modo genera enlaces de Meet ficticios y no valida la integración externa.
- La asistencia automática usa como señal el momento en que una persona abre el enlace desde la aplicación; no verifica presencia dentro de Google Meet.
- El algoritmo del cliente (`src/matcher.js`) y el de la Edge Function replican reglas de emparejamiento. Cualquier cambio debe mantener ambas implementaciones alineadas.
- La creación real de Calendar/Meet depende de una sesión Google vigente, el alcance solicitado y la configuración externa de Google y Supabase.
- Las migraciones y `supabase/DEPLOYMENT.md` documentan el backend incluido, pero aplicarlas o desplegarlo es una operación separada de ejecutar la aplicación web localmente.
- Matcher y Sales Arena siguen siendo aplicaciones distintas; este repositorio no contiene el código de ejecución de las prácticas de Sales Arena.
