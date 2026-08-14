import React, { useState, useEffect } from 'react';
import './App.css';
import { supabase } from './supabaseClient';
import { buildWeeklyPairs, currentWeekStartISO, MIN_LEAD_MS, respondByMs } from './matcher';
import { computeSlotSets, buildHeatmapGrid, ruleBelongsTo } from './slots';
import { isInAppBrowser, friendlyAuthError } from './utils/supabaseAuth';
import {
  getReliability as reliabilityOf,
  getRoomReliability,
  getMonthlyFaltas as monthlyFaltasOf,
  isBlocked as isBlockedOf,
  getChronicBlockedMonths as chronicMonthsOf,
  isChronicOffender as isChronicOffenderOf,
  CHRONIC_BLOCK_THRESHOLD
} from './reliability';
import {
  LayoutDashboard,
  CalendarRange,
  Flame,
  Users,
  UserCheck,
  Video,
  Clock,
  Sparkles,
  MapPin,
  Check,
  Trash2,
  AlertCircle,
  Sun,
  Moon,
  Monitor,
  Menu,
  X,
  Share2,
  Copy,
  LogOut,
  Settings,
  HelpCircle,
  ChevronRight,
  ChevronLeft,
  Globe,
  CalendarCheck,
  CalendarDays,
  Handshake,
  Trophy,
  Mail,
  Pencil,
  Save,
  Eraser,
  Target,
  UserPlus,
  Briefcase,
  Sunrise,
  Sunset,
  Lock,
  RefreshCw,
  ShieldCheck,
  MicOff,
  ExternalLink,
  BarChart3,
  Award,
  TrendingUp,
  // Navegación lateral: íconos más específicos que los genéricos que había
  // (ver comentario en el bloque .nav-links) + control de contraer/expandir.
  CalendarClock,
  Network,
  UsersRound,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';

import { ChessKnightIcon, GoogleMark, ReliabilityBadge, LoginConnectionsOrbit } from './components/Brand';
import { DIAS, ZONAS, getCountryFlag, tzCity, resolveTimezone, guessCountryFromBrowserTz } from './domain/zones';
import { getNextMatchDateUtc, formatMeetingDateUtc } from './domain/schedule';
import { scheduleRuleFromRow, attendanceFromRow, joinRoomErrorMessage } from './domain/rows';
import {
  getInitials,
  getAvatarColor,
  escapeLikeLiteral,
  nameFromEmail,
  sleep,
  slugifyRoomName
} from './utils/format';

// Unico usuario habilitado para crear salas nuevas, por el momento.
const ADMIN_EMAIL = 'community.argen.manager@gmail.com';

// El permiso que Google concede para escribir en Calendar dura ~1 hora y
// Supabase no lo renueva (solo refresca su propio JWT, no los tokens de
// terceros). Cuando vence, la única salida es volver a entrar con Google, así
// que todos los caminos que lo detectan dicen exactamente eso.
const GOOGLE_REAUTH_MESSAGE =
  'Tu permiso de Google Calendar venció (dura alrededor de una hora). Cerrá sesión y volvé a entrar con Google para agendar la reunión; la propuesta queda confirmada mientras tanto.';

const useMockDb = !import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL.includes('placeholder');

const getRoomIdFromUrl = () => {
  const path = window.location.pathname;
  const match = path.match(/\/room\/([^/]+)/);
  return match ? match[1] : null;
};

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

// Pila de módulo (no estado de React: el orden de apertura no necesita volver
// a renderizar nada) para que, con dos modales abiertos a la vez —el de
// gestión de salas y, encima, el de confirmar "Renovar código"—, Escape
// cierre solo el de ARRIBA. Sin esto, los dos <div> quedan escuchando
// 'keydown' en document a la vez y un solo Escape cerraba ambos de un saque.
const dialogStack = [];

// Comportamiento de teclado de un diálogo modal, compartido por los 4 modales
// de la app (confirmar/prompt, gestión de salas, guía de bienvenida): ninguno
// lo tenía. Escape cierra, Tab queda atrapado dentro del modal (si no, se
// puede tabular hacia la página de atrás sin querer) y el foco vuelve a quien
// abrió el modal al cerrarlo, en vez de perderse en el body.
// onClose va a un ref porque los 4 llamadores pasan una función nueva en cada
// render (closures inline o setX(false)); si fuera dependencia del efecto, se
// reengancharía el listener y se robaría el foco en cada tecla mientras el
// modal está abierto.
const useDialogA11y = (isOpen, onClose) => {
  const ref = React.useRef(null);
  const previouslyFocused = React.useRef(null);
  const onCloseRef = React.useRef(onClose);
  const idRef = React.useRef(null);
  if (idRef.current === null) idRef.current = Symbol('dialog');
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const id = idRef.current;
    dialogStack.push(id);
    previouslyFocused.current = document.activeElement;
    const container = ref.current;
    const firstFocusable = container?.querySelector(FOCUSABLE_SELECTOR);
    (firstFocusable || container)?.focus();

    const isTopmost = () => dialogStack[dialogStack.length - 1] === id;

    const handleKeyDown = (e) => {
      if (!isTopmost()) return; // un modal apilado encima ya lo va a manejar
      if (e.key === 'Escape') {
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !container) return;
      const items = container.querySelectorAll(FOCUSABLE_SELECTOR);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const i = dialogStack.indexOf(id);
      if (i !== -1) dialogStack.splice(i, 1);
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen]);

  return ref;
};

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');

  // Sin setter: la sala solo cambia navegando a otra URL, lo que remonta la app.
  const [currentRoomId] = useState(() => {
    const roomId = getRoomIdFromUrl();
    if (!roomId) {
      window.history.replaceState(null, '', '/room/grupo-a');
      return 'grupo-a';
    }
    return roomId;
  });

  // Código de acceso que venía en el enlace de invitación (?code=...). Se lee
  // una sola vez, al abrir la página, y se guarda en sessionStorage porque el
  // login con Google sale del sitio y vuelve a una URL limpia: sin persistirlo,
  // el código se perdería justo antes de necesitarlo para el alta.
  const [inviteCode] = useState(() => {
    const storageKey = `salesarena-invite:${getRoomIdFromUrl() || 'grupo-a'}`;
    const fromUrl = new URLSearchParams(window.location.search).get('code');
    if (fromUrl) {
      const clean = fromUrl.trim().toUpperCase();
      try { sessionStorage.setItem(storageKey, clean); } catch { /* modo privado */ }
      // Se saca de la barra de direcciones para que no quede a la vista ni se
      // comparta por accidente al copiar la URL.
      const url = new URL(window.location.href);
      url.searchParams.delete('code');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      return clean;
    }
    try { return sessionStorage.getItem(storageKey) || ''; } catch { return ''; }
  });


  // Tema (light | dark | system)
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('salesarena-theme') || 'system';
  });

  // Estado del Sidebar móvil
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Sidebar contraído a barra de íconos (solo escritorio). Es una preferencia
  // explícita del usuario y se recuerda entre sesiones. Contraído, el panel se
  // despliega al pasar el mouse Y al recibir foco de teclado: si dependiera
  // solo del hover, quien navega con teclado o pantalla táctil no podría leer
  // las etiquetas nunca.
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('salesarena-sidebar-collapsed') === 'true'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem('salesarena-sidebar-collapsed', String(isSidebarCollapsed)); } catch { /* modo privado */ }
  }, [isSidebarCollapsed]);

  // Autenticación de Google (Simulada)
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    return localStorage.getItem('salesarena-logged') === 'true';
  });

  // Estado del flujo de Login/Registro
  const [loginStep, setLoginStep] = useState(1); // 1: Google Email, 2: Profile setup Form
  const [loginEmail, setLoginEmail] = useState('');
  const [isInAppBrowserDetected, setIsInAppBrowserDetected] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isGoogleLoginPending, setIsGoogleLoginPending] = useState(false);

  const [customNewMemberCountry, setCustomNewMemberCountry] = useState('');

  const [roomName, setRoomName] = useState(() => {
    const roomId = getRoomIdFromUrl() || 'grupo-a';
    return 'Sala ' + roomId.charAt(0).toUpperCase() + roomId.slice(1);
  });
  const [isRoomModalOpen, setIsRoomModalOpen] = useState(false);
  const closeRoomModal = () => setIsRoomModalOpen(false);
  const roomModalRef = useDialogA11y(isRoomModalOpen, closeRoomModal);
  const [newRoomNameInput, setNewRoomNameInput] = useState('');
  const [renameRoomInput, setRenameRoomInput] = useState('');

  // Dueño de la sala (rooms.founder_email), en minúsculas. Define quién ve los
  // controles de administración; la autorización real la hace RLS.
  const [roomFounderEmail, setRoomFounderEmail] = useState(null);

  // Código de acceso de la sala. Solo se pide a la base cuando quien mira la
  // administra: get_room_access_code() rechaza a cualquier otro.
  const [roomAccessCode, setRoomAccessCode] = useState('');

  // Estado de Usuario Logueado (Simulado)
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('salesarena-user');
    return saved ? JSON.parse(saved) : null;
  });

  // Base de Datos en Estado (Vacia para producción)
  const [members, setMembers] = useState([]);

  // Disponibilidad: lista de { user, dayIdx, startHour, endHour }
  const [availabilities, setAvailabilities] = useState([]);

  // Plantillas Fijas: copia inicial
  const [templates, setTemplates] = useState([]);

  // Reuniones agendadas
  const [meetings, setMeetings] = useState([]);

  // Asistencia por reunión: {id, meetingId, memberEmail, memberName, status, reportedBy, reportedAt}
  // status: confirmado | asistio | no_show | cancelado_con_aviso
  const [attendances, setAttendances] = useState([]);

  // Propuestas de emparejamiento 1:1 (doble opt-in). Cada usuario ve SOLO la suya.
  // {id, weekStart, aEmail, aName, bEmail, bName, slot, statusA, statusB, status, respondBy, meetingId}
  const [proposals, setProposals] = useState([]);

  // true mientras se hace el fetch inicial a Supabase (members/proposals/meetings) de la sala.
  // Evita mostrar "Aún sin compañero asignado" como si fuera un hecho antes de que llegue el dato real.
  const [isRoomDataLoading, setIsRoomDataLoading] = useState(!useMockDb);

  // Email de la sesión de Supabase ya confirmada, o null si todavía no hay
  // ninguna. Los datos de la sala solo son legibles para miembros autenticados
  // (RLS), así que el fetch tiene que esperar a que el JWT exista: si se
  // dispara antes, las consultas vuelven vacías y la sala se ve como si no
  // tuviera miembros. No alcanza con `currentUser`, que se rehidrata de
  // localStorage antes de que Supabase restaure la sesión.
  const [sessionEmail, setSessionEmail] = useState(null);

  // Se incrementa cuando el alta de un miembro nuevo termina. Recién en ese
  // momento la persona pasa a ser miembro de la sala, y por lo tanto recién
  // entonces las políticas RLS le dejan leer los datos: sin este disparo, quien
  // se registra por primera vez vería la sala vacía hasta recargar la página.
  const [roomDataVersion, setRoomDataVersion] = useState(0);

  // Tick por minuto: hace aparecer el prompt de asistencia cuando una sesión
  // termina con la página abierta, sin necesidad de recargar
  const [, setMinuteTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setMinuteTick(v => v + 1), 60000);
    return () => clearInterval(t);
  }, []);

  // Sistema de notificaciones premium (toast)
  const [toasts, setToasts] = useState([]); // [{id, msg, type}]
  const [confirmModal, setConfirmModal] = useState(null); // {msg, onConfirm, onCancel}
  const [promptModal, setPromptModal] = useState(null); // {msg, placeholder, onSubmit, onCancel}
  const [promptValue, setPromptValue] = useState('');
  const confirmModalRef = useDialogA11y(!!confirmModal, confirmModal?.onCancel);
  const promptModalRef = useDialogA11y(!!promptModal, promptModal?.onCancel);

  // Estados de carga del Wizard
  const [wizardStep, setWizardStep] = useState(1); // 1: Bienvenida, 2: Opciones, 3: Grid
  const [wizardGrid, setWizardGrid] = useState([]); // [{dayIdx, hour}]
  const [saveAsTemplate, setSaveAsTemplate] = useState(true);
  const [wizardStatus, setWizardStatus] = useState(null); // {type, msg}

  // Nuevos miembros
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberCountry, setNewMemberCountry] = useState('Argentina');

  // Estados de simulación de Google Meet / Calendar API
  const [schedulingStatus, setSchedulingStatus] = useState(null); // null | 'loading' | 'authenticating' | 'creating' | 'success'
  const [scheduledDetails, setScheduledDetails] = useState(null); // { title, attendeesCount }

  // Resultados agregados calculados dinámicamente (heatmap y afinidad)
  const [heatmap, setHeatmap] = useState([]); // 7x24 grid
  const [affinity, setAffinity] = useState([]);

  // Celda del mapa de calor seleccionada (click o foco+Enter): reemplaza al
  // tooltip como única forma de ver quiénes están disponibles en ese bloque
  // (el tooltip solo no funciona en mobile ni con teclado/lector de pantalla).
  const [selectedHeatmapCell, setSelectedHeatmapCell] = useState(null); // { day, hour, count, names }

  // Variables para arrastre en la grilla visual
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [dragMode, setDragMode] = useState(true); // true = pintar, false = borrar

  // Rango horario visible en el editor (estilo Cal.com: horas útiles por defecto)
  const [showAllHours, setShowAllHours] = useState(false);

  // Guía de bienvenida (onboarding) para nuevos usuarios
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

  // La guía se abre sola UNA sola vez, en el primer ingreso de cada cuenta.
  //
  // Estuvo desactivada un tiempo para no imponer un tutorial obligatorio, y esa
  // preocupación sigue siendo válida: por eso el primer paso ofrece "Saltar
  // guía" y, una vez cerrada, no vuelve a aparecer nunca (queda marcada en
  // localStorage por cuenta). Pero era el único lugar donde se explica para qué
  // sirve la app y cómo funciona el emparejamiento: sin esto, quien entra por
  // un enlace de invitación no tenía forma de enterarse salvo descubriendo el
  // botón "Guía" en el pie del menú.
  useEffect(() => {
    if (!isLoggedIn || !currentUser) return;
    if (localStorage.getItem(`salesarena-guide-${currentUser.email.toLowerCase()}`)) return;
    setOnboardingStep(0);
    setShowOnboarding(true);
  }, [isLoggedIn, currentUser?.email]);

  // Detectar navegador in-app en el montaje inicial
  useEffect(() => {
    if (isInAppBrowser()) {
      setIsInAppBrowserDetected(true);
    }
  }, []);

  const closeOnboarding = () => {
    if (currentUser) {
      localStorage.setItem(`salesarena-guide-${currentUser.email.toLowerCase()}`, 'true');
    }
    setShowOnboarding(false);
  };

  const onboardingModalRef = useDialogA11y(showOnboarding, closeOnboarding);

  const openOnboarding = () => {
    setOnboardingStep(0);
    setShowOnboarding(true);
  };

  // --- MOTOR DE COINCIDENCIAS (REACT PORT) ---
  // currentUser?.tz está en las deps porque el heatmap se dibuja en la hora
  // local del usuario activo: sin esa dep, si la sesión OAuth se resolvía
  // DESPUÉS de cargar la sala, el mapa quedaba calculado en UTC (corrido
  // varias horas respecto de lo que la persona marcó en su grilla).
  useEffect(() => {
    calculateEngine();
  }, [members, availabilities, currentUser?.tz]);

  // --- MANEJO DE TEMAS (DARK/LIGHT/SYSTEM) ---
  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (t) => {
      if (t === 'dark') {
        root.classList.add('dark');
      } else if (t === 'light') {
        root.classList.remove('dark');
      } else {
        // System preference
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (systemPrefersDark) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      }
    };

    applyTheme(theme);
    localStorage.setItem('salesarena-theme', theme);

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = (e) => {
        if (e.matches) root.classList.add('dark');
        else root.classList.remove('dark');
      };
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
  }, [theme]);

  // Nota: la URL del navegador refleja siempre currentRoomId. Renombrar o crear
  // salas redirige explícitamente; no se reescribe la URL con el nombre
  // slugificado porque en salas con nombre por defecto ("Sala Grupo-a") ese
  // slug apunta a una sala distinta y rompía el refresh y los links copiados.

  // Modo demo local: reuniones, asistencia y propuestas persisten en localStorage
  const mockHydratedRef = React.useRef(false);
  useEffect(() => {
    if (!useMockDb) return;
    try {
      const m = JSON.parse(localStorage.getItem(`salesarena-mock-meetings-${currentRoomId}`) || '[]');
      const a = JSON.parse(localStorage.getItem(`salesarena-mock-attendees-${currentRoomId}`) || '[]');
      const p = JSON.parse(localStorage.getItem(`salesarena-mock-proposals-${currentRoomId}`) || '[]');
      if (m.length) setMeetings(m);
      if (a.length) setAttendances(a);
      if (p.length) setProposals(p);
    } catch { /* datos corruptos: se ignoran */ }
    mockHydratedRef.current = true;
  }, [currentRoomId]);

  useEffect(() => {
    if (!useMockDb || !mockHydratedRef.current) return;
    localStorage.setItem(`salesarena-mock-meetings-${currentRoomId}`, JSON.stringify(meetings));
    localStorage.setItem(`salesarena-mock-attendees-${currentRoomId}`, JSON.stringify(attendances));
    localStorage.setItem(`salesarena-mock-proposals-${currentRoomId}`, JSON.stringify(proposals));
  }, [meetings, attendances, proposals, currentRoomId]);

  // Producción: cargar SOLO la propuesta propia de la semana actual
  useEffect(() => {
    if (useMockDb || !currentUser) return;
    const week = currentWeekStartISO();
    supabase.from('match_proposals')
      .select('*')
      .eq('room_id', currentRoomId)
      .eq('week_start', week)
      .or(`member_a_email.eq.${currentUser.email},member_b_email.eq.${currentUser.email}`)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) {
          setProposals(data.map(d => ({
            id: d.id,
            weekStart: d.week_start,
            aEmail: d.member_a_email,
            aName: d.member_a_name,
            bEmail: d.member_b_email,
            bName: d.member_b_name,
            slot: d.slot_start,
            // El weekly-matcher inserta/reactiva propuestas con status_a/b en
            // NULL (= sin responder). El UI decide con 'pendiente': sin este
            // mapeo, una propuesta nueva mostraba "Esperando..." en vez de los
            // botones Aceptar/Rechazar y nadie podía responder jamás.
            statusA: d.status_a || 'pendiente',
            statusB: d.status_b || 'pendiente',
            status: d.status,
            respondBy: d.respond_by,
            meetingId: d.meeting_id
          })));
        }
      });
  }, [currentUser?.email, currentRoomId]);

  // Slot UTC → fecha y hora reales de la próxima ocurrencia en la zona de una
  // persona ("Lunes 17/08/2026 · 14:00"). Reutiliza getNextMatchDateUtc (la
  // MISMA ocurrencia que ya usa el plazo de respuesta, ver más abajo) y
  // formatea todo con Intl para que día de semana, fecha y hora salgan de un
  // único cálculo consistente en vez de mezclar el offset fijo de arriba con
  // el calendario real.
  const slotToLocalDateLabel = (slot, tz) => {
    const date = getNextMatchDateUtc({ startSlot: slot });
    const parts = new Intl.DateTimeFormat('es-AR', {
      timeZone: tz, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(date);
    const get = (type) => parts.find(p => p.type === type)?.value || '';
    const weekday = get('weekday');
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${get('day')}/${get('month')}/${get('year')} · ${get('hour')}:${get('minute')}`;
  };

  // Plazo de respuesta en formato relativo y breve ("en 3 h", "en 2 días")
  const formatRespondByRelative = (iso) => {
    const diffMs = new Date(iso).getTime() - Date.now();
    if (diffMs <= 0) return 'está por vencer';
    const diffH = Math.round(diffMs / 3600000);
    if (diffH < 1) return 'en menos de 1 h';
    if (diffH < 24) return `en ${diffH} h`;
    const diffD = Math.round(diffH / 24);
    return `en ${diffD} día${diffD === 1 ? '' : 's'}`;
  };

  // ¿La sesión ya terminó? (inicio + duración)
  const meetingHasEnded = (meeting) => {
    if (!meeting.startsAt) return false; // reuniones viejas sin timestamp: sin prompt
    return Date.now() > new Date(meeting.startsAt).getTime() + (meeting.duration || 60) * 60000;
  };

  const meetingHasStarted = (meeting) => {
    if (!meeting.startsAt) return true; // sin timestamp no se permite cancelar
    return Date.now() >= new Date(meeting.startsAt).getTime();
  };

  // En un role-play 1:1 basta con que cancele UNO de los dos para que la
  // reunión ya no exista: se considera cancelada con cualquier cancelación.
  const meetingWasCancelled = (meeting) => attendances.some(a =>
    a.meetingId === meeting.id &&
    (a.status === 'cancelado_con_aviso' || a.status === 'cancelado_tarde'));

  // Reuniones vigentes para el dashboard: ni canceladas ni ya terminadas.
  // Las demás no deben quedar eternas en pantalla.
  const upcomingMeetings = meetings.filter(m =>
    !meetingWasCancelled(m) && !meetingHasEnded(m));

  // Propuesta activa del usuario esta semana (y la última, para mensajes de estado)
  const myEmailLower = currentUser?.email?.toLowerCase();
  const myWeekProposals = !currentUser ? [] : proposals.filter(p =>
    p.weekStart === currentWeekStartISO() &&
    (p.aEmail.toLowerCase() === myEmailLower || p.bEmail.toLowerCase() === myEmailLower)
  );
  // Una propuesta deja de estar viva si su reunión fue cancelada por cualquiera
  // de los dos o ya terminó, aunque la fila siga 'confirmado' en la base (p. ej.
  // si el compañero canceló y su update de propuesta aún no llegó).
  const proposalIsLive = (p) => {
    if (p.status !== 'propuesto' && p.status !== 'confirmado') return false;
    const linked = p.meetingId != null ? meetings.find(m => m.id === p.meetingId) : null;
    if (!linked) return true;
    return !meetingWasCancelled(linked) && !meetingHasEnded(linked);
  };
  // Puede haber varias a la vez (multi-match semanal): se listan todas, no
  // solo la primera que aparezca en el array.
  const myLiveProposals = myWeekProposals.filter(proposalIsLive)
    .sort((a, b) => a.slot - b.slot);
  const myProposal = myLiveProposals[0] || null;
  const myLastClosedProposal = myLiveProposals.length > 0
    ? null
    : myWeekProposals.sort((x, y) => (y.id || 0) - (x.id || 0))[0] || null;

  // Modo demo: correr el emparejador localmente (en producción lo hace la
  // Edge Function semanal weekly-matcher; el cliente solo lee su propuesta)
  useEffect(() => {
    if (!useMockDb || !currentUser || myProposal) return;
    const week = currentWeekStartISO();
    const takenOrRejected = new Set(
      proposals
        .filter(p => p.weekStart === week && (p.status === 'propuesto' || p.status === 'confirmado'))
        .flatMap(p => [p.aEmail.toLowerCase(), p.bEmail.toLowerCase()])
    );
    // Se excluyen parejas RECHAZADAS (se respeta el "no" explícito) y las
    // CANCELADAS esta semana (no re-ofrecer la misma dupla que se cayó;
    // cada integrante queda libre para matchear con otros).
    const rejectedPairs = new Set(
      proposals
        .filter(p => p.weekStart === week && (p.status === 'rechazado' || p.status === 'cancelado'))
        .map(p => [p.aEmail.toLowerCase(), p.bEmail.toLowerCase()].sort().join('|'))
    );
    // Duplas EXPIRADAS (sin respuesta): se evitan si hay otro compañero
    // disponible; si no, se vuelven a ofrecer.
    const expiredPairs = new Set(
      proposals
        .filter(p => p.weekStart === week && p.status === 'expirado')
        .map(p => [p.aEmail.toLowerCase(), p.bEmail.toLowerCase()].sort().join('|'))
    );
    const pool = members.filter(m => m.active && !takenOrRejected.has(m.email.toLowerCase()));
    if (pool.length < 2) return;

    const slotSets = computeSlotSets(pool, availabilities);
    const scores = new Map(pool.map(m => [m.email, getReliability(m.email)]));
    const { pairs } = buildWeeklyPairs(
      pool, slotSets, scores, rejectedPairs, new Map(), new Date(), expiredPairs, MIN_LEAD_MS
    );
    if (pairs.length === 0) return;

    const baseId = Date.now();
    const nowRef = new Date();
    setProposals(prev => [...prev, ...pairs.map((p, i) => {
      const meetingMs = getNextMatchDateUtc({ startSlot: p.slot }, MIN_LEAD_MS).getTime();
      // Plazo de confirmación escalonado (4h→2h→1h→30m), igual que la Edge
      // Function. Si por algún motivo no entra ni el escalón más chico, se usa el
      // inicio de la reunión como tope.
      const rbMs = respondByMs(meetingMs, nowRef) ?? meetingMs;
      return {
        id: baseId + i,
        weekStart: week,
        aEmail: p.a.email,
        aName: p.a.name,
        bEmail: p.b.email,
        bName: p.b.name,
        slot: p.slot,
        statusA: 'pendiente',
        statusB: 'pendiente',
        status: 'propuesto',
        respondBy: new Date(rbMs).toISOString(),
        meetingId: null
      };
    })]);
  }, [members, availabilities, currentUser, proposals]);

  // Administrador de la plataforma: única cuenta habilitada para crear salas.
  const isAdmin = currentUser?.email?.toLowerCase() === ADMIN_EMAIL;

  // Quien administra ESTA sala: el admin de plataforma o quien la creó
  // (rooms.founder_email). Es el mismo criterio que aplica la base de datos en
  // is_room_admin(); acá se replica solo para mostrar u ocultar los controles,
  // porque la autorización real la hace la política RLS, no la pantalla.
  const isRoomAdmin = isAdmin ||
    (!!roomFounderEmail && roomFounderEmail === currentUser?.email?.toLowerCase());

  // Confiabilidad y sanciones: la lógica vive en src/reliability.js (módulo puro
  // y testeado). Acá quedan solo los envoltorios que le pasan el estado actual
  // de la sala, para no repetir attendances/meetings en cada punto de uso.
  const getReliability = (email) => reliabilityOf(email, attendances, meetings);
  const getMonthlyFaltas = (email) => monthlyFaltasOf(email, attendances, meetings);
  const isBlocked = (email) => isBlockedOf(email, attendances, meetings);

  // Reportes pendientes del usuario actual: por cada sesión terminada en la que
  // participó, cada compañero que sigue en 'confirmado' (nadie reportó aún)
  const pendingReports = !currentUser ? [] : meetings
    .filter(m => m.id != null && meetingHasEnded(m))
    .flatMap(m => {
      const rows = attendances.filter(a => a.meetingId === m.id);
      const myRow = rows.find(a => a.memberEmail.toLowerCase() === currentUser.email.toLowerCase());
      if (!myRow || myRow.status === 'cancelado_con_aviso') return [];
      return rows
        .filter(a =>
          a.memberEmail.toLowerCase() !== currentUser.email.toLowerCase() &&
          a.status === 'confirmado'
        )
        .map(a => ({ meeting: m, attendance: a }));
    });

  // --- REPORTES Y ANÁLISIS ---
  // Todo lo que sigue se calcula a partir de lo que cada participante reporta
  // después de cada sesión (asistió / no se presentó / canceló). La app no
  // accede al contenido de las videollamadas: solo agrega esos reportes de
  // asistencia para mostrar el estado de la coordinación de la sala.
  const monthStartMs = (() => {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  })();

  const meetingsThisMonth = meetings.filter(m => {
    const when = m.startsAt ? Date.parse(m.startsAt) : NaN;
    return !Number.isNaN(when) && when >= monthStartMs;
  });

  // Confiabilidad promedio de la sala: mismo cálculo que getReliability,
  // pero agregando los reportes de todos los miembros en vez de uno solo.
  const roomReliability = getRoomReliability(attendances, meetings);

  const blockedMembersCount = members.filter(m => isBlocked(m.email)).length;
  const activeMembersCount = members.filter(m => m.active).length;

  const mySessionsCompleted = !currentUser ? 0 : attendances.filter(a =>
    a.memberEmail.toLowerCase() === currentUser.email.toLowerCase() && a.status === 'asistio'
  ).length;

  // --- PATRONES REPETIDOS: castiga la reincidencia, no el mes puntual ---
  // Un mes malo (problemas de conexión, imprevistos) ya cuesta el emparejamiento
  // de ESE mes vía isBlocked/getMonthlyFaltas, y se resetea solo al mes siguiente.
  // Eso alcanza para un imprevisto. El umbral crónico existe para el caso
  // distinto: alguien que deja a su compañero sin sesión mes tras mes.
  const getChronicBlockedMonths = (email) => chronicMonthsOf(email, attendances, meetings);
  const isChronicOffender = (email) => isChronicOffenderOf(email, attendances, meetings);

  // --- REAL-TIME DATA SYNCHRONIZATION WITH SUPABASE ---
  useEffect(() => {
    if (useMockDb) return;

    // Sin sesión no hay nada que traer: las políticas RLS solo abren los datos
    // de la sala a sus miembros autenticados, y la pantalla de login no muestra
    // ninguno de estos datos. Se limpia lo que hubiera quedado en memoria de
    // una sesión anterior para no mostrar datos ajenos tras cerrar sesión.
    if (!sessionEmail) {
      setMembers([]);
      setAvailabilities([]);
      setTemplates([]);
      setMeetings([]);
      setAttendances([]);
      setIsRoomDataLoading(false);
      return;
    }

    const loadSupabaseData = async () => {
      setIsRoomDataLoading(true);
      // 1. Fetch Room. Esta consulta es solo de lectura: ninguna sala se crea
      // acá. La única sala que puede crearse "sola" es al iniciar sesión por
      // primera vez siendo el administrador (ver handleOAuthSession); el
      // resto se crea exclusivamente desde handleCreateRoom.
      let { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', currentRoomId)
        .maybeSingle();

      if (roomError || !roomData) {
        const defaultName = `Sala ${currentRoomId.charAt(0).toUpperCase() + currentRoomId.slice(1)}`;
        setRoomName(defaultName);
        setRenameRoomInput(defaultName);
        setRoomFounderEmail(null);
      } else {
        setRoomName(roomData.name);
        setRenameRoomInput(roomData.name);
        setRoomFounderEmail(roomData.founder_email?.toLowerCase() || null);
      }

      // 2. Fetch Members
      const { data: memData } = await supabase
        .from('members')
        .select('*')
        .eq('room_id', currentRoomId);
      if (memData) {
        setMembers(memData.map(d => ({
          name: d.name,
          email: d.email,
          country: d.country,
          tz: d.timezone,
          active: d.active
        })));
      }

      // 3. Fetch Availabilities
      const { data: availData } = await supabase
        .from('availabilities')
        .select('*')
        .eq('room_id', currentRoomId);
      if (availData) {
        setAvailabilities(availData.map(scheduleRuleFromRow));
      }

      // 3b. Fetch Plantillas base (horario habitual). Antes vivían solo en el
      // estado de React: tras recargar la página, "Usar mi plantilla" partía
      // de una lista vacía y borraba la disponibilidad cargada.
      const { data: tplData, error: tplError } = await supabase
        .from('templates')
        .select('*')
        .eq('room_id', currentRoomId);
      if (!tplError && tplData) {
        setTemplates(tplData.filter(d => d.day_idx != null).map(scheduleRuleFromRow));
      }

      // 4. Fetch Meetings
      const { data: meetData } = await supabase
        .from('meetings')
        .select('*')
        .eq('room_id', currentRoomId);
      if (meetData) {
        setMeetings(meetData.map(d => ({
          id: d.id,
          title: d.title,
          dateUtc: d.date_utc,
          duration: d.duration || 60,
          participants: d.participants,
          meetLink: d.meet_link,
          startsAt: d.starts_at,
          status: 'Creado (Meet)'
        })));
      }

      // 5. Fetch Asistencia (tabla meeting_attendees)
      const { data: attData, error: attError } = await supabase
        .from('meeting_attendees')
        .select('*')
        .eq('room_id', currentRoomId);
      if (!attError && attData) {
        setAttendances(attData.map(attendanceFromRow));
      }

      setIsRoomDataLoading(false);
    };

    loadSupabaseData();
  }, [currentRoomId, sessionEmail, roomDataVersion]);

  // Fila de members → objeto de usuario de la app
  const memberFromRow = (row) => ({
    name: row.name,
    email: row.email,
    country: row.country,
    tz: row.timezone,
    active: row.active
  });

  // Deja la sesión iniciada y la persiste localmente. Centraliza el estado que
  // antes se repetía en cada camino de login (OAuth, alta nueva y mock).
  const applyLoggedInUser = (userObj) => {
    setCurrentUser(userObj);
    setIsLoggedIn(true);
    localStorage.setItem('salesarena-logged', 'true');
    localStorage.setItem('salesarena-user', JSON.stringify(userObj));
  };

  // Sesión OAuth ya resuelta ("<sala>:<user id>"). Evita que getSession() y
  // onAuthStateChange procesen la misma sesión a la vez: ambos consultaban
  // members, ninguno encontraba la fila todavía y los dos intentaban el alta,
  // así que el segundo insert chocaba contra la constraint (room_id, email).
  const handledSessionRef = React.useRef(null);

  // --- REAL GOOGLE OAUTH CALLBACK LISTENERS ---
  useEffect(() => {
    if (useMockDb) return;

    // La marca se escribe de forma SÍNCRONA, antes de cualquier await: la
    // ventana de carrera se abre justo en esos awaits.
    const processSession = async (session) => {
      const key = `${currentRoomId}:${session.user.id}`;
      if (handledSessionRef.current === key) return;
      handledSessionRef.current = key;
      await handleOAuthSession(session);
    };

    // getSession() resuelve el #access_token del callback de Google antes de
    // devolver la sesión, así que sirve tanto al volver del OAuth como al
    // recargar con una sesión ya persistida.
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        setSessionEmail(session?.user?.email ?? null);
        if (session?.user) await processSession(session);
      } catch (err) {
        console.error('Error inicializando la sesión:', err);
        setSessionEmail(null);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSessionEmail(session?.user?.email ?? null);
      if (session?.user) {
        await processSession(session);
      } else if (!session) {
        setIsLoggedIn(false);
        handledSessionRef.current = null;
      }
    });

    return () => subscription.unsubscribe();
  }, [currentRoomId]);

  const handleOAuthSession = async (session) => {
    const email = session.user.email;
    setLoginEmail(email);

    try {
      // ilike y no eq: el alta guarda el email en minúsculas, así que un
      // .eq() contra el email crudo de Google no encontraría la fila y se
      // intentaría registrar de nuevo a alguien que ya es miembro.
      const { data: existing } = await supabase
        .from('members')
        .select('*')
        .eq('room_id', currentRoomId)
        .ilike('email', escapeLikeLiteral(email))
        .maybeSingle();

      if (existing) {
        applyLoggedInUser(memberFromRow(existing));
      } else {
        // Bootstrap de sala nueva: solo el administrador puede crear una sala
        // por el hecho de visitar su URL. Para cualquier otra persona, si la
        // sala no existe join_room corta el alta con ROOM_NOT_FOUND.
        if (email.toLowerCase() === ADMIN_EMAIL) {
          const { data: roomRow } = await supabase
            .from('rooms')
            .select('id')
            .eq('id', currentRoomId)
            .maybeSingle();

          if (!roomRow) {
            const defaultName = `Sala ${currentRoomId.charAt(0).toUpperCase() + currentRoomId.slice(1)}`;
            await supabase.from('rooms')
              .insert({ id: currentRoomId, name: defaultName, founder_email: email.toLowerCase() });
            setRoomName(defaultName);
            setRenameRoomInput(defaultName);
          }
        }

        // Alta validada contra el código de acceso de la sala (ver join_room).
        // Nombre de la cuenta de Google —o derivado del email si Google no lo
        // trae— y país/zona horaria del navegador.
        const googleName = (session.user.user_metadata?.full_name ||
          session.user.user_metadata?.name || nameFromEmail(email)).trim();
        await registerMember(googleName, guessCountryFromBrowserTz(), email);
      }
    } catch (err) {
      console.error('Error verificando usuario OAuth:', err);
      showNotification('No pudimos completar tu registro. Recarga la página e intenta de nuevo.');
      setIsLoggedIn(false);
    }
  };

  // Calcula heatmap y afinidad (agregados). El emparejamiento ya NO se hace
  // acá: lo resuelve el job semanal 1:1 (weekly-matcher) vía match_proposals.
  // La traducción local→UTC (con envolvente semanal y dedupe por miembro)
  // vive en src/slots.js, compartida con los tests y alineada con la Edge
  // Function.
  const calculateEngine = () => {
    const activeMembers = members.filter(m => m.active);
    // El heatmap se muestra desde el PRIMER miembro activo: si la persona es
    // la única de la sala, igual tiene que ver sus propias marcas reflejadas.
    if (activeMembers.length === 0) {
      setHeatmap([]);
      setAffinity([]);
      return;
    }

    const { grid, slotSets } = buildHeatmapGrid(
      activeMembers, availabilities, currentUser?.tz || 'UTC'
    );
    setHeatmap(grid);

    // Matriz de Afinidad (solapamientos relativos): requiere al menos 2
    if (activeMembers.length < 2) {
      setAffinity([]);
      return;
    }
    const sets = activeMembers.map(m => slotSets.get(m.email) || new Set());
    const calculatedAffinity = activeMembers.map((member, i) => {
      const partnerStats = activeMembers.map((partner, j) => {
        if (i === j) return { name: partner.name, pct: null };
        let common = 0;
        sets[i].forEach(s => { if (sets[j].has(s)) common++; });
        const denom = Math.min(sets[i].size, sets[j].size);
        const pct = denom ? Math.round((common / denom) * 100) : 0;
        return { name: partner.name, pct };
      });
      return { name: member.name, stats: partnerStats };
    });
    setAffinity(calculatedAffinity);
  };

  // --- ACCIONES DEL WIZARD ---
  const handleWizardParticipation = (participate) => {
    setWizardStatus({ type: 'loading', msg: 'Guardando tu estado...' });
    setTimeout(async () => {
      // Modificar en la lista de miembros (y persistir en la DB: antes el
      // cambio de participación del wizard se perdía al recargar)
      const updatedMembers = members.map(m =>
        m.email.toLowerCase() === currentUser.email.toLowerCase() ? { ...m, active: participate } : m
      );
      setMembers(updatedMembers);
      setCurrentUser(prev => ({ ...prev, active: participate }));
      if (!useMockDb) {
        await supabase.from('members')
          .update({ active: participate })
          .eq('room_id', currentRoomId)
          .eq('email', currentUser.email);
      }

      if (participate) {
        // Cargar horarios del usuario activo en la grilla visual
        const userRules = availabilities.filter(a => ruleBelongsTo(a, currentUser));
        const gridSlots = [];
        userRules.forEach(rule => {
          for (let h = rule.startHour; h < rule.endHour; h++) {
            gridSlots.push({ dayIdx: rule.dayIdx, hour: h });
          }
        });
        setWizardGrid(gridSlots);
        setWizardStep(2);
        // Se limpia el "Guardando tu estado..." antes de pasar a elegir horarios:
        // si no, el spinner quedaba fijo arriba de la grilla durante toda la
        // edición, como si la app estuviera guardando algo que ya terminó.
        setWizardStatus(null);
      } else {
        // Borrar horarios semanales (también en la DB: antes solo se limpiaba
        // el estado local y las marcas "volvían" al recargar la página)
        const clearError = await replaceMyAvailability([]);
        if (clearError) {
          setWizardStatus({ type: 'error', msg: clearError });
          return;
        }
        const cleanAvail = availabilities.filter(a => !ruleBelongsTo(a, currentUser));
        setAvailabilities(cleanAvail);
        setWizardStatus({ type: 'success', msg: '¡Registrado! Has sido excluido por esta semana.' });
        setTimeout(() => {
          setActiveTab('dashboard');
          setWizardStep(1);
        }, 2000);
      }
    }, 1000);
  };

  // ¿Hay otra persona en la sala que se llame igual que esta? Mientras existan
  // filas de horarios sin dueño resuelto (las anteriores a member_email), el
  // nombre no alcanza para saber de quién son, así que las operaciones que
  // borran por nombre tienen que abstenerse.
  const hasHomonymInRoom = (member) => {
    if (!member?.name) return false;
    const name = member.name.toLowerCase();
    const email = (member.email || '').toLowerCase();
    return members.some(m =>
      m.email.toLowerCase() !== email && (m.name || '').toLowerCase() === name
    );
  };

  // Reemplaza en la base TODA la disponibilidad de quien está logueado por el
  // conjunto de reglas que se le pase (borrar + insertar). Los cuatro caminos
  // que tocan horarios —activar/desactivar participación, aplicar plantilla y
  // guardar la grilla— hacían exactamente esto con el código copiado, así que
  // cualquier corrección había que acordarse de aplicarla cuatro veces.
  // Devuelve null si salió bien, o un texto explicando qué falló.
  const replaceMyAvailability = async (rules) => {
    if (useMockDb) return null;

    const myEmail = currentUser.email.toLowerCase();

    // Se borra en dos pasos y no con un .or() combinado: la sintaxis de filtros
    // de PostgREST usa comas y paréntesis como separadores, así que un nombre
    // que los contenga rompería la consulta.
    //
    // 1) Las filas ya vinculadas por email (el caso normal desde ahora).
    const { error: delByEmail } = await supabase.from('availabilities')
      .delete()
      .eq('room_id', currentRoomId)
      .eq('member_email', myEmail);
    if (delByEmail) return 'No pudimos actualizar tus horarios. Intentá de nuevo en un momento.';

    // 2) Las filas anteriores a member_email, que solo se pueden reconocer por
    //    nombre. Sin este paso quedarían duplicando los bloques nuevos y
    //    seguirían pintando el mapa de calor.
    //
    //    Se omite si hay un homónimo en la sala: esas filas sin dueño podrían
    //    ser de cualquiera de los dos y borrarlas por nombre le vaciaría la
    //    agenda al otro, que es exactamente el problema que se vino a resolver.
    //    Quedan como están y se resuelven solas cuando cada quien guarde: desde
    //    ese momento sus filas llevan email y dejan de ser ambiguas.
    if (!hasHomonymInRoom(currentUser)) {
      const { error: delLegacy } = await supabase.from('availabilities')
        .delete()
        .eq('room_id', currentRoomId)
        .is('member_email', null)
        .ilike('user', escapeLikeLiteral(currentUser.name));
      if (delLegacy) return 'No pudimos actualizar tus horarios. Intentá de nuevo en un momento.';
    }

    if (rules.length === 0) return null;

    const { error: insError } = await supabase.from('availabilities').insert(
      rules.map(r => ({
        room_id: currentRoomId,
        member_email: myEmail,
        user: r.user,
        day_idx: r.dayIdx,
        start_hour: r.startHour,
        end_hour: r.endHour
      }))
    );
    if (insError) return 'No pudimos guardar tus horarios. Intentá de nuevo en un momento.';
    return null;
  };

  // Dispara el weekly-matcher al instante cuando hay un cambio de disponibilidad
  const triggerWeeklyMatcher = async () => {
    try {
      const url = import.meta.env.VITE_SUPABASE_URL;
      if (!url || url.includes('placeholder')) {
        console.log('Mock DB: skipping weekly-matcher trigger');
        return;
      }

      // Corrida dirigida a ESTA sala, con la sesión del usuario: la Edge
      // Function exige sesión válida para ?room=, así nadie de afuera puede
      // forzar corridas sobre una sala ajena.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const response = await fetch(
        `${url}/functions/v1/weekly-matcher?room=${encodeURIComponent(currentRoomId)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({})
        }
      );

      if (response.ok) {
        const data = await response.json();
        console.log('Weekly-matcher triggered:', data);
        if (data.created && Object.values(data.created).some(v => v > 0)) {
          showNotification('✨ ¡Se generaron nuevas propuestas de emparejamiento!');
        }
      } else {
        console.error('Weekly-matcher error:', response.statusText);
      }
    } catch (err) {
      console.error('Failed to trigger weekly-matcher:', err);
    }
  };

  const handleUseTemplate = () => {
    setWizardStatus({ type: 'loading', msg: 'Aplicando horarios base de tu plantilla...' });
    setTimeout(async () => {
      const userTemplateRules = templates.filter(t => ruleBelongsTo(t, currentUser));

      // Sin plantilla guardada no hay nada que aplicar: antes este camino
      // BORRABA la disponibilidad ya cargada (la plantilla vivía solo en
      // memoria y quedaba vacía tras recargar la página).
      if (userTemplateRules.length === 0) {
        setWizardStatus({
          type: 'error',
          msg: 'Todavía no tenés una plantilla base guardada. Cargá tus horarios a mano y marcá "Guardar como mi Plantilla Base".'
        });
        return;
      }

      // Reemplazar horarios en la DB (antes solo se cambiaba el estado local
      // y el heatmap/matcher de los demás nunca veían el cambio)
      const templateError = await replaceMyAvailability(userTemplateRules);
      if (templateError) {
        setWizardStatus({ type: 'error', msg: templateError });
        return;
      }

      const cleanAvail = availabilities.filter(a => !ruleBelongsTo(a, currentUser));
      setAvailabilities([...cleanAvail, ...userTemplateRules]);

      setWizardStatus({ type: 'success', msg: '¡Horario base cargado con éxito para esta semana!' });

      // Disparar weekly-matcher al instante para generar propuestas
      triggerWeeklyMatcher();

      setTimeout(() => {
        setActiveTab('dashboard');
        setWizardStep(1);
      }, 2000);
    }, 1000);
  };

  const saveWizardGrid = async () => {
    setWizardStatus({ type: 'loading', msg: 'Procesando horarios de la grilla...' });
    
    // 1. Agrupar los slots por día
    const slotsByDay = {};
    wizardGrid.forEach(slot => {
      if (!slotsByDay[slot.dayIdx]) slotsByDay[slot.dayIdx] = [];
      slotsByDay[slot.dayIdx].push(slot.hour);
    });

    // 2. Encontrar bloques contiguos
    const newRules = [];
    for (let d = 0; d < 7; d++) {
      const hours = slotsByDay[d] || [];
      if (hours.length === 0) continue;
      
      hours.sort((a, b) => a - b);
      let start = hours[0];
      let prev = hours[0];

      for (let k = 1; k <= hours.length; k++) {
        const current = hours[k];
        if (current === undefined || current !== prev + 1) {
          newRules.push({
            // memberEmail acompaña a la regla desde que se crea, no solo al
            // guardarla: el estado local se arma con estos mismos objetos y sin
            // el email volvería a resolverse por nombre, reintroduciendo el
            // cruce entre homónimos hasta la próxima recarga.
            memberEmail: currentUser.email.toLowerCase(),
            user: currentUser.name,
            dayIdx: d,
            startHour: start,
            endHour: prev + 1
          });
          if (current !== undefined) start = current;
        }
        prev = current;
      }
    }

    const gridError = await replaceMyAvailability(newRules);
    if (gridError) {
      setWizardStatus({ type: 'error', msg: gridError });
      return;
    }

    // 3. Escribir a disponibilidad local
    const cleanAvail = availabilities.filter(a => !ruleBelongsTo(a, currentUser));
    setAvailabilities([...cleanAvail, ...newRules]);

    // 4. Si se guarda como plantilla (también en la DB: antes la plantilla
    // vivía solo en memoria y desaparecía al recargar la página)
    if (saveAsTemplate) {
      if (!useMockDb) {
        const myEmail = currentUser.email.toLowerCase();
        // Mismos dos pasos que en replaceMyAvailability, incluida la salvedad
        // del homónimo: las filas sin dueño resuelto no se borran por nombre si
        // hay otra persona en la sala que se llama igual.
        await supabase.from('templates')
          .delete()
          .eq('room_id', currentRoomId)
          .eq('member_email', myEmail);
        if (!hasHomonymInRoom(currentUser)) {
          await supabase.from('templates')
            .delete()
            .eq('room_id', currentRoomId)
            .is('member_email', null)
            .ilike('user', escapeLikeLiteral(currentUser.name));
        }
        if (newRules.length > 0) {
          const { error: tplError } = await supabase.from('templates').insert(
            newRules.map(r => ({
              room_id: currentRoomId,
              member_email: myEmail,
              user: r.user,
              day_idx: r.dayIdx,
              start_hour: r.startHour,
              end_hour: r.endHour
            }))
          );
          if (tplError) {
            showNotification('Tus horarios se guardaron, pero no pudimos guardar la plantilla base. Volvé a intentarlo desde el asistente.', 'error');
          }
        }
      }
      const cleanTemplate = templates.filter(t => !ruleBelongsTo(t, currentUser));
      setTemplates([...cleanTemplate, ...newRules]);
    }

    setWizardStatus({ type: 'success', msg: '¡Disponibilidad guardada correctamente!' });

    // 5. Disparar weekly-matcher al instante para generar propuestas
    triggerWeeklyMatcher();

    setTimeout(() => {
      setActiveTab('dashboard');
      setWizardStep(1);
    }, 2000);
  };

  // --- SIMULACIÓN DE AUTENTICACIÓN GOOGLE ---
  const handleGoogleLoginSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();

    setLoginError('');

    if (!useMockDb) {
      // Iniciar sesión con Google OAuth usando Supabase (no requiere ingresar email en nuestro input).
      // Antes del redirect hay una ida y vuelta de red para armar la URL de
      // OAuth; sin feedback visual el botón parecía no responder y invitaba a
      // hacer doble clic. isGoogleLoginPending lo deshabilita y muestra un
      // spinner mientras dura esa espera.
      setIsGoogleLoginPending(true);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          scopes: 'https://www.googleapis.com/auth/calendar.events',
          redirectTo: window.location.origin + `/room/${currentRoomId}`
        }
      });
      if (error) {
        setIsGoogleLoginPending(false);
        const friendlyMsg = friendlyAuthError(error, 'es');
        setLoginError(friendlyMsg);
        showNotification('Error al iniciar sesión: ' + friendlyMsg);
      }
      // En éxito no se resetea: el navegador ya está saliendo hacia Google.
      return;
    }

    // Lógica Mock (si se usa mock local)
    let emailToUse = loginEmail.trim();
    if (!emailToUse) {
      emailToUse = 'invitado@gmail.com'; // Default mock fallback
      setLoginEmail(emailToUse);
    }

    const existing = members.find(m => m.email.toLowerCase() === emailToUse.toLowerCase());

    if (existing) {
      applyLoggedInUser(existing);
      showNotification(`¡Bienvenido de vuelta, ${existing.name}!`);
    } else {
      await registerMember(nameFromEmail(emailToUse), guessCountryFromBrowserTz(), emailToUse);
    }
  };

  // Registra un miembro nuevo en Supabase y actualiza el estado local.
  // Se usa desde el auto-registro OAuth, el flujo mock y el paso de
  // código de invitación.
  const registerMember = async (rawName, rawCountry, emailOverride) => {
    const email = (emailOverride || loginEmail).trim().toLowerCase();
    // El país siempre llega resuelto por guessCountryFromBrowserTz (un país de
    // ZONAS o Argentina como fallback). Antes había una rama para el valor
    // 'Otro' que leía un estado que ya nadie escribía: si alguna vez se
    // alcanzaba, registraba a la persona con el país en blanco.
    const finalCountry = rawCountry;
    const finalTz = resolveTimezone(finalCountry);
    const newUser = {
      name: rawName.trim(),
      email,
      country: finalCountry,
      tz: finalTz,
      active: true
    };

    if (!useMockDb) {
      // El alta pasa por join_room y no por un INSERT directo: la función
      // valida el código de acceso de la sala antes de dar de alta a nadie, y
      // es idempotente si la persona ya era miembro (doble callback de OAuth,
      // dos pestañas abiertas).
      const { data, error } = await supabase.rpc('join_room', {
        p_room_id: currentRoomId,
        p_access_code: inviteCode || null,
        p_name: newUser.name,
        p_country: newUser.country,
        p_timezone: newUser.tz
      });

      if (error) {
        setLoginError(joinRoomErrorMessage(error));
        setIsLoggedIn(false);
        await supabase.auth.signOut();
        return false;
      }

      // join_room devuelve la fila real de members (la recién creada o la que
      // ya existía), así que es la fuente de verdad del perfil.
      const joined = data ? memberFromRow(data) : newUser;
      setMembers(prev => prev.some(m => m.email.toLowerCase() === joined.email.toLowerCase())
        ? prev.map(m => m.email.toLowerCase() === joined.email.toLowerCase() ? joined : m)
        : [...prev, joined]);
      applyLoggedInUser(joined);
      setRoomDataVersion(v => v + 1);
      showNotification(`¡Bienvenido a Sales Arena Matcher, ${joined.name}!`);
      return true;
    }

    setMembers(prev => {
      if (prev.some(m => m.email.toLowerCase() === newUser.email.toLowerCase())) {
        return prev.map(m => m.email.toLowerCase() === newUser.email.toLowerCase() ? newUser : m);
      }
      return [...prev, newUser];
    });

    applyLoggedInUser(newUser);

    showNotification(`¡Bienvenido a Sales Arena Matcher, ${newUser.name}!`);
    return true;
  };

  const handleLogout = async () => {
    if (!useMockDb) {
      await supabase.auth.signOut();
    }
    setIsLoggedIn(false);
    setLoginEmail('');
    setLoginStep(1);
    localStorage.removeItem('salesarena-logged');
    localStorage.removeItem('salesarena-user');
  };

  // --- GESTIÓN DE SALAS (ROOMS) ---
  const handleRenameRoom = async (e) => {
    e.preventDefault();
    if (!renameRoomInput.trim()) return;

    if (!isRoomAdmin) {
      showNotification('Solo quien administra la sala puede renombrarla.', 'error');
      return;
    }

    const nextName = renameRoomInput.trim();
    const newSlug = slugifyRoomName(nextName);

    if (!newSlug) {
      showNotification('Ese nombre no genera un enlace válido. Usá al menos una letra o un número.', 'error');
      return;
    }

    const previousName = roomName;
    setRoomName(nextName);

    if (!useMockDb) {
      // Renombrar mueve la sala entera a un slug nuevo (miembros, horarios,
      // plantillas, reuniones, asistencia y propuestas). Va por rename_room
      // para que ocurra en UNA transacción: antes eran seis escrituras sueltas
      // y un corte de red a mitad de camino partía la sala entre dos slugs.
      const { error } = await supabase.rpc('rename_room', {
        p_room_id: currentRoomId,
        p_new_slug: newSlug,
        p_new_name: nextName
      });
      if (error) {
        const raw = `${error.message || ''} ${error.details || ''}`;
        setRoomName(previousName);
        if (raw.includes('SLUG_TAKEN')) {
          showNotification(`Ya existe una sala con el nombre "${nextName}". Elegí otro nombre.`, 'error');
        } else if (raw.includes('NOT_ROOM_ADMIN')) {
          showNotification('Solo quien administra la sala puede renombrarla.', 'error');
        } else {
          showNotification('No pudimos renombrar la sala. Intentá de nuevo en un momento.', 'error');
        }
        return;
      }
    }

    if (newSlug !== currentRoomId) {
      showNotification(`¡Sala renombrada a "${nextName}"! Actualizando enlace a /room/${newSlug}...`);
      setIsRoomModalOpen(false);
      window.location.href = `/room/${newSlug}`;
    } else {
      showNotification(`Sala renombrada con éxito a "${nextName}"`);
      setIsRoomModalOpen(false);
    }
  };

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    if (currentUser.email.toLowerCase() !== ADMIN_EMAIL) {
      showNotification('Solo el administrador puede crear salas nuevas.', 'error');
      return;
    }
    if (!newRoomNameInput.trim()) return;

    const rawName = newRoomNameInput.trim();
    const slug = slugifyRoomName(rawName);

    if (!slug) {
      showNotification('Nombre de sala inválido.');
      return;
    }

    if (!useMockDb) {
      // No se permiten dos salas con el mismo nombre (mismo slug resultante)
      const { data: existingRoom } = await supabase.from('rooms').select('id').eq('id', slug).maybeSingle();
      if (existingRoom) {
        showNotification(`Ya existe una sala con el nombre "${rawName}". Elegí otro nombre.`, 'error');
        return;
      }
      // founder_email deja registrado quién administra la sala: es lo que leen
      // las políticas RLS para autorizar renombrarla, eliminarla o sacar
      // miembros. Sin esto, la sala nueva no tendría dueño.
      const { error } = await supabase.from('rooms').insert({
        id: slug,
        name: rawName,
        founder_email: currentUser.email.toLowerCase()
      });
      if (error) {
        showNotification('No pudimos crear la sala. Revisá el nombre e intentá de nuevo.', 'error');
        return;
      }
    }

    showNotification(`¡Sala "${rawName}" creada con éxito! Redirigiendo...`);
    setIsRoomModalOpen(false);
    setNewRoomNameInput('');

    window.location.href = `/room/${slug}`;
  };

  const handleDeleteRoom = async () => {
    if (currentRoomId === 'grupo-a') {
      showNotification('La sala por defecto no se puede eliminar.', 'error');
      return;
    }

    if (!isRoomAdmin) {
      showNotification('Solo quien administra la sala puede eliminarla.', 'error');
      return;
    }

    const confirmed = await showConfirm(`¿Eliminar la sala "${roomName}"? Se borrarán todos los miembros, disponibilidades y reuniones guardadas en ella. Esta acción no se puede deshacer.`);
    if (!confirmed) return;

    if (!useMockDb) {
      const { error } = await supabase.from('rooms').delete().eq('id', currentRoomId);
      if (error) {
        showNotification('No pudimos eliminar la sala. Intentá de nuevo en un momento.', 'error');
        return;
      }
    }

    showNotification(`Sala "${roomName}" eliminada correctamente.`);
    setIsRoomModalOpen(false);
    // Redirect to default room
    window.location.href = `/room/grupo-a`;
  };

  // El enlace de invitación apunta SIEMPRE al id real de la sala (no al nombre
  // slugificado, que puede diferir en salas con nombre por defecto) y lleva el
  // código de acceso: sin él, quien lo reciba no puede darse de alta (join_room
  // lo exige). Por eso este enlace es lo único que hay que compartir.
  const buildInviteUrl = () => {
    const base = `${window.location.origin}/room/${currentRoomId}`;
    return roomAccessCode ? `${base}?code=${encodeURIComponent(roomAccessCode)}` : base;
  };

  // Trae el código de acceso al abrir la administración de la sala. Solo lo
  // devuelve a quien administra; para el resto la función falla y el bloque
  // queda oculto.
  useEffect(() => {
    if (useMockDb || !isRoomModalOpen || !isRoomAdmin) return;
    let cancelled = false;
    supabase.rpc('get_room_access_code', { p_room_id: currentRoomId })
      .then(({ data, error }) => {
        if (cancelled) return;
        setRoomAccessCode(error ? '' : (data || ''));
      });
    return () => { cancelled = true; };
  }, [isRoomModalOpen, isRoomAdmin, currentRoomId]);

  const handleRegenerateAccessCode = async () => {
    const confirmed = await showConfirm(
      'Al generar un código nuevo, los enlaces de invitación que ya compartiste dejan de funcionar. Quienes ya son miembros de la sala no se ven afectados. ¿Continuar?',
      'Sí, generar'
    );
    if (!confirmed) return;

    const { data, error } = await supabase.rpc('rotate_room_access_code', { p_room_id: currentRoomId });
    if (error) {
      showNotification('No pudimos generar un código nuevo. Intentá de nuevo en un momento.', 'error');
      return;
    }
    setRoomAccessCode(data || '');
    showNotification('Código de acceso renovado. Compartí el enlace nuevo con quien quieras invitar.', 'success');
  };

  const handleCopyRoomInvite = async () => {
    const inviteUrl = buildInviteUrl();
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showNotification(
        `Enlace de invitación de "${roomName}" copiado. Incluye el código de acceso, así que quien lo reciba entra directo; sin ese enlace nadie puede sumarse.`,
        'success'
      );
    } catch {
      // Sin permiso de portapapeles (o navegador viejo): se muestra el enlace
      // con el resto de los avisos de la app, en vez de un prompt() nativo que
      // rompía la consistencia visual del resto de los diálogos.
      showNotification(`Copiá este enlace para invitar a tu equipo:\n\n${inviteUrl}`, 'info');
    }
  };

  // --- ADMINISTRAR MIEMBROS ---
  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!newMemberName || !newMemberEmail) return;

    // Dar de alta a otra persona a mano es una acción de administración: la
    // política de INSERT de members la restringe a quien administra la sala.
    if (!isRoomAdmin) {
      showNotification('Solo quien administra la sala puede agregar miembros a mano. Compartí el enlace de invitación para que se registren.', 'error');
      return;
    }

    const alreadyMember = members.some(
      m => m.email.toLowerCase() === newMemberEmail.trim().toLowerCase()
    );
    if (alreadyMember) {
      showNotification(`${newMemberEmail.trim()} ya forma parte de esta sala.`, 'error');
      return;
    }

    const finalCountry = newMemberCountry === 'Otro' ? customNewMemberCountry.trim() : newMemberCountry;
    const finalTz = resolveTimezone(finalCountry);
    const newMember = {
      name: newMemberName,
      email: newMemberEmail,
      country: finalCountry,
      tz: finalTz,
      // Se da de alta SIN participar: quien se agrega a mano todavía no entró a
      // la app ni cargó horarios. Con active: true entraba al emparejamiento y
      // podía tocarle una sesión que nunca supo que existía, dejando plantado a
      // su compañero. Queda activo cuando entra y elige participar.
      active: false
    };

    if (!useMockDb) {
      const { error } = await supabase.from('members').insert({
        room_id: currentRoomId,
        email: newMember.email,
        name: newMember.name,
        country: newMember.country,
        timezone: newMember.tz,
        active: newMember.active
      });
      if (error) {
        showNotification(
          error.code === '23505'
            ? `${newMember.email} ya forma parte de esta sala.`
            : 'No pudimos agregar a esa persona. Revisá el email e intentá de nuevo.',
          'error'
        );
        return;
      }
    }

    setMembers([...members, newMember]);
    setNewMemberName('');
    setNewMemberEmail('');
    showNotification(`${newMember.name} quedó agregado a la sala. Va a entrar en los emparejamientos cuando inicie sesión y cargue su disponibilidad — pasale el enlace de invitación.`, 'success');
  };

  const deleteMember = async (emailToDelete) => {
    if (emailToDelete.toLowerCase() === currentUser.email.toLowerCase()) {
      showNotification('No podés eliminarte a vos mismo. Usá el interruptor de participación para dejar de entrar en los emparejamientos.', 'error');
      return;
    }

    // Sacar a alguien de la sala es una acción sobre OTRA persona y no se puede
    // deshacer: queda reservada a quien administra. La base de datos aplica el
    // mismo criterio (política "Admins remove members, members can leave"), así
    // que este chequeo solo sirve para dar un mensaje claro antes de intentarlo.
    if (!isRoomAdmin) {
      showNotification('Solo quien administra la sala puede eliminar miembros.', 'error');
      return;
    }

    const memberObj = members.find(m => m.email.toLowerCase() === emailToDelete.toLowerCase());
    const label = memberObj ? memberObj.name : emailToDelete;
    const confirmed = await showConfirm(
      `¿Eliminar a ${label} de "${roomName}"? Se borran también sus horarios y su plantilla. Esta acción no se puede deshacer.`
    );
    if (!confirmed) return;

    if (!useMockDb) {
      const { error } = await supabase.from('members')
        .delete()
        .eq('room_id', currentRoomId)
        .eq('email', emailToDelete);
      if (error) {
        showNotification('No pudimos eliminar a esa persona. Intentá de nuevo en un momento.', 'error');
        return;
      }
      // availabilities y templates NO tienen clave foránea contra members (solo
      // contra rooms), así que borrar el miembro dejaba sus horarios vivos en la
      // base: volvían al recargar, inflaban el contador de bloques y los
      // heredaba cualquiera que se registrara después con el mismo nombre.
      if (memberObj) {
        // Se limpia por email, que es el vínculo estable. Las filas anteriores
        // a member_email solo se pueden reconocer por nombre, así que se
        // barren únicamente cuando nadie más en la sala se llama igual: si hay
        // un homónimo, esas filas podrían ser suyas y borrarlas le vaciaría la
        // agenda a alguien que sigue en la sala.
        const targetEmail = emailToDelete.toLowerCase();
        const orphanCleanup = [
          supabase.from('availabilities').delete()
            .eq('room_id', currentRoomId).eq('member_email', targetEmail),
          supabase.from('templates').delete()
            .eq('room_id', currentRoomId).eq('member_email', targetEmail)
        ];
        if (!hasHomonymInRoom(memberObj)) {
          orphanCleanup.push(
            supabase.from('availabilities').delete()
              .eq('room_id', currentRoomId).is('member_email', null)
              .ilike('user', escapeLikeLiteral(memberObj.name)),
            supabase.from('templates').delete()
              .eq('room_id', currentRoomId).is('member_email', null)
              .ilike('user', escapeLikeLiteral(memberObj.name))
          );
        }
        const results = await Promise.all(orphanCleanup);
        const failed = results.find(r => r.error);
        if (failed) {
          showNotification(
            `${label} salió de la sala, pero quedaron horarios suyos sin borrar. Volvé a intentarlo para limpiarlos.`,
            'error'
          );
        }
      }
    }

    setMembers(prev => prev.filter(m => m.email.toLowerCase() !== emailToDelete.toLowerCase()));
    if (memberObj) {
      setAvailabilities(prev => prev.filter(a => !ruleBelongsTo(a, memberObj)));
      setTemplates(prev => prev.filter(t => !ruleBelongsTo(t, memberObj)));
    }
    showNotification(`${label} fue eliminado de la sala.`, 'success');
  };

  // --- CAMBIAR ESTADO SEMANAL DEL USUARIO LOGUEADO ---
  const toggleCurrentUserActive = async () => {
    const nextActiveState = !currentUser.active;
    
    // Actualizar estado del usuario conectado
    setCurrentUser(prev => ({ ...prev, active: nextActiveState }));

    // Actualizar estado en la base de datos de miembros
    setMembers(prev => prev.map(m => 
      m.email.toLowerCase() === currentUser.email.toLowerCase() ? { ...m, active: nextActiveState } : m
    ));

    if (!useMockDb) {
      const { error } = await supabase.from('members')
        .update({ active: nextActiveState })
        .eq('room_id', currentRoomId)
        .eq('email', currentUser.email);
      if (error) {
        showNotification('Error al actualizar estado en Supabase');
        return;
      }
    }

    if (!nextActiveState) {
      // Limpiar horarios semanales (evitar falsos positivos de reuniones vacías)
      const clearError = await replaceMyAvailability([]);
      if (clearError) {
        showNotification(clearError, 'error');
        return;
      }
      setAvailabilities(prev => prev.filter(a => !ruleBelongsTo(a, currentUser)));
      showNotification('Has desactivado tu participación. No serás coordinado para los role-plays de esta semana.');
    } else {
      // Cargar disponibilidad desde la plantilla habitual
      const userTemplateRules = templates.filter(t => ruleBelongsTo(t, currentUser));

      // Si el guardado falla no se puede avisar "participación activada": el
      // borrado ya corrió, así que la persona quedaría activa y sin ningún
      // horario cargado, viendo en pantalla una agenda que no existe en la base.
      const activateError = await replaceMyAvailability(userTemplateRules);
      if (activateError) {
        showNotification(activateError, 'error');
        return;
      }

      setAvailabilities(prev => [...prev, ...userTemplateRules]);
      showNotification('¡Participación activada! Hemos cargado tus horarios semanales desde tu plantilla base.');

      // Disparar weekly-matcher al instante para generar propuestas
      triggerWeeklyMatcher();
    }
  };

  // --- AGENDAR REUNIÓN CON APIS REALES DE GOOGLE CALENDAR / MEET ---
  // Crea la reunión real (Meet + registro + compromiso de asistencia) para una
  // propuesta 1:1 confirmada por ambas partes
  const createProposalMeeting = async (proposal) => {
    const participantsStr = `${proposal.aName}, ${proposal.bName}`;
    const title = `Roleplay — ${proposal.aName.split(' ')[0]} · ${proposal.bName.split(' ')[0]}`;

    setSchedulingStatus('loading');
    setScheduledDetails({
      title,
      attendeesCount: 2
    });

    // Fecha/hora UTC real de la próxima ocurrencia del slot propuesto (con el
    // mismo piso de antelación que usó el emparejador para planificarla)
    const startDate = getNextMatchDateUtc({ startSlot: proposal.slot }, MIN_LEAD_MS);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

    await sleep(1000);
    setSchedulingStatus('authenticating');
    await sleep(1200);
    setSchedulingStatus('creating');

    let meetUrl;

    if (useMockDb) {
      // Solo para demo local sin Supabase: enlace simulado
      meetUrl = `https://meet.google.com/${Math.random().toString(36).substring(2, 5)}-${Math.random().toString(36).substring(2, 6)}-${Math.random().toString(36).substring(2, 5)}`;
    } else {
      // Producción: el enlace DEBE venir de Google Calendar. Si algo falla,
      // se informa el error y no se guarda ninguna reunión falsa.
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const providerToken = sessionData.session?.provider_token; // Token de Google OAuth

        if (!providerToken) {
          throw new Error(GOOGLE_REAUTH_MESSAGE);
        }

        const eventPayload = {
          summary: `Sales Arena Roleplay: ${participantsStr}`,
          description: 'Videollamada de entrenamiento agendada mediante Sales Arena Matcher.',
          start: { dateTime: startDate.toISOString(), timeZone: 'UTC' },
          end: { dateTime: endDate.toISOString(), timeZone: 'UTC' },
          attendees: [{ email: proposal.aEmail }, { email: proposal.bEmail }],
          conferenceData: {
            createRequest: {
              requestId: Math.random().toString(36).substring(2),
              conferenceSolutionKey: { type: 'hangoutsMeet' }
            }
          },
          // Recordatorios: el aviso al móvil llega por la app de Google
          // Calendar, que ya tiene el evento porque ambos van como attendees.
          // OJO con el alcance: la API aplica estos overrides SOLO a la copia
          // del evento de quien lo crea (el usuario autenticado). A la otra
          // persona le rigen sus propios avisos por defecto de Google —no se
          // pueden fijar de forma remota—, que normalmente son 10 min antes.
          // Por eso esto mejora el caso de quien agenda, pero no garantiza el
          // recordatorio del compañero; ver nota en el README sobre el
          // recordatorio propio del sistema.
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'email', minutes: 24 * 60 }, // el día anterior, por mail
              { method: 'popup', minutes: 60 },      // 1 h antes: push al móvil
              { method: 'popup', minutes: 10 }       // justo antes de empezar
            ]
          }
        };

        // Petición oficial a la REST API de Google Calendar
        const response = await fetch(
          'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${providerToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(eventPayload)
          }
        );

        if (!response.ok) {
          // 401/403 = el permiso de Google venció. Dura alrededor de una hora y
          // Supabase no lo renueva solo (solo refresca su propio JWT, no los
          // tokens de terceros), así que a una sesión larga le caduca en
          // silencio. Se traduce a la única acción que lo resuelve, en vez de
          // devolver el mensaje técnico de Google.
          if (response.status === 401 || response.status === 403) {
            throw new Error(GOOGLE_REAUTH_MESSAGE);
          }
          const errBody = await response.json().catch(() => null);
          throw new Error(errBody?.error?.message || `Google Calendar respondió con error ${response.status}.`);
        }

        const eventData = await response.json();
        if (!eventData.hangoutLink) {
          throw new Error('Google Calendar creó el evento pero no devolvió un enlace de Meet.');
        }
        meetUrl = eventData.hangoutLink;
      } catch (err) {
        console.error('Error al agendar en Google Calendar:', err);
        setSchedulingStatus(null);
        showNotification(`La dupla está confirmada, pero no pudimos crear el Meet. ${err.message}`, 'error');
        return;
      }
    }

    const newMeeting = {
      id: null,
      title,
      dateUtc: formatMeetingDateUtc(startDate, DIAS[Math.floor(proposal.slot / 24)]),
      duration: 60,
      participants: participantsStr,
      meetLink: meetUrl,
      startsAt: startDate.toISOString(),
      status: 'Creado (Meet)'
    };

    // Participantes de la dupla (para las filas de compromiso de asistencia)
    const participantRows = [
      { name: proposal.aName, email: proposal.aEmail },
      { name: proposal.bName, email: proposal.bEmail }
    ];

    if (!useMockDb) {
      const { data: inserted, error: insertError } = await supabase.from('meetings').insert({
        room_id: currentRoomId,
        title: newMeeting.title,
        date_utc: newMeeting.dateUtc,
        duration: newMeeting.duration,
        participants: newMeeting.participants,
        meet_link: newMeeting.meetLink,
        starts_at: newMeeting.startsAt
      }).select().single();

      if (insertError || !inserted) {
        // El evento de Calendar ya existe; avisar que no quedó registrado en la sala
        showNotification('La reunión se creó en Google Calendar, pero no se pudo guardar en la sala: ' + (insertError?.message || 'error desconocido'), 'error');
      } else {
        newMeeting.id = inserted.id;
        // Compromiso de asistencia: una fila 'confirmado' por participante
        const { data: attInserted, error: attError } = await supabase
          .from('meeting_attendees')
          .insert(participantRows.map(p => ({
            meeting_id: inserted.id,
            room_id: currentRoomId,
            member_email: p.email,
            member_name: p.name,
            status: 'confirmado'
          })))
          .select();
        if (attError) {
          showNotification('La reunión quedó agendada, pero no pudimos registrar el compromiso de asistencia. Avisale a tu compañero por las dudas.', 'error');
        } else if (attInserted) {
          setAttendances(prev => [...prev, ...attInserted.map(attendanceFromRow)]);
        }
      }
    } else {
      // Modo demo: ids locales
      newMeeting.id = Date.now();
      setAttendances(prev => [...prev, ...participantRows.map((p, i) => ({
        id: newMeeting.id + i + 1,
        meetingId: newMeeting.id,
        memberEmail: p.email,
        memberName: p.name,
        status: 'confirmado',
        reportedBy: null,
        reportedAt: null
      }))]);
    }

    // Vincular la reunión creada a la propuesta
    if (!useMockDb && newMeeting.id != null) {
      await supabase.from('match_proposals').update({ meeting_id: newMeeting.id }).eq('id', proposal.id);
    }
    setProposals(prev => prev.map(p => p.id === proposal.id ? { ...p, meetingId: newMeeting.id } : p));

    setMeetings(prev => [...prev, newMeeting]);
    setSchedulingStatus('success');

    setTimeout(() => {
      setSchedulingStatus(null);
    }, 3000);
  };

  // Doble opt-in: aceptar o rechazar mi propuesta semanal. La reunión real
  // solo se crea cuando AMBAS partes aceptaron.
  const respondToProposal = async (proposal, accept) => {
    const meIsA = proposal.aEmail.toLowerCase() === currentUser.email.toLowerCase();
    const otherStatus = meIsA ? proposal.statusB : proposal.statusA;
    const newSide = accept ? 'aceptado' : 'rechazado';

    let newStatus = proposal.status;
    if (!accept) newStatus = 'rechazado';
    else if (otherStatus === 'aceptado') newStatus = 'confirmado';

    // ¿Este cliente es el responsable de crear el Meet?
    let shouldCreateMeeting = newStatus === 'confirmado';

    if (!useMockDb) {
      // 1. Guardar SOLO mi lado (y el rechazo, que es unilateral). La
      //    promoción a 'confirmado' va aparte con un update condicional:
      //    si ambos aceptan casi a la vez, cada cliente veía al otro en
      //    'pendiente' (estado local viejo), ambos escribían
      //    status='propuesto' y la dupla quedaba trabada sin Meet.
      const dbPatch = meIsA ? { status_a: newSide } : { status_b: newSide };
      if (!accept) dbPatch.status = 'rechazado';
      const { error } = await supabase.from('match_proposals').update(dbPatch).eq('id', proposal.id);
      if (error) {
        showNotification('No pudimos guardar tu respuesta. Revisá la conexión e intentá nuevamente.', 'error');
        return;
      }

      if (accept) {
        // 2. Releer la fila para conocer la respuesta REAL del compañero y,
        //    si ambos aceptaron, reclamar la confirmación de forma atómica
        //    (.eq status 'propuesto'): un solo cliente "gana" y crea el Meet.
        const { data: fresh } = await supabase.from('match_proposals')
          .select('status_a, status_b, status')
          .eq('id', proposal.id)
          .maybeSingle();
        const bothAccepted = !!fresh && fresh.status_a === 'aceptado' && fresh.status_b === 'aceptado';
        shouldCreateMeeting = false;
        if (bothAccepted) {
          newStatus = 'confirmado';
          if (fresh.status !== 'confirmado') {
            const { data: claimed } = await supabase.from('match_proposals')
              .update({ status: 'confirmado' })
              .eq('id', proposal.id)
              .eq('status', 'propuesto')
              .select('id');
            shouldCreateMeeting = !!claimed && claimed.length > 0;
          }
        } else {
          newStatus = fresh?.status || 'propuesto';
        }
      }
    }

    const updated = {
      ...proposal,
      [meIsA ? 'statusA' : 'statusB']: newSide,
      status: newStatus
    };
    setProposals(prev => prev.map(p => p.id === proposal.id ? updated : p));

    if (!accept) {
      showNotification('Rechazaste la propuesta. El emparejador te asignará otro compañero disponible en la próxima corrida.');
      return;
    }
    if (newStatus === 'confirmado' && shouldCreateMeeting) {
      await createProposalMeeting(updated);
    } else if (newStatus === 'confirmado') {
      showNotification('¡Dupla confirmada! Tu compañero está generando el Meet; el enlace aparecerá en la sala en un momento.', 'success');
    } else {
      const partnerName = meIsA ? proposal.bName : proposal.aName;
      showNotification(`¡Aceptaste! Esperando la confirmación de ${partnerName.split(' ')[0]}.`, 'success');
    }
  };

  // --- COMPROMISO DE ASISTENCIA ---
  // Registra que el usuario abrió el Meet (click al botón/enlace). El barrido de
  // asistencia del weekly-matcher usa joined_at para resolver automáticamente,
  // a los 10 min del inicio, quién asistió y quién quedó no-show. Es fire-and-
  // forget: no bloquea la apertura del enlace.
  const markJoined = (meeting) => {
    if (!meeting || meeting.id == null || !currentUser) return;
    const mine = attendances.find(a =>
      a.meetingId === meeting.id &&
      a.memberEmail.toLowerCase() === currentUser.email.toLowerCase()
    );
    if (!mine || mine.joinedAt || mine.status !== 'confirmado') return; // ya registrado o ya resuelto
    const joinedAt = new Date().toISOString();
    setAttendances(prev => prev.map(a => a.id === mine.id ? { ...a, joinedAt } : a));
    if (!useMockDb) {
      supabase.from('meeting_attendees')
        .update({ joined_at: joinedAt })
        .eq('id', mine.id)
        .then(({ error }) => {
          if (error) console.error('No se pudo registrar joined_at:', error.message);
        });
    }
  };

  // El compañero reporta el resultado del otro. outcome:
  //   'a_tiempo' → asistió dentro de los 10 min de tolerancia
  //   'tarde'    → asistió pero fuera de la tolerancia
  //   'no_show'  → no se presentó (cuenta como falta)
  const reportAttendance = async (attendance, outcome) => {
    const newStatus = outcome === 'no_show' ? 'no_show' : 'asistio';
    const punctuality = outcome === 'no_show' ? null : outcome;
    const reportedAt = new Date().toISOString();

    if (!useMockDb) {
      const { error } = await supabase.from('meeting_attendees')
        .update({ status: newStatus, punctuality, reported_by: currentUser.email, reported_at: reportedAt })
        .eq('id', attendance.id);
      if (error) {
        showNotification('No pudimos registrar la asistencia. Intentá nuevamente antes de cerrar esta pantalla.', 'error');
        return;
      }
    }

    setAttendances(prev => prev.map(a =>
      a.id === attendance.id
        ? { ...a, status: newStatus, punctuality, reportedBy: currentUser.email, reportedAt }
        : a
    ));
    const msg = {
      a_tiempo: `Confirmaste que ${attendance.memberName} asistió a tiempo.`,
      tarde: `Registraste que ${attendance.memberName} llegó tarde.`,
      no_show: `Reportaste que ${attendance.memberName} no se presentó.`
    }[outcome];
    showNotification(msg, 'success');
  };

  // El propio usuario cancela su asistencia ANTES del inicio.
  //   +24hs de antelación → 'cancelado_con_aviso' (no penaliza)
  //   <24hs               → 'cancelado_tarde' con MOTIVO obligatorio (cuenta
  //                          como falta; 3 en el mes bloquean al miembro)
  const cancelMyAttendance = async (meeting) => {
    const mine = attendances.find(a =>
      a.meetingId === meeting.id &&
      a.memberEmail.toLowerCase() === currentUser.email.toLowerCase()
    );
    if (!mine || mine.status !== 'confirmado' || meetingHasStarted(meeting)) return;

    const hoursUntil = meeting.startsAt
      ? (new Date(meeting.startsAt).getTime() - Date.now()) / 3600000
      : Infinity;
    const isLate = hoursUntil < 24;

    let newStatus, cancelReason = null;
    if (isLate) {
      const reason = await showPrompt(
        `Faltan menos de 24hs para "${meeting.title}". Cancelar ahora cuenta como falta. Detallá el motivo (obligatorio). Con 3 faltas en el mes quedarás sin emparejamientos hasta el mes siguiente.`,
        'Ej: surgió una urgencia laboral...'
      );
      if (reason === null) return; // el usuario desistió
      newStatus = 'cancelado_tarde';
      cancelReason = reason;
    } else {
      const confirmed = await showConfirm(
        `¿Cancelar con aviso tu asistencia a "${meeting.title}"? Faltan más de 24hs, así que NO cuenta como falta. Tus compañeros lo verán reflejado.`,
        'Sí, cancelar'
      );
      if (!confirmed) return;
      newStatus = 'cancelado_con_aviso';
    }

    const reportedAt = new Date().toISOString();
    if (!useMockDb) {
      const { error } = await supabase.from('meeting_attendees')
        .update({ status: newStatus, cancel_reason: cancelReason, reported_by: currentUser.email, reported_at: reportedAt })
        .eq('id', mine.id);
      if (error) {
        showNotification('No pudimos registrar la cancelación. Intentá de nuevo en un momento.', 'error');
        return;
      }
    }

    setAttendances(prev => prev.map(a =>
      a.id === mine.id
        ? { ...a, status: newStatus, cancelReason, reportedBy: currentUser.email, reportedAt }
        : a
    ));

    // Cerrar la propuesta vinculada: sin esto, la dupla quedaría 'confirmado'
    // toda la semana y el emparejador nunca liberaría a ninguno de los dos.
    // Con 'cancelado', ambos vuelven al pool y pueden ser reasignados con otro
    // compañero disponible en la próxima corrida (cada 10 min).
    const linkedProposal = proposals.find(p => p.meetingId === meeting.id);
    if (linkedProposal) {
      if (!useMockDb) {
        // Si el CHECK de la base aún no admite 'cancelado' (migración
        // pendiente), este update falla sin romper el flujo: la UI oculta la
        // reunión igual a partir de la cancelación de asistencia.
        await supabase.from('match_proposals')
          .update({ status: 'cancelado' })
          .eq('id', linkedProposal.id);
      }
      setProposals(prev => prev.map(p =>
        p.id === linkedProposal.id ? { ...p, status: 'cancelado' } : p));
    }

    showNotification(
      isLate
        ? 'Cancelaste sobre la hora. Quedó registrada como falta del mes.'
        : 'Cancelaste tu asistencia con aviso. No cuenta como falta.',
      isLate ? 'error' : 'success'
    );
  };

  // Los avisos de error NO se autodestruyen: quedan hasta que se cierran a
  // mano. Varios pasan de 130 caracteres y piden una acción concreta ("Volvé a
  // intentarlo desde el asistente", "Avisale a tu compañero"), y leer eso lleva
  // más de los 4,5 s que duraba el toast: el mensaje desaparecía antes de
  // terminar de leerlo, justo cuando algo salió mal. Los informativos y los de
  // éxito sí se van solos, que es el uso para el que sirve un toast.
  const showNotification = (msg, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, msg, type }]);
    if (type === 'error') return;
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  // confirmLabel por defecto asume que la acción es destructiva (el uso más
  // común: eliminar sala, eliminar miembro). Los dos llamadores que NO borran
  // nada (renovar código, cancelar con aviso) pasan su propio texto —
  // confirmar con "Sí, eliminar" cuando en realidad se está generando un
  // código o cancelando una sesión es engañoso.
  const showConfirm = (msg, confirmLabel = 'Sí, eliminar') => new Promise((resolve) => {
    setConfirmModal({
      msg,
      confirmLabel,
      onConfirm: () => { setConfirmModal(null); resolve(true); },
      onCancel:  () => { setConfirmModal(null); resolve(false); }
    });
  });

  // Pide un texto obligatorio (ej. motivo de cancelación tardía). Resuelve con
  // el texto ingresado, o null si el usuario cancela.
  const showPrompt = (msg, placeholder = '') => new Promise((resolve) => {
    setPromptValue('');
    setPromptModal({
      msg,
      placeholder,
      onSubmit: (val) => { setPromptModal(null); resolve(val); },
      onCancel: () => { setPromptModal(null); resolve(null); }
    });
  });

  // --- GESTIÓN DE CELDAS DEL CALENDARIO ---
  const handleCellMouseDown = (dayIdx, hour) => {
    setIsMouseDown(true);
    const exists = wizardGrid.some(s => s.dayIdx === dayIdx && s.hour === hour);
    const active = !exists;
    setDragMode(active);
    toggleCell(dayIdx, hour, active);
  };

  // Arrastrar para seleccionar un rango es un gesto de mouse/touch: no tiene
  // equivalente por teclado. WCAG 2.2 exige una alternativa de un solo golpe
  // para cualquier acción que dependa de arrastrar, así que Enter/Espacio
  // alternan la celda enfocada una por una (igual que un clic sin arrastre).
  const handleCellKeyDown = (dayIdx, hour, e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); // el espacio no debe desplazar la página
    handleCellMouseDown(dayIdx, hour);
  };

  const handleCellMouseEnter = (dayIdx, hour) => {
    if (isMouseDown) {
      toggleCell(dayIdx, hour, dragMode);
    }
  };

  const toggleCell = (dayIdx, hour, active) => {
    if (active) {
      setWizardGrid(prev => {
        if (prev.some(s => s.dayIdx === dayIdx && s.hour === hour)) return prev;
        return [...prev, { dayIdx, hour }];
      });
    } else {
      setWizardGrid(prev => prev.filter(s => !(s.dayIdx === dayIdx && s.hour === hour)));
    }
  };

  const clearAllCells = () => {
    setWizardGrid([]);
  };

  // Presets rápidos de disponibilidad (se suman a la selección actual)
  const applyPreset = (preset) => {
    const slots = [];
    const addRange = (days, from, to) => {
      days.forEach(d => {
        for (let h = from; h < to; h++) slots.push({ dayIdx: d, hour: h });
      });
    };
    const WORKDAYS = [0, 1, 2, 3, 4];
    const ALLDAYS = [0, 1, 2, 3, 4, 5, 6];

    if (preset === 'work') addRange(WORKDAYS, 9, 18);
    if (preset === 'mornings') addRange(ALLDAYS, 8, 12);
    if (preset === 'evenings') addRange(ALLDAYS, 18, 22);

    setWizardGrid(prev => {
      const merged = [...prev];
      slots.forEach(s => {
        if (!merged.some(m => m.dayIdx === s.dayIdx && m.hour === s.hour)) merged.push(s);
      });
      return merged;
    });
  };

  const handleTabClick = (tab) => {
    setActiveTab(tab);
    setIsSidebarOpen(false); // Cierra el menú al cambiar de pestaña en móvil
  };

  if (!isLoggedIn || !currentUser) {
    return (
      <div className="login-screen">
        {/* Selector de tema (claro / oscuro / seguir sistema) */}
        <div className="login-theme-switch">
          <div className="theme-selector" style={{ margin: 0 }}>
            <button className={`theme-btn ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')} title="Modo Claro" aria-pressed={theme === 'light'}>
              <Sun size={12} aria-hidden="true" />
            </button>
            <button className={`theme-btn ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')} title="Modo Oscuro" aria-pressed={theme === 'dark'}>
              <Moon size={12} aria-hidden="true" />
            </button>
            <button className={`theme-btn ${theme === 'system' ? 'active' : ''}`} onClick={() => setTheme('system')} title="Seguir Sistema" aria-pressed={theme === 'system'}>
              <Monitor size={12} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Halo de piezas de ajedrez + íconos de conexión orbitando la tarjeta:
            el "juego" (role-play) y el "match" (conectar personas), sin logos
            de terceros. Puramente decorativo, oculto a lectores de pantalla. */}
        <LoginConnectionsOrbit />

        <div className="login-card">
          {/* Marca */}
          <a
            href="https://sales-arena.netlify.app/"
            target="_blank"
            rel="noopener noreferrer"
            title="Visitar el portal oficial de Sales Arena"
            className="login-brand"
          >
            <div className="brand-logo-container horse-glow-pulse">
              <ChessKnightIcon size={44} />
            </div>
            <div className="brand-title-stacked" style={{ textAlign: 'left' }}>
              <span className="brand-title-sales" style={{ fontSize: '12px' }}>Sales Arena</span>
              <span className="brand-title-arena" style={{ fontSize: '20px' }}>Matcher</span>
            </div>
          </a>

          {loginStep === 1 && (
            <div>
              <p className="login-lede">
                Coordiná tu próxima sesión de práctica de ventas en un clic.
              </p>

              {/* Disclosure del uso de Google Calendar, visible antes de iniciar
                  sesión (requisito de verificación de la pantalla de consentimiento
                  OAuth de Google). La descripción general del producto ya vive en
                  la landing pública (/), no hace falta repetirla en este paso. */}
              <div className="login-disclosure">
                <div className="login-disclosure-icon">
                  <CalendarCheck size={15} aria-hidden="true" />
                </div>
                <span>
                  Al iniciar sesión con Google, la app usa el acceso a tu <strong>Google Calendar</strong> con
                  un único fin: crear el evento con el enlace de <strong>Google Meet</strong> cuando
                  ambos integrantes de una dupla confirman la sesión. No se accede a otros datos de tu cuenta.
                </span>
              </div>

              {isInAppBrowserDetected && (
                <div className="login-notice login-notice--warning">
                  <ExternalLink size={18} style={{ color: 'var(--color-warning)', flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
                  <div>
                    <strong>Abrí el enlace en tu navegador</strong>
                    <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                      Google bloquea el acceso desde navegadores integrados. Abrí este enlace en <strong>Chrome</strong>, <strong>Safari</strong> u otro navegador de tu dispositivo.
                    </p>
                  </div>
                </div>
              )}

              {loginError && (
                <div className="login-notice login-notice--danger" role="alert">
                  <AlertCircle size={18} style={{ color: 'var(--color-danger)', flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
                  <div>{loginError}</div>
                </div>
              )}

              {!useMockDb ? (
                /* REAL PRODUCTION OAUTH: Single-click Google login */
                <button
                  type="button"
                  className="login-google-btn"
                  onClick={handleGoogleLoginSubmit}
                  disabled={isGoogleLoginPending}
                  aria-busy={isGoogleLoginPending}
                >
                  {isGoogleLoginPending ? (
                    <span className="spinner" style={{ width: '16px', height: '16px' }}></span>
                  ) : (
                    <span className="login-google-mark" aria-hidden="true">
                      <GoogleMark />
                    </span>
                  )}
                  {isGoogleLoginPending ? 'Redirigiendo a Google…' : 'Iniciar sesión con Google'}
                </button>
              ) : (
                /* LOCAL MOCK TESTING: With optional email input */
                <form onSubmit={handleGoogleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="form-group" style={{ textAlign: 'left' }}>
                    <label htmlFor="login-email" style={{ fontSize: '12px', fontWeight: '600', marginBottom: '6px', display: 'block' }}>Correo de Prueba (Gmail)</label>
                    <input
                      type="email"
                      id="login-email"
                      className="form-input"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="Ej. tu.nombre@gmail.com o @example.com"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px' }}
                    />
                  </div>
                  <button type="submit" className="login-google-btn">
                    <span className="login-google-mark" aria-hidden="true">
                      <GoogleMark />
                    </span>
                    Continuar con Google (Simulado)
                  </button>
                </form>
              )}
            </div>
          )}

          <div className="login-footer">
            {/* Legal links: required so the privacy policy is discoverable from
                within the app interface, not only on the marketing homepage
                (Google OAuth verification requirement). */}
            <div className="login-legal">
              <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer">Política de Privacidad</a>
              <span className="login-legal-sep" aria-hidden="true">·</span>
              <a href="/terms-of-service.html" target="_blank" rel="noopener noreferrer">Términos de Servicio</a>
            </div>
            <a
              className="login-portal-link"
              href="https://sales-arena.netlify.app/"
              target="_blank"
              rel="noopener noreferrer"
            >
              ¿Conocés Sales Arena? <strong>Visitar Portal Oficial ↗</strong>
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Cuenta con patrón repetido de ausencias/cancelaciones tardías (bloqueada
  // 3+ meses distintos en esta sala): se le retira el acceso en vez de dejarla
  // seguir coordinando sesiones y dejando compañeros sin práctica.
  if (isChronicOffender(currentUser.email)) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--bg-main)',
        backgroundImage: 'var(--bg-glows)',
        backgroundAttachment: 'fixed',
        color: 'var(--text-main)',
        fontFamily: 'var(--font-sans)',
        padding: '20px',
      }}>
        <div className="glass" style={{ maxWidth: '440px', width: '100%', padding: '32px', textAlign: 'center' }}>
          <div style={{
            width: '52px', height: '52px', borderRadius: '50%', margin: '0 auto 18px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(255,59,48,0.1)', color: 'var(--color-danger)'
          }}>
            <Lock size={24} />
          </div>
          <h1 style={{ margin: '0 0 10px 0', fontSize: '19px', fontWeight: '800', letterSpacing: '-0.3px' }}>
            Acceso retirado de esta sala
          </h1>
          <p style={{ margin: '0 0 16px 0', fontSize: '13.5px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
            Detectamos ausencias o cancelaciones tardías reportadas en {CHRONIC_BLOCK_THRESHOLD} meses distintos con esta cuenta de Google, dejando a tu compañero de role-play sin sesión cada vez. Por eso <strong style={{ color: 'var(--text-main)' }}>{currentUser.email}</strong> ya no puede coordinar sesiones en <strong style={{ color: 'var(--text-main)' }}>{roomName}</strong>.
          </p>
          <p style={{ margin: '0 0 22px 0', fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
            Si creés que esto es un error (por ejemplo, sesiones mal reportadas), escribinos a{' '}
            <a href="mailto:community.argen.manager@gmail.com" style={{ color: 'var(--color-primary)' }}>community.argen.manager@gmail.com</a>{' '}
            para revisarlo.
          </p>
          <button type="button" className="btn btn-outline" onClick={handleLogout} style={{ width: '100%' }}>
            <LogOut size={15} /> Cerrar Sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`layout-container ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>

      {/* SKIP LINK: keyboard users can bypass the sidebar nav and jump straight to content */}
      <a href="#main-content" className="skip-to-content">Saltar al contenido principal</a>

      {/* TOAST NOTIFICATION SYSTEM */}
      <div className="toast-container">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`toast-item toast-${t.type}`}
            role={t.type === 'error' ? 'alert' : 'status'}
            aria-live={t.type === 'error' ? 'assertive' : 'polite'}
          >
            <span className="toast-icon" aria-hidden="true">
              {t.type === 'error' ? '✕' : t.type === 'success' ? '✓' : 'i'}
            </span>
            <span className="toast-msg">{t.msg}</span>
            <button className="toast-close" aria-label="Cerrar notificación" onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>✕</button>
          </div>
        ))}
      </div>

      {/* CONFIRM MODAL */}
      {confirmModal && (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-describedby="confirm-modal-msg">
          <div className="confirm-card" ref={confirmModalRef} tabIndex={-1}>
            <div className="confirm-icon"><AlertCircle size={36} /></div>
            <p className="confirm-msg" id="confirm-modal-msg">{confirmModal.msg}</p>
            <div className="confirm-actions">
              <button className="btn btn-outline" onClick={confirmModal.onCancel}>Cancelar</button>
              <button className="btn btn-danger" onClick={confirmModal.onConfirm}>{confirmModal.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}

      {promptModal && (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-describedby="prompt-modal-msg">
          <div className="confirm-card" ref={promptModalRef} tabIndex={-1}>
            <div className="confirm-icon"><AlertCircle size={36} /></div>
            <p className="confirm-msg" id="prompt-modal-msg">{promptModal.msg}</p>
            <textarea
              className="prompt-textarea"
              rows={3}
              maxLength={300}
              value={promptValue}
              placeholder={promptModal.placeholder}
              onChange={(e) => setPromptValue(e.target.value)}
              style={{ width: '100%', resize: 'vertical', marginBottom: '14px' }}
            />
            <div className="confirm-actions">
              <button className="btn btn-outline" onClick={promptModal.onCancel}>Cancelar</button>
              <button
                className="btn btn-danger"
                disabled={promptValue.trim().length < 3}
                onClick={() => promptModal.onSubmit(promptValue.trim())}
              >
                Confirmar cancelación
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE HEADER BAR */}
      <div className="mobile-header-bar">
        <button
          className="menu-toggle-btn"
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          aria-label={isSidebarOpen ? 'Cerrar menú de navegación' : 'Abrir menú de navegación'}
          aria-expanded={isSidebarOpen}
        >
          {isSidebarOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
        <a href="https://sales-arena.netlify.app/" target="_blank" rel="noopener noreferrer" title="Ir a la web principal de Sales Arena" className="brand-logo-interactive" style={{ margin: 0 }}>
          <div className="brand-logo-container horse-glow-pulse">
            <ChessKnightIcon size={34} />
          </div>
          <div className="brand-title-stacked">
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span className="brand-title-sales">Sales Arena</span>
              <span className="portal-badge-mini">PORTAL ↗</span>
            </div>
            <span className="brand-title-arena">Matcher</span>
          </div>
        </a>
        <div style={{ width: '34px' }}></div> {/* Spacer to center the logo */}
      </div>

      {/* MOBILE DRAWER OVERLAY */}
      <div className={`sidebar-overlay ${isSidebarOpen ? 'open' : ''}`} onClick={() => setIsSidebarOpen(false)}></div>

      {/* Reserva el ancho de la barra de íconos mientras el panel está
          contraído, para que desplegarlo con el mouse superponga el contenido
          en vez de empujarlo (el salto de layout en cada pasada del cursor era
          peor que el propio panel angosto). Solo existe en escritorio. */}
      <div className="nav-rail-spacer" aria-hidden="true"></div>

      {/* 1. SIDEBAR NAVIGATION */}
      <nav className={`nav-sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div className="nav-sidebar-head">
          <a
            href="https://sales-arena.netlify.app/"
            target="_blank"
            rel="noopener noreferrer"
            title="Haz clic para visitar el Portal Oficial de Sales Arena"
            className="brand-logo-interactive"
          >
            <div className="brand-logo-container horse-glow-pulse">
              <ChessKnightIcon size={34} />
            </div>
            <div className="brand-title-stacked nav-collapsible">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="brand-title-sales">Sales Arena</span>
                <span className="portal-badge-mini">PORTAL ↗</span>
              </div>
              <span className="brand-title-arena">Matcher</span>
            </div>
          </a>
        </div>

        {/* Los íconos nombran lo que hace cada vista, no una categoría vaga:
            reloj+calendario para cargar horarios, nodos conectados para la
            afinidad entre duplas y un grupo para el equipo (antes "Afinidad" y
            "Equipo" compartían la misma silueta de personas y se confundían). */}
        <div className="nav-links" role="navigation" aria-label="Navegación principal">
          <button type="button" title="Panel de Control" className={`nav-link ${activeTab === 'dashboard' ? 'active' : ''}`} aria-current={activeTab === 'dashboard' ? 'page' : undefined} onClick={() => handleTabClick('dashboard')}>
            <LayoutDashboard size={17} aria-hidden="true" /> <span className="nav-link-label">Panel de Control</span>
          </button>
          <button type="button" title="Cargar Disponibilidad" className={`nav-link ${activeTab === 'wizard' ? 'active' : ''}`} aria-current={activeTab === 'wizard' ? 'page' : undefined} onClick={() => { handleTabClick('wizard'); setWizardStep(1); }}>
            <CalendarClock size={17} aria-hidden="true" /> <span className="nav-link-label">Cargar Disponibilidad</span>
          </button>
          <button type="button" title="Mapa de Calor" className={`nav-link ${activeTab === 'heatmap' ? 'active' : ''}`} aria-current={activeTab === 'heatmap' ? 'page' : undefined} onClick={() => handleTabClick('heatmap')}>
            <Flame size={17} aria-hidden="true" /> <span className="nav-link-label">Mapa de Calor</span>
          </button>
          <button type="button" title="Afinidad Horaria" className={`nav-link ${activeTab === 'affinity' ? 'active' : ''}`} aria-current={activeTab === 'affinity' ? 'page' : undefined} onClick={() => handleTabClick('affinity')}>
            <Network size={17} aria-hidden="true" /> <span className="nav-link-label">Afinidad Horaria</span>
          </button>
          <button type="button" title="Gestionar Equipo" className={`nav-link ${activeTab === 'members' ? 'active' : ''}`} aria-current={activeTab === 'members' ? 'page' : undefined} onClick={() => handleTabClick('members')}>
            <UsersRound size={17} aria-hidden="true" /> <span className="nav-link-label">Gestionar Equipo</span>
          </button>
          <button type="button" title="Reportes y Análisis" className={`nav-link ${activeTab === 'reportes' ? 'active' : ''}`} aria-current={activeTab === 'reportes' ? 'page' : undefined} onClick={() => handleTabClick('reportes')}>
            <BarChart3 size={17} aria-hidden="true" /> <span className="nav-link-label">Reportes y Análisis</span>
          </button>

          {/* Al pie de la lista y con etiqueta propia, no como ícono suelto en
              la cabecera: ahí competía por ancho con la marca y partía "Sales
              Arena" en dos líneas, además de quedar sin nombre visible. */}
          <button
            type="button"
            className="nav-link nav-collapse-btn"
            onClick={() => setIsSidebarCollapsed(v => !v)}
            title={isSidebarCollapsed ? 'Fijar el menú abierto' : 'Contraer el menú a íconos'}
            aria-pressed={isSidebarCollapsed}
          >
            {isSidebarCollapsed
              ? <PanelLeftOpen size={17} aria-hidden="true" />
              : <PanelLeftClose size={17} aria-hidden="true" />}
            <span className="nav-link-label">{isSidebarCollapsed ? 'Fijar menú' : 'Contraer menú'}</span>
          </button>
        </div>

        {/* THEME SELECTOR WIDGET */}
        <div className="theme-selector" role="group" aria-label="Selector de tema">
          <button className={`theme-btn ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')} title="Modo Claro" aria-pressed={theme === 'light'}>
            <Sun size={12} aria-hidden="true" /> Claro
          </button>
          <button className={`theme-btn ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')} title="Modo Oscuro" aria-pressed={theme === 'dark'}>
            <Moon size={12} aria-hidden="true" /> Oscuro
          </button>
          <button className={`theme-btn ${theme === 'system' ? 'active' : ''}`} onClick={() => setTheme('system')} title="Seguir Sistema" aria-pressed={theme === 'system'}>
            <Monitor size={12} aria-hidden="true" /> Auto
          </button>
        </div>

        <div className="profile-card">
          <div className="profile-card-top">
            <div className="profile-avatar" style={{ backgroundColor: getAvatarColor(currentUser.name) }}>
              {getInitials(currentUser.name)}
              <span className={`profile-status-dot ${currentUser.active ? 'on' : 'off'}`} title={currentUser.active ? 'Participando esta semana' : 'Inactivo esta semana'}></span>
            </div>
            <div className="profile-card-info">
              <div className="profile-card-name">
                {currentUser.name}
                <span className="profile-flag" title={currentUser.country}>{getCountryFlag(currentUser.country)}</span>
              </div>
              <div className="profile-card-email">{currentUser.email}</div>
              <div className="profile-card-tz">
                <Globe size={10} /> {tzCity(currentUser.tz)}
              </div>
            </div>
          </div>
          <div className="profile-card-actions">
            <button type="button" className="profile-action-btn" onClick={openOnboarding} title="Ver la guía de uso">
              <HelpCircle size={13} /> Guía
            </button>
            <button type="button" className="profile-action-btn danger" onClick={handleLogout} title="Cerrar sesión">
              <LogOut size={13} /> Salir
            </button>
          </div>
        </div>
      </nav>

      {/* 2. MAIN APP CONTENT */}
      <main className="main-view">
        
        {/* HEADER BAR */}
        <header className="view-header">
          <div>
            <h2 className="view-title">
              {activeTab === 'dashboard' && 'Panel de Control Principal'}
              {activeTab === 'wizard' && 'Cargar Disponibilidad'}
              {activeTab === 'heatmap' && 'Mapa de Calor Semanal'}
              {activeTab === 'affinity' && 'Afinidad Horaria y Matrices'}
              {activeTab === 'members' && 'Gestionar Equipo'}
              {activeTab === 'reportes' && 'Reportes y Análisis'}
            </h2>
            <p className="view-subtitle">
              {activeTab === 'dashboard' && 'Revisa el estado de la sala, coincidencias activas y links de Meet.'}
              {activeTab === 'wizard' && 'Configura tu participación en los role-plays de esta semana en pocos clics.'}
              {activeTab === 'heatmap' && 'Visualiza de forma horaria colectiva en qué momento hay más personas disponibles.'}
              {activeTab === 'affinity' && '% de coincidencia relativa entre parejas de role-players.'}
              {activeTab === 'members' && 'Administra quiénes participan del grupo y configura sus correos y países.'}
              {activeTab === 'reportes' && 'Métricas de asistencia y coordinación de la sala, en base a lo que cada participante reporta después de cada sesión.'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              onClick={() => setIsRoomModalOpen(true)}
              className="glass room-chip"
              title="Gestionar salas"
            >
              <span className="room-indicator-dot" aria-hidden="true"></span>
              <span>Sala Activa: <strong>{roomName}</strong></span>
              <Settings size={13} style={{ opacity: 0.75 }} aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* CONTAINER CONTENT */}
        <div className="view-content" id="main-content" tabIndex={-1}>

          {/* VIEW: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div>
              {/* Tarjeta para compartir sala rápidamente */}
              <div className="glass share-room-banner" style={{ padding: '16px 20px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, rgba(10,132,255,0.15), rgba(94,92,230,0.15))',
                    border: '1px solid rgba(10,132,255,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--color-primary)'
                  }}>
                    <Share2 size={20} />
                  </div>
                  <div>
                    <div style={{ fontWeight: '700', fontSize: '14px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      Invitar a la Sala: <span className="room-badge-pill">{roomName}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>
                      Comparte este enlace con tu equipo. Al ingresar los llevará directamente al registro inicial de esta sala.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-indigo"
                  onClick={handleCopyRoomInvite}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', fontWeight: '600' }}
                >
                  <Share2 size={15} />
                  Copiar Link de Invitación
                </button>
              </div>

              {/* Aviso de bloqueo por faltas del mes (3+) */}
              {currentUser && isBlocked(currentUser.email) && (
                <div className="glass" style={{ padding: '14px 18px', marginBottom: '16px', border: '1px solid var(--color-danger)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Lock size={18} style={{ color: 'var(--color-danger)', flexShrink: 0 }} />
                  <div style={{ fontSize: '13px', color: 'var(--text-main)' }}>
                    <strong>Estás sin emparejamientos este mes.</strong> Acumulaste {getMonthlyFaltas(currentUser.email)} faltas (no presentarte o cancelar sobre la hora). Volverás a entrar en la rotación el 1ero del mes que viene.
                    {getChronicBlockedMonths(currentUser.email) >= CHRONIC_BLOCK_THRESHOLD - 1 && (
                      <> Ya sucedió en {getChronicBlockedMonths(currentUser.email)} meses distintos: si vuelve a pasar, esta cuenta de Google perderá el acceso a la sala.</>
                    )}
                  </div>
                </div>
              )}

              {/* Tarjeta de Estado Semanal de Tomás */}
              <div className="glass" style={{ padding: '16px 20px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: currentUser.active ? 'var(--color-accent)' : 'var(--color-danger)',
                    boxShadow: currentUser.active ? '0 0 10px var(--color-accent)' : '0 0 10px var(--color-danger)'
                  }}></div>
                  <div>
                    <div style={{ fontWeight: '700', fontSize: '13.5px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      Mi Participación Semanal:
                      <span className={currentUser.active ? 'member-badge-active' : 'member-badge-inactive'}>
                        {currentUser.active ? 'ACTIVO' : 'INACTIVO'}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2.5px' }}>
                      {currentUser.active
                        ? 'Estás participando de los emparejamientos semanales. Tus compañeros pueden coincidir contigo.'
                        : 'Estás excluido de esta semana. Tus horarios no serán cruzados con los del equipo.'}
                    </div>
                  </div>
                </div>
                <button
                  className={`btn ${currentUser.active ? 'btn-outline' : 'btn-indigo'}`}
                  style={{ fontSize: '12px', padding: '6px 14px' }}
                  onClick={toggleCurrentUserActive}
                >
                  {currentUser.active ? 'Desactivar participación' : 'Activar participación'}
                </button>
              </div>

              {/* PROMPTS DE ASISTENCIA PENDIENTES */}
              {pendingReports.length > 0 && (
                <div className="attendance-prompts">
                  {pendingReports.map(({ meeting, attendance }) => (
                    <div className="attendance-prompt-card glass" key={attendance.id}>
                      <div className="attendance-prompt-info">
                        <div className="attendance-prompt-avatar" style={{ backgroundColor: getAvatarColor(attendance.memberName) }}>
                          {getInitials(attendance.memberName)}
                        </div>
                        <div>
                          <div className="attendance-prompt-question">
                            ¿Se conectó <strong>{attendance.memberName}</strong> y llegó a tiempo? <span style={{ fontWeight: 400, opacity: 0.7 }}>(tolerancia 10 min)</span>
                          </div>
                          <div className="attendance-prompt-meta">
                            {meeting.title} · {meeting.dateUtc}
                          </div>
                        </div>
                      </div>
                      <div className="attendance-prompt-actions">
                        <button
                          type="button"
                          className="attendance-btn attendance-btn-yes"
                          onClick={() => reportAttendance(attendance, 'a_tiempo')}
                        >
                          <Check size={14} /> Sí, a tiempo
                        </button>
                        <button
                          type="button"
                          className="attendance-btn attendance-btn-late"
                          onClick={() => reportAttendance(attendance, 'tarde')}
                        >
                          <Clock size={14} /> Llegó tarde
                        </button>
                        <button
                          type="button"
                          className="attendance-btn attendance-btn-no"
                          onClick={() => reportAttendance(attendance, 'no_show')}
                        >
                          <X size={14} /> No se presentó
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* KPIs */}
              <div className="metrics-grid">
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(0,113,227,0.08)', color: 'var(--color-primary)' }}>
                    <Users size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{activeMembersCount}</span>
                    <span className="kpi-label">{activeMembersCount === 1 ? 'Miembro Activo' : 'Miembros Activos'}</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(120,120,120,0.08)', color: 'var(--text-muted)' }}>
                    <Clock size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{availabilities.length}</span>
                    <span className="kpi-label">{availabilities.length === 1 ? 'Bloque Semanal' : 'Bloques Semanales'}</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(52,199,89,0.12)', color: '#34c759' }}>
                    <Sparkles size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{myLiveProposals.length}</span>
                    <span className="kpi-label">{myLiveProposals.length === 1 ? 'Mi Propuesta Activa' : 'Mis Propuestas Activas'}</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(255,149,0,0.12)', color: '#ff9500' }}>
                    <Video size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{upcomingMeetings.length}</span>
                    <span className="kpi-label">{upcomingMeetings.length === 1 ? 'Meet Próximo' : 'Meets Próximos'}</span>
                  </div>
                </div>
              </div>

              {/* 2-Columns */}
              <div className="dashboard-sections">
                
                {/* Left Col: Mi propuesta 1:1 de la semana (privada) */}
                <div className="section-card glass">
                  <h4 className="section-title">
                    <Sparkles size={15} className="section-title-icon" />
                    Mi Role-Play de la Semana
                  </h4>
                  {isRoomDataLoading ? (
                    <div className="match-card-skeleton" role="status" aria-live="polite" aria-busy="true" aria-label="Cargando tu propuesta de la semana">
                      <div className="skeleton" style={{ width: '40px', height: '40px', borderRadius: '50%' }}></div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div className="skeleton" style={{ width: '55%', height: '14px' }}></div>
                        <div className="skeleton" style={{ width: '80%', height: '11px' }}></div>
                        <span className="dashboard-status-loading-text">Cargando tu propuesta semanal…</span>
                      </div>
                    </div>
                  ) : myLiveProposals.length === 0 ? (
                    (() => {
                      const hasAvailability = availabilities.some(a => ruleBelongsTo(a, currentUser));
                      const emptyState = !currentUser.active
                        ? {
                            title: 'Tu participación está inactiva.',
                            description: 'Activá tu participación para volver a entrar en los emparejamientos semanales.'
                          }
                        : !hasAvailability
                          ? {
                              title: 'Todavía no cargaste disponibilidad.',
                              description: 'Cargá al menos un horario disponible para que el matcher pueda buscar una coincidencia.'
                            }
                          : myLastClosedProposal
                            ? {
                                title: 'Buscando una nueva coincidencia.',
                                description: 'Tu propuesta anterior se cerró; no necesitás hacer nada mientras el matcher busca otra opción.'
                              }
                            : {
                                title: 'Todavía no tenés una propuesta.',
                                description: 'Cargá tu disponibilidad y mantené activa tu participación. El matcher buscará una coincidencia.'
                              };
                      return (
                        <div className="empty-state">
                          <AlertCircle size={30} />
                          <span className="empty-state-title">{emptyState.title}</span>
                          <span className="empty-state-desc">{emptyState.description}</span>
                        </div>
                      );
                    })()
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {myLiveProposals.map((proposal) => {
                    const meIsA = proposal.aEmail.toLowerCase() === myEmailLower;
                    const partnerName = meIsA ? proposal.bName : proposal.aName;
                    const partnerEmail = meIsA ? proposal.bEmail : proposal.aEmail;
                    const partnerMember = members.find(m => m.email.toLowerCase() === partnerEmail.toLowerCase());
                    const mySide = meIsA ? proposal.statusA : proposal.statusB;
                    const otherSide = meIsA ? proposal.statusB : proposal.statusA;
                    const linkedMeeting = meetings.find(mm => mm.id === proposal.meetingId);
                    const isConfirmed = proposal.status === 'confirmado';
                    const statusPresentation = isConfirmed && linkedMeeting
                      ? {
                          variant: 'meeting-ready',
                          label: 'Reunión agendada',
                          nextStep: 'Abrí el Meet cuando llegue el horario.'
                        }
                      : isConfirmed
                        ? {
                            variant: 'confirmed',
                            label: 'Dupla confirmada',
                            nextStep: 'Creá el evento de Calendar y el enlace de Meet.'
                          }
                        : mySide === 'pendiente'
                          ? {
                              variant: 'action-required',
                              label: 'Requiere tu respuesta',
                              nextStep: 'Confirmá si podés asistir.'
                            }
                          : {
                              variant: 'waiting',
                              label: 'Esperando confirmación',
                              nextStep: otherSide === 'pendiente'
                                ? 'No necesitás hacer nada. Te avisaremos cuando la otra persona responda.'
                                : 'No necesitás hacer nada mientras se actualiza la propuesta.'
                            };

                    // Próxima ocurrencia del turno tal como la muestra la
                    // etiqueta de horario (slotToLocalLabel usa el día/hora del
                    // slot sin semana → la ocurrencia MÁS PRÓXIMA, sin piso).
                    // El plazo de confirmación jamás puede quedar DESPUÉS de esa
                    // sesión: se acota al menor de ambos para evitar mostrar
                    // "Respondé en 3 h" cuando la sesión visible es en 1 h.
                    const sessionStartMs = getNextMatchDateUtc({ startSlot: proposal.slot }).getTime();
                    const rawDeadlineMs = proposal.respondBy ? new Date(proposal.respondBy).getTime() : sessionStartMs;
                    const effectiveDeadline = new Date(Math.min(rawDeadlineMs, sessionStartMs)).toISOString();

                    return (
                      <div key={proposal.id} className={`match-card glass ${isConfirmed ? 'match-card-mine' : ''}`}>
                        <div className="match-card-header">
                          <div className="match-card-identity" style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                            <span className="participant-avatar-mini match-avatar-lg" style={{ backgroundColor: getAvatarColor(partnerName) }}>
                              {getInitials(partnerName)}
                            </span>
                            <div style={{ minWidth: 0 }}>
                              <div className="match-card-partner-name" style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-main)' }}>
                                {partnerName}
                              </div>
                              <div className="match-card-subline">
                                {partnerMember && <span>{getCountryFlag(partnerMember.country)} {partnerMember.country}</span>}
                                <ReliabilityBadge pct={getReliability(partnerEmail)} />
                              </div>
                            </div>
                          </div>
                          <span className={`dashboard-proposal-status dashboard-proposal-status--${statusPresentation.variant}`} role="status">
                            <span className="status-dot" aria-hidden="true"></span>
                            {statusPresentation.label}
                          </span>
                        </div>

                        <div className="match-card-body">
                          <div className="match-section-label"><Clock size={11} /> Horario de la sesión (hora local de cada uno)</div>
                          <div className="match-time-compare">
                            <div className="match-time-side">
                              <span className="match-time-side-label">Tú</span>
                              <span className="match-time-side-value">{slotToLocalDateLabel(proposal.slot, currentUser.tz)}</span>
                            </div>
                            <div className="match-time-divider" aria-hidden="true">
                              <Clock size={12} />
                            </div>
                            {partnerMember && (
                              <div className="match-time-side match-time-side-right">
                                <span className="match-time-side-label">{partnerName.split(' ')[0]}</span>
                                <span className="match-time-side-value">{slotToLocalDateLabel(proposal.slot, partnerMember.tz)}</span>
                              </div>
                            )}
                          </div>
                          {!isConfirmed && (
                            <div className="match-deadline-chip" title={`Vence el ${new Date(effectiveDeadline).toLocaleString()}`}>
                              <AlertCircle size={12} />
                              Respondé {formatRespondByRelative(effectiveDeadline)} o el cupo se reasigna
                            </div>
                          )}
                          <div className={`dashboard-next-step dashboard-next-step--${statusPresentation.variant}`}>
                            <span className="dashboard-next-step-label">Tu siguiente paso</span>
                            <span className="dashboard-next-step-text">{statusPresentation.nextStep}</span>
                          </div>
                        </div>

                        <div className="match-card-footer">
                          {isConfirmed ? (
                            linkedMeeting ? (
                              <a href={linkedMeeting.meetLink} target="_blank" rel="noopener noreferrer" className="btn btn-indigo" style={{ width: '100%', textDecoration: 'none', boxSizing: 'border-box' }} onClick={() => markJoined(linkedMeeting)}>
                                <Video size={14} /> Abrir Google Meet
                              </a>
                            ) : (
                              <button className="btn btn-indigo" style={{ width: '100%' }} onClick={() => createProposalMeeting(proposal)}>
                                <Video size={14} /> Crear Meet de la dupla
                              </button>
                            )
                          ) : mySide === 'pendiente' ? (
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button className="attendance-btn attendance-btn-yes" style={{ flex: 1, justifyContent: 'center' }} onClick={() => respondToProposal(proposal, true)}>
                                <Check size={14} /> Aceptar
                              </button>
                              <button className="attendance-btn attendance-btn-no" style={{ flex: 1, justifyContent: 'center' }} onClick={() => respondToProposal(proposal, false)}>
                                <X size={14} /> Rechazar
                              </button>
                            </div>
                          ) : (
                            <div className="proposal-waiting">
                              <Check size={14} aria-hidden="true" />
                              Tu respuesta quedó registrada.
                            </div>
                          )}
                        </div>
                      </div>
                    );
                      })}
                    </div>
                  )}
                </div>

                {/* Right Col: agenda de TODA la sala (no solo la propia). El
                    título nombra el alcance —de quién son— porque es lo que lo
                    distingue del panel de la izquierda, que es la propuesta
                    privada de quien mira. */}
                <div className="section-card glass">
                  <h4 className="section-title">
                    <CalendarCheck size={15} className="section-title-icon" />
                    Agenda de la Sala
                  </h4>
                  <p className="section-subtitle">
                    Todos los role-plays confirmados de la sala. Si querés mirar o sumarte como observador al de otros compañeros, podés unirte desde acá. Ingresá con el micrófono apagado para no interrumpir la práctica.
                  </p>
                  <div className="meetings-list">
                    {isRoomDataLoading ? (
                      <div role="status" aria-live="polite" aria-busy="true" aria-label="Cargando reuniones agendadas" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div className="skeleton" style={{ height: '48px', borderRadius: '12px' }}></div>
                        <div className="skeleton" style={{ height: '48px', borderRadius: '12px' }}></div>
                        <span className="dashboard-status-loading-text">Cargando próximas reuniones…</span>
                      </div>
                    ) : upcomingMeetings.length === 0 ? (
                      <div className="empty-state">
                        <CalendarDays size={30} />
                        <span className="empty-state-title">Nadie de la sala tiene role-plays agendados.</span>
                        <span className="empty-state-desc">Cuando una propuesta sea aceptada por ambas personas —la tuya o la de cualquier compañero— el enlace aparecerá acá.</span>
                      </div>
                    ) : (
                      upcomingMeetings
                        .map((meet, idx) => {
                          const meetRows = attendances.filter(a => a.meetingId === meet.id);
                          const myRow = currentUser && meetRows.find(a => a.memberEmail.toLowerCase() === currentUser.email.toLowerCase());
                          const canCancel = myRow && myRow.status === 'confirmado' && !meetingHasStarted(meet);
                          const isLive = meetingHasStarted(meet) && !meetingHasEnded(meet);

                          return (
                            <div className="meeting-item" key={meet.id ?? idx} style={{ flexWrap: 'wrap' }}>
                              <div className="meeting-info">
                                <span className="meeting-title" style={{ fontSize: '13px' }}>{meet.title}</span>
                                <span className="meeting-meta" style={{ fontSize: '12px' }}>{meet.dateUtc}</span>
                                <span className="meeting-meta" style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <Users size={10} /> {meet.participants}
                                </span>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                  {isLive && (
                                    <span className="meeting-live-badge" role="status">
                                      <span className="meeting-live-dot" aria-hidden="true"></span>
                                      En vivo ahora
                                    </span>
                                  )}
                                  {/* La agenda lista toda la sala, así que la sesión
                                      propia también aparece acá además de en "Mi
                                      Role-Play". Se marca para que no se lea como
                                      una reunión duplicada. */}
                                  {myRow && (
                                    <span className="meeting-mine-badge" title="Sos participante de este role-play: también lo ves en «Mi Role-Play de la Semana»">
                                      <UserCheck size={10} /> Tuyo
                                    </span>
                                  )}
                                  <span className="meeting-open-badge" title="Cualquier miembro de la sala puede sumarse a este Meet como observador, con el micrófono apagado">
                                    <Globe size={10} /> Abierto a la sala
                                  </span>
                                </div>
                                {isLive && (
                                  <span className="meeting-mic-note">
                                    <MicOff size={10} /> Si entrás como observador, hacelo con el micrófono apagado para no interrumpir
                                  </span>
                                )}
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                                <a
                                  href={meet.meetLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn btn-indigo"
                                  style={{ padding: '6px 10px', fontSize: '12px', textDecoration: 'none' }}
                                  aria-label={`Unirse al Meet de ${meet.participants} (${meet.dateUtc})`}
                                  onClick={() => markJoined(meet)}
                                >
                                  <Video size={12} /> Meet
                                </a>
                                {canCancel && (
                                  <button
                                    type="button"
                                    className="btn-cancel-notice"
                                    onClick={() => cancelMyAttendance(meet)}
                                    title="Cancela tu asistencia antes del inicio; no cuenta como ausencia"
                                  >
                                    Cancelar con aviso
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* VIEW: WIZARD */}
          {activeTab === 'wizard' && (
            <div className="wizard-card glass">

              {/* Los 3 pasos no tenían ninguna señal de cuántos faltan; quien
                  llegaba a la grilla de horarios (paso 3, el más largo) no
                  sabía si era el último paso o si venía algo más después. */}
              <div className="wizard-progress">
                <span className="wizard-progress-label">Paso {wizardStep} de 3</span>
                <div className="wizard-progress-track">
                  <div className="wizard-progress-fill" style={{ width: `${(wizardStep / 3) * 100}%` }}></div>
                </div>
              </div>

              {/* Wizard Status Alert */}
              {wizardStatus && (
                <div id="status" className={`status-${wizardStatus.type}`} style={{ display: 'block', marginBottom: '16px' }}>
                  {wizardStatus.type === 'loading' && <span className="spinner"></span>} {wizardStatus.msg}
                </div>
              )}

              {/* STEP 1: Bienvenida */}
              {wizardStep === 1 && (
                <div>
                  <div className="wizard-hero-icon">
                    <Target size={30} />
                  </div>
                  {/* "de nuevo" solo si ya tenía horarios cargados: a alguien
                      que acaba de registrarse le sonaba a error. */}
                  <h3 className="wizard-title">
                    {availabilities.some(a => ruleBelongsTo(a, currentUser))
                      ? `¡Hola de nuevo, ${currentUser.name}!`
                      : `¡Hola, ${currentUser.name}!`}
                  </h3>
                  <p className="wizard-desc">¿Vas a participar en las sesiones de role-plays programadas para esta semana?</p>

                  <div className="participation-choice">
                    <button className="choice-card choice-yes" onClick={() => handleWizardParticipation(true)}>
                      <span className="choice-icon">
                        <Check size={24} strokeWidth={3} />
                      </span>
                      <span className="choice-text">
                        <span className="choice-title">Sí, participaré</span>
                        <span className="choice-sub">Coincidiré con mi equipo esta semana</span>
                      </span>
                    </button>
                    <button className="choice-card choice-no" onClick={() => handleWizardParticipation(false)}>
                      <span className="choice-icon">
                        <X size={24} strokeWidth={3} />
                      </span>
                      <span className="choice-text">
                        <span className="choice-title">No puedo esta semana</span>
                        <span className="choice-sub">Me excluyo de los emparejamientos</span>
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: Usar Plantilla vs Carga manual */}
              {wizardStep === 2 && (
                <div>
                  <div className="wizard-hero-icon">
                    <CalendarRange size={30} />
                  </div>
                  <h3 className="wizard-title">Carga de Disponibilidad</h3>
                  <p className="wizard-desc">Elige si deseas restablecer tu disponibilidad desde tu plantilla base cargada o configurarlo a mano:</p>

                  <div className="wizard-options">
                    <button className="wizard-btn wizard-btn-primary" onClick={handleUseTemplate}>
                      <CalendarCheck size={16} /> Usar mi horario base habitual (Plantilla)
                    </button>
                    <button className="wizard-btn wizard-btn-outline" onClick={() => setWizardStep(3)}>
                      <Pencil size={15} /> Cargar/Editar horarios específicos para esta semana
                    </button>
                    <button className="wizard-btn wizard-btn-outline" onClick={() => setWizardStep(1)}>
                      <ChevronLeft size={15} /> Atrás
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: Grid Semanal (estilo Cal.com) */}
              {wizardStep === 3 && (
                <div className="editor-grid-container">
                  <h3 className="wizard-title">Marca tu Disponibilidad</h3>
                  <p className="wizard-desc" style={{ fontSize: '12px', margin: 0 }}>
                    Haz clic o arrastra sobre el calendario para marcar los horarios en los que podés hacer un role-play.
                  </p>

                  <div className="editor-toolbar">
                    <span className="tz-chip" title="Tus horarios se guardan en esta zona horaria">
                      <Globe size={12} /> {tzCity(currentUser?.tz)}
                    </span>
                    <span className="hours-counter">
                      <Clock size={12} /> {wizardGrid.length} {wizardGrid.length === 1 ? 'hora seleccionada' : 'horas seleccionadas'}
                    </span>
                  </div>

                  <div className="preset-bar">
                    <button type="button" className="preset-btn" onClick={() => applyPreset('work')} title="Lunes a Viernes, 9:00 a 18:00">
                      <Briefcase size={12} /> Laboral 9–18
                    </button>
                    <button type="button" className="preset-btn" onClick={() => applyPreset('mornings')} title="Todos los días, 8:00 a 12:00">
                      <Sunrise size={12} /> Mañanas
                    </button>
                    <button type="button" className="preset-btn" onClick={() => applyPreset('evenings')} title="Todos los días, 18:00 a 22:00">
                      <Sunset size={12} /> Noches
                    </button>
                    <button type="button" className="preset-btn preset-btn-clear" onClick={clearAllCells} title="Borrar toda la selección">
                      <Eraser size={12} /> Limpiar
                    </button>
                  </div>

                  <div className="editor-grid-scroll" onMouseLeave={() => setIsMouseDown(false)}>
                    <table className="editor-table">
                      <thead>
                        <tr>
                          <th className="editor-th editor-th-hour">Hora</th>
                          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d, i) => (
                            <th key={d} className={`editor-th ${i >= 5 ? 'weekend' : ''}`}>{d}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: 24 }).map((_, h) => {
                          if (!showAllHours && (h < 6)) return null;
                          return (
                            <tr key={h}>
                              <td className="editor-hour-label">{String(h).padStart(2, '0')}:00</td>
                              {Array.from({ length: 7 }).map((_, d) => {
                                const isActive = wizardGrid.some(s => s.dayIdx === d && s.hour === h);
                                const dayLabel = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][d];
                                return (
                                  <td
                                    key={d}
                                    className={`editor-cell ${isActive ? 'active' : ''}`}
                                    role="button"
                                    tabIndex={0}
                                    aria-pressed={isActive}
                                    aria-label={`${dayLabel} ${String(h).padStart(2, '0')}:00${isActive ? ', seleccionado' : ''}`}
                                    onMouseDown={() => handleCellMouseDown(d, h)}
                                    onMouseEnter={() => handleCellMouseEnter(d, h)}
                                    onMouseUp={() => setIsMouseDown(false)}
                                    onKeyDown={(e) => handleCellKeyDown(d, h, e)}
                                  ></td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <button type="button" className="show-hours-toggle" onClick={() => setShowAllHours(!showAllHours)}>
                    {showAllHours ? 'Ocultar madrugada (00:00–06:00)' : 'Mostrar madrugada (00:00–06:00)'}
                  </button>

                  <div className="checkbox-container" style={{ margin: '4px 0' }}>
                    <input
                      type="checkbox"
                      id="saveTemplate"
                      checked={saveAsTemplate}
                      onChange={(e) => setSaveAsTemplate(e.target.checked)}
                    />
                    <label htmlFor="saveTemplate" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Save size={13} /> Guardar como mi Plantilla Base habitual
                    </label>
                  </div>

                  <button className="wizard-btn wizard-btn-primary" onClick={saveWizardGrid}>
                    <Check size={16} /> Guardar Horarios
                  </button>
                  <button className="wizard-btn wizard-btn-outline" onClick={() => setWizardStep(2)}>
                    <ChevronLeft size={15} /> Atrás
                  </button>
                </div>
              )}

            </div>
          )}

          {/* VIEW: HEATMAP */}
          {activeTab === 'heatmap' && (() => {
            const totalActive = members.filter(m => m.active).length;
            // Escalones fijos (no una rampa continua): con muchos miembros la opacidad
            // lineal (count/total) vuelve casi indistinguibles conteos distintos.
            // Los escalones garantizan contraste perceptible sin importar el tamaño del equipo.
            const HEATMAP_LEVELS = [
              { max: 0,    bg: 'transparent',                 ink: 'var(--text-muted)', label: 'Nadie' },
              { max: 0.25, bg: 'rgba(52, 199, 89, 0.18)',      ink: 'var(--text-main)',  label: 'Hasta 25%' },
              { max: 0.5,  bg: 'rgba(52, 199, 89, 0.38)',      ink: 'var(--text-main)',  label: '26–50%' },
              // Niveles 3 y 4: el verde ya es lo bastante saturado en claro y oscuro
              // como para que el texto oscuro pierda contraste sobre fondo oscuro (bg-main).
              // Blanco funciona en ambos temas para estos dos escalones.
              { max: 0.75, bg: 'rgba(52, 199, 89, 0.62)',      ink: '#ffffff',           label: '51–75%' },
              { max: 1,    bg: 'rgba(52, 199, 89, 0.9)',       ink: '#ffffff',           label: 'Más de 75%' },
            ];
            const levelFor = (count) => {
              const ratio = totalActive ? count / totalActive : 0;
              if (ratio === 0) return HEATMAP_LEVELS[0];
              return HEATMAP_LEVELS.find(l => ratio <= l.max) || HEATMAP_LEVELS[HEATMAP_LEVELS.length - 1];
            };

            return (
              <div className="section-card glass" style={{ maxWidth: '100%' }}>
                <div className="heatmap-container">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Flame size={17} className="section-title-icon" /> Mapa de Calor Colectivo
                    </h3>
                    <span className="tz-chip">
                      <Globe size={12} /> Hora local de {currentUser?.name?.split(' ')[0] || ''} ({tzCity(currentUser?.tz)})
                    </span>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', margin: 0 }}>
                    Cada celda muestra cuántas personas están disponibles. Hacé click (o Enter con teclado) en un bloque para ver quiénes son.
                  </p>

                  {/* SCALE LEGEND: la única forma antes era el tooltip, ahora la escala es siempre visible */}
                  <div className="heatmap-legend" role="img" aria-label="Escala de disponibilidad: de nadie a más del 75% del equipo">
                    {HEATMAP_LEVELS.map(l => (
                      <div className="heatmap-legend-item" key={l.label}>
                        <span className="heatmap-legend-swatch" style={{ backgroundColor: l.bg === 'transparent' ? 'var(--bg-card-hover)' : l.bg }}></span>
                        <span className="heatmap-legend-text">{l.label}</span>
                      </div>
                    ))}
                  </div>

                  <div className="table-responsive-wrapper">
                    <table className="heatmap-table">
                      <thead>
                        <tr>
                          <th className="heatmap-th" style={{ width: '60px' }}>Hora</th>
                          {DIAS.map(d => (
                            <th className="heatmap-th" key={d}>{d.substring(0, 3)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: 24 }).map((_, h) => (
                          <tr key={h}>
                            <td className="heatmap-td-hour">{String(h).padStart(2, '0')}:00</td>
                            {Array.from({ length: 7 }).map((_, d) => {
                              const cellData = heatmap[d]?.[h] || { count: 0, names: '' };
                              const level = levelFor(cellData.count);
                              const isSelected = selectedHeatmapCell?.day === d && selectedHeatmapCell?.hour === h;

                              return (
                                <td key={d} className="heatmap-cell-wrap">
                                  <button
                                    type="button"
                                    className={`heatmap-cell-btn ${isSelected ? 'selected' : ''}`}
                                    style={{ backgroundColor: level.bg, color: level.ink }}
                                    onClick={() => setSelectedHeatmapCell({ day: d, hour: h, count: cellData.count, names: cellData.names })}
                                    aria-label={`${DIAS[d]} ${String(h).padStart(2, '0')}:00 — ${cellData.count === 0 ? 'nadie disponible' : `${cellData.count} ${cellData.count === 1 ? 'persona disponible' : 'personas disponibles'}`}`}
                                  >
                                    {cellData.count > 0 ? cellData.count : ''}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* DETALLE ACCESIBLE: reemplaza al tooltip como fuente de la lista de nombres.
                      Funciona con click, teclado (Enter/Espacio en el botón) y touch (tap). */}
                  <div className="heatmap-detail-panel" aria-live="polite">
                    {selectedHeatmapCell ? (
                      selectedHeatmapCell.count > 0 ? (
                        <>
                          <div className="heatmap-detail-title">
                            <Clock size={13} /> {DIAS[selectedHeatmapCell.day]} {String(selectedHeatmapCell.hour).padStart(2, '0')}:00 · {selectedHeatmapCell.count} {selectedHeatmapCell.count === 1 ? 'persona disponible' : 'personas disponibles'}
                          </div>
                          <div className="heatmap-detail-names">{selectedHeatmapCell.names}</div>
                        </>
                      ) : (
                        <div className="heatmap-detail-title heatmap-detail-empty">
                          <Clock size={13} /> {DIAS[selectedHeatmapCell.day]} {String(selectedHeatmapCell.hour).padStart(2, '0')}:00 · Nadie disponible en ese bloque
                        </div>
                      )
                    ) : (
                      <div className="heatmap-detail-placeholder">Elegí un bloque de la grilla para ver quiénes están disponibles.</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* VIEW: AFFINITY */}
          {activeTab === 'affinity' && (() => {
            const AFFINITY_LEVELS = [
              { label: 'Baja o sin coincidencia aún', min: 0, max: 39, bg: 'rgba(120, 120, 120, 0.1)', text: 'var(--text-muted)' },
              { label: 'Moderada (40-69%)', min: 40, max: 69, bg: 'rgba(255, 159, 10, 0.12)', text: 'var(--color-warning)' },
              { label: 'Alta (70-100%)', min: 70, max: 100, bg: 'rgba(52, 199, 89, 0.15)', text: '#34c759' }
            ];
            const levelForAffinity = (pct) => AFFINITY_LEVELS.find(l => pct >= l.min && pct <= l.max) || AFFINITY_LEVELS[0];

            return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div className="section-card glass">
                <h4 className="section-title">
                  <Handshake size={15} className="section-title-icon" />
                  Tu Solapamiento Horario con el Equipo
                </h4>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 10px 0' }}>
                  Porcentaje de solapamiento relativo entre tus horas disponibles y las de cada compañero. Solo ves tu propia fila: la disponibilidad detallada del resto del equipo es privada.
                </p>

                <div className="heatmap-legend" role="img" aria-label="Escala de afinidad horaria: de baja o sin coincidencia a alta">
                  {AFFINITY_LEVELS.map(l => (
                    <div className="heatmap-legend-item" key={l.label}>
                      <span className="heatmap-legend-swatch" style={{ backgroundColor: l.bg }}></span>
                      <span className="heatmap-legend-text">{l.label}</span>
                    </div>
                  ))}
                </div>
                <div className="table-responsive-wrapper">
                  <table className="affinity-table">
                    <thead>
                      <tr>
                        <th className="affinity-th" style={{ backgroundColor: 'var(--bg-card-hover)' }}>Jugador</th>
                        {members.filter(m => m.active).map(m => (
                          <th className="affinity-th" key={m.name}>{m.name.split(' ')[0]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {affinity.filter(row => row.name.toLowerCase() === currentUser.name.toLowerCase()).map((row, i) => (
                        <tr key={i}>
                          <td className="affinity-td-label">{row.name}</td>
                          {row.stats.map((col, j) => {
                            const pct = col.pct;
                            const level = pct !== null ? levelForAffinity(pct) : null;
                            return (
                              <td
                                key={j}
                                className="affinity-cell"
                                style={{ backgroundColor: level ? level.bg : 'transparent', color: level ? level.text : 'var(--text-muted)' }}
                              >
                                {pct !== null ? `${pct}%` : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Best Partners List */}
              <div className="section-card glass">
                <h4 className="section-title">
                  <Trophy size={15} className="section-title-icon" />
                  Tus Compañeros con Mayor Afinidad
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {affinity.filter(row => row.name.toLowerCase() === currentUser.name.toLowerCase()).map((row, i) => {
                    const sortedStats = [...row.stats]
                      .filter(s => s.pct !== null)
                      .sort((a, b) => b.pct - a.pct);
                    const topStats = sortedStats.filter(s => s.pct > 0).slice(0, 2);

                    if (sortedStats.length === 0) {
                      return (
                        <div className="empty-state" key={i}>
                          <Users size={30} />
                          <span className="empty-state-title">Todavía no hay compañeros activos</span>
                          <span className="empty-state-desc">Cuando se sumen más personas a la sala, vas a ver acá con quién más coincidís.</span>
                        </div>
                      );
                    }

                    if (topStats.length === 0) {
                      return (
                        <div className="empty-state" key={i}>
                          <AlertCircle size={30} />
                          <span className="empty-state-title">Aún sin coincidencias horarias</span>
                          <span className="empty-state-desc">Por ahora ningún compañero comparte horas libres con las tuyas. Cargá más franjas en "Cargar Disponibilidad" para aumentar tus chances.</span>
                        </div>
                      );
                    }

                    return (
                      <React.Fragment key={i}>
                        {topStats.map(s => {
                          const level = levelForAffinity(s.pct);
                          return (
                            <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', borderBottom: '1px solid var(--border-color)', fontSize: '13px', flexWrap: 'wrap', gap: '8px' }}>
                              <span style={{ fontWeight: '600', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="participant-avatar-mini" style={{ backgroundColor: getAvatarColor(s.name) }}>
                                  {getInitials(s.name)}
                                </span>
                                {s.name}
                              </span>
                              <span className="affinity-pct-badge" style={{ backgroundColor: level.bg, color: level.text }}>
                                {s.pct}%
                              </span>
                            </div>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            </div>
            );
          })()}

          {/* VIEW: MEMBERS */}
          {activeTab === 'members' && (
            <div className="dashboard-sections">
              
              {/* Left Col: List of Members */}
              <div className="section-card glass">
                <h4 className="section-title">
                  <Users size={15} className="section-title-icon" />
                  Miembros Registrados
                </h4>
                <div className="members-list-card">
                  {members.map((m, idx) => {
                    const isSelf = m.email.toLowerCase() === currentUser.email.toLowerCase();
                    return (
                    <div className={`member-row ${isSelf ? 'member-row-self' : ''}`} key={idx}>
                      <div className="member-row-avatar" style={{ backgroundColor: getAvatarColor(m.name) }}>
                        {getInitials(m.name)}
                      </div>
                      <div className="member-row-info">
                        <span className="member-row-name">
                          {m.name}
                          <span className="participant-flag" title={m.country}>{getCountryFlag(m.country)}</span>
                          {isSelf && <span className="member-badge-self">Tú</span>}
                          <span className={m.active ? 'member-badge-active' : 'member-badge-inactive'}>
                            {m.active ? 'Participa' : 'Excluido'}
                          </span>
                          <ReliabilityBadge pct={getReliability(m.email)} />
                        </span>
                        <span className="member-row-details"><Mail size={11} /> {m.email}</span>
                        <span className="member-row-details"><MapPin size={11} /> {m.country} · {tzCity(m.tz)}</span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        {isSelf ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Participa:</span>
                            <label className="switch-control" title="Activa o desactiva tu participación">
                              <input
                                type="checkbox"
                                checked={m.active}
                                onChange={toggleCurrentUserActive}
                                aria-label="Activa o desactiva tu participación esta semana"
                              />
                              <span className="switch-slider" aria-hidden="true"></span>
                            </label>
                          </div>
                        ) : (
                          <span className="member-lock-chip" title="Solo este miembro puede cambiar su propia participación">
                            <Lock size={11} /> Solo {m.name.split(' ')[0]}
                          </span>
                        )}
                        {/* El botón solo se muestra a quien administra: al resto
                            no le sirve de nada verlo, porque la acción se
                            rechaza igual. */}
                        {!isSelf && isAdmin && (
                          <button
                            type="button"
                            className="btn-danger-icon"
                            onClick={() => deleteMember(m.email)}
                            title="Eliminar de la sala"
                            aria-label={`Eliminar a ${m.name} de la sala`}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Col: Add Member Form */}
              <div className="section-card glass" style={{ height: 'fit-content' }}>
                <h4 className="section-title">
                  <UserPlus size={15} className="section-title-icon" />
                  Agregar Nuevo Role-Player
                </h4>
                <form className="add-member-form" onSubmit={handleAddMember}>
                  <div className="form-group">
                    <label htmlFor="mem-name" style={{ fontSize: '12px', fontWeight: '600' }}>Nombre Completo</label>
                    <input
                      type="text"
                      id="mem-name"
                      className="form-input"
                      value={newMemberName}
                      onChange={(e) => setNewMemberName(e.target.value)}
                      placeholder="Ej. Juan Pérez"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="mem-email" style={{ fontSize: '12px', fontWeight: '600' }}>Correo Electrónico (Gmail)</label>
                    <input
                      type="email"
                      id="mem-email"
                      className="form-input"
                      value={newMemberEmail}
                      onChange={(e) => setNewMemberEmail(e.target.value)}
                      placeholder="Ej. juan@gmail.com"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="mem-country" style={{ fontSize: '12px', fontWeight: '600' }}>País de Origen</label>
                    <select
                      id="mem-country"
                      className="form-select"
                      value={newMemberCountry}
                      onChange={(e) => setNewMemberCountry(e.target.value)}
                      style={{ marginBottom: newMemberCountry === 'Otro' ? '10px' : '0' }}
                    >
                      {ZONAS.map(z => (
                        <option key={z.country} value={z.country}>{z.country}</option>
                      ))}
                      <option value="Otro">Otro (Escribir país)...</option>
                    </select>
                    {newMemberCountry === 'Otro' && (
                      <input
                        type="text"
                        className="form-input"
                        /* El placeholder desaparece al tipear, así que no puede
                           ser el único nombre del campo: sin esto, un lector de
                           pantalla solo anuncia "cuadro de texto". */
                        aria-label="Escribí el país de origen"
                        value={customNewMemberCountry}
                        onChange={(e) => setCustomNewMemberCountry(e.target.value)}
                        placeholder="Escribe el país... Ej. Italia"
                        required
                        style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px' }}
                      />
                    )}
                  </div>

                  <button type="submit" className="btn btn-indigo" style={{ marginTop: '8px', width: '100%' }}>
                    <UserPlus size={16} /> Agregar a la Sala
                  </button>
                </form>
              </div>

            </div>
          )}

          {activeTab === 'reportes' && (
            <div>
              <div className="glass" style={{ padding: '14px 18px', marginBottom: '20px', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <BarChart3 size={18} style={{ color: 'var(--color-primary)', flexShrink: 0, marginTop: '1px' }} />
                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                  Estas métricas se calculan a partir de lo que cada participante reporta después de cada sesión (asistió, llegó tarde, no se presentó). La app no accede al contenido de las videollamadas: su función es coordinar los emparejamientos automáticamente, no analizarlos. Un mes puntual con problemas de conexión no te perjudica frente al resto de la sala: estos números son para tu propia referencia, no un ranking público.
                </div>
              </div>

              {/* KPIs personales */}
              <h4 className="section-title" style={{ marginBottom: '12px' }}>
                <Award size={15} className="section-title-icon" />
                Tu Actividad
              </h4>
              <div className="metrics-grid" style={{ marginBottom: '28px' }}>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(0,113,227,0.08)', color: 'var(--color-primary)' }}>
                    <ShieldCheck size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{getReliability(currentUser.email) !== null ? `${getReliability(currentUser.email)}%` : '—'}</span>
                    <span className="kpi-label">Tu Confiabilidad (60 días)</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(52,199,89,0.12)', color: '#34c759' }}>
                    <Handshake size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{mySessionsCompleted}</span>
                    <span className="kpi-label">Sesiones Completadas</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: getMonthlyFaltas(currentUser.email) > 0 ? 'rgba(255,59,48,0.1)' : 'rgba(120,120,120,0.08)', color: getMonthlyFaltas(currentUser.email) > 0 ? 'var(--color-danger)' : 'var(--text-muted)' }}>
                    <X size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{getMonthlyFaltas(currentUser.email)}</span>
                    <span className="kpi-label">Faltas Este Mes</span>
                  </div>
                </div>
              </div>

              {/* KPIs de la sala (agregados: no se nombra a nadie individualmente) */}
              <h4 className="section-title" style={{ marginBottom: '12px' }}>
                <TrendingUp size={15} className="section-title-icon" />
                Resumen de la Sala
              </h4>
              <div className="metrics-grid" style={{ marginBottom: '8px' }}>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(0,113,227,0.08)', color: 'var(--color-primary)' }}>
                    <Video size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{meetingsThisMonth.length}</span>
                    <span className="kpi-label">Sesiones Este Mes</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(52,199,89,0.12)', color: '#34c759' }}>
                    <ShieldCheck size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{roomReliability !== null ? `${roomReliability}%` : '—'}</span>
                    <span className="kpi-label">Confiabilidad de la Sala</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(120,120,120,0.08)', color: 'var(--text-muted)' }}>
                    <Users size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{members.length}</span>
                    <span className="kpi-label">Role-Players en la Sala</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: blockedMembersCount > 0 ? 'rgba(255,149,0,0.12)' : 'rgba(120,120,120,0.08)', color: blockedMembersCount > 0 ? '#ff9500' : 'var(--text-muted)' }}>
                    <Clock size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{blockedMembersCount}</span>
                    <span className="kpi-label">Sin Emparejamiento Este Mes</span>
                  </div>
                </div>
              </div>
              <p className="section-subtitle" style={{ margin: '0 0 24px' }}>
                "Sin emparejamiento este mes" cuenta a quienes acumularon 3+ ausencias o cancelaciones tardías en el mes en curso: vuelven a la rotación automáticamente el mes que viene. Solo si ese patrón se repite en {CHRONIC_BLOCK_THRESHOLD} meses distintos, la cuenta pierde el acceso a esta sala.
              </p>

            </div>
          )}

        </div>

      </main>

      {/* GOOGLE MEET CREATOR OVERLAY MODAL */}
      {schedulingStatus && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(9, 9, 11, 0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 500,
          animation: 'fadeIn 0.2s ease'
        }}>
          <div className="glass" style={{
            width: '400px',
            padding: '30px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            border: '1px solid var(--border-color)',
            boxSizing: 'border-box'
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
              {schedulingStatus === 'success' ? (
                <div style={{
                  width: '52px', height: '52px', borderRadius: '50%',
                  backgroundColor: 'rgba(48, 209, 88, 0.12)', color: '#30d158',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px'
                }}>
                  <Check size={28} />
                </div>
              ) : (
                <span className="spinner" style={{ width: '32px', height: '32px', color: 'var(--color-primary)' }}></span>
              )}
            </div>

            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: 'var(--text-main)' }}>
              {schedulingStatus === 'loading' && 'Conectando con Google Calendar API...'}
              {schedulingStatus === 'authenticating' && 'Autenticando Usuario (OAuth 2.0)...'}
              {schedulingStatus === 'creating' && 'Generando sala de Google Meet...'}
              {schedulingStatus === 'success' && '¡Reunión Agendada con Éxito!'}
            </h3>

            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
              {schedulingStatus === 'loading' && 'Estableciendo comunicación segura con los servicios de Google Cloud.'}
              {schedulingStatus === 'authenticating' && 'Verificando permisos y tokens del organizador de la sala.'}
              {schedulingStatus === 'creating' && `Creando el evento y agregando a los ${scheduledDetails?.attendeesCount} participantes correspondientes.`}
              {schedulingStatus === 'success' && '📧 Google Calendar ha enviado invitaciones de correo oficiales a todos los participantes con el enlace de Google Meet para unirse.'}
            </p>
          </div>
        </div>
      )}
      {/* MODAL DE GESTIÓN DE SALAS (ROOM MANAGER) */}
      {isRoomModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="room-modal-title"
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}>
          <div
            className="glass"
            ref={roomModalRef}
            tabIndex={-1}
            style={{
              width: '100%',
              maxWidth: '480px',
              backgroundColor: 'var(--color-bg-sidebar)',
              borderRadius: '16px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
              border: '1px solid var(--border-color)',
              boxSizing: 'border-box',
              position: 'relative'
            }}>
            {/* Header del Modal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 id="room-modal-title" style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings size={17} className="section-title-icon" /> Gestión de Salas
              </h3>
              <button
                onClick={closeRoomModal}
                aria-label="Cerrar gestión de salas"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex'
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Compartir enlace: solo para quien administra la sala. El enlace
                sirve porque lleva el código de acceso, y ese código únicamente
                se le entrega a quien administra (get_room_access_code). Si el
                bloque estuviera visible para cualquier miembro, copiaría un
                enlace sin código y quien lo recibiera sería rechazado, mientras
                el texto le asegura lo contrario. */}
            {isRoomAdmin && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '18px' }}>
              <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Share2 size={14} /> Compartir Enlace de la Sala
              </label>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                Este enlace lleva incluido el código de acceso de <strong>{roomName}</strong>: quien lo reciba entra directo.
                Sin él, nadie puede sumarse aunque conozca la dirección de la sala.
              </p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <input
                  type="text"
                  readOnly
                  aria-label="Enlace de invitación de la sala"
                  className="form-input"
                  value={buildInviteUrl()}
                  style={{ flex: 1, padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)', background: 'var(--bg-card)' }}
                />
                <button
                  type="button"
                  onClick={handleCopyRoomInvite}
                  className="btn btn-indigo"
                  style={{ padding: '8px 16px', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Copy size={14} aria-hidden="true" />
                  Copiar
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginTop: '6px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Lock size={12} aria-hidden="true" />
                  Código de acceso:
                  <strong style={{ color: 'var(--text-main)', fontFamily: 'monospace', letterSpacing: '0.08em' }}>
                    {roomAccessCode || '········'}
                  </strong>
                </span>
                <button
                  type="button"
                  className="btn-small"
                  onClick={handleRegenerateAccessCode}
                  title="Genera un código nuevo e invalida los enlaces ya compartidos"
                  style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
                >
                  <RefreshCw size={12} aria-hidden="true" /> Renovar
                </button>
              </div>
            </div>
            )}

            {/* Formulario 1: Renombrar Sala */}
            <form onSubmit={handleRenameRoom} style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '20px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Renombrar Sala Actual</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="form-input"
                  value={renameRoomInput}
                  onChange={(e) => setRenameRoomInput(e.target.value)}
                  placeholder="Ej. Equipo Comercial"
                  required
                  style={{ flex: 1, padding: '8px 12px' }}
                />
                <button type="submit" className="btn btn-indigo" style={{ padding: '8px 16px', fontSize: '13px' }}>
                  Guardar
                </button>
              </div>
            </form>

            {/* Formulario 2: Crear Nueva Sala (solo administrador, por ahora) */}
            {currentUser.email.toLowerCase() === ADMIN_EMAIL ? (
              <form onSubmit={handleCreateRoom} style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '20px' }}>
                <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Crear Nueva Sala (Desde Cero)</label>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  Al crear una nueva sala con un nombre personalizado, se generará una URL limpia. El nombre debe ser único: no se puede repetir el de otra sala existente.
                </p>
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <input
                    type="text"
                    className="form-input"
                    value={newRoomNameInput}
                    onChange={(e) => setNewRoomNameInput(e.target.value)}
                    placeholder="Ej. Marketing 2026"
                    required
                    style={{ flex: 1, padding: '8px 12px' }}
                  />
                  <button type="submit" className="btn btn-indigo" style={{ padding: '8px 16px', fontSize: '13px' }}>
                    Crear
                  </button>
                </div>
              </form>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '20px', borderBottom: '1px solid var(--border-color)', fontSize: '12px', color: 'var(--text-muted)' }}>
                <Lock size={13} style={{ flexShrink: 0 }} />
                Solo el administrador puede crear salas nuevas por el momento.
              </div>
            )}

            {/* Sección 3: Eliminar Sala */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-danger-hover, #ff453a)' }}>Zona de Peligro</label>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', maxWidth: '280px', lineHeight: '1.4' }}>
                  Eliminar permanentemente esta sala y todos sus miembros de la base de datos.
                </span>
                <button 
                  onClick={handleDeleteRoom}
                  disabled={currentRoomId === 'grupo-a'}
                  className="btn"
                  style={{ 
                    backgroundColor: 'rgba(255, 69, 58, 0.15)', 
                    color: '#ff453a', 
                    padding: '8px 16px', 
                    fontSize: '13px', 
                    fontWeight: '600',
                    border: '1px solid rgba(255, 69, 58, 0.3)',
                    cursor: currentRoomId === 'grupo-a' ? 'not-allowed' : 'pointer',
                    opacity: currentRoomId === 'grupo-a' ? 0.5 : 1
                  }}
                >
                  Eliminar Sala
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GUÍA DE BIENVENIDA (ONBOARDING) */}
      {showOnboarding && (() => {
        const steps = [
          {
            icon: <ChessKnightIcon size={44} />,
            title: `¡Bienvenido, ${currentUser.name.split(' ')[0]}!`,
            desc: 'Sales Arena Matcher coordina los role-plays de tu equipo cruzando la disponibilidad de todos, sin importar el país. Cargás tu horario una vez y el sistema se encarga del resto: lo único que tenés que hacer es confirmar. Esta guía te muestra cómo funciona.'
          },
          {
            icon: <CalendarRange size={34} />,
            title: '1 · Cargá tu disponibilidad',
            desc: 'Entrá a "Cargar Disponibilidad" y marcá en el calendario los horarios en los que podés hacer un role-play (en tu hora local). Podés guardar tu horario como plantilla para reutilizarlo cada semana. Una vez cargado, te olvidás: el emparejador trabaja solo.'
          },
          {
            icon: <RefreshCw size={34} />,
            title: '2 · Emparejamiento automático',
            desc: 'Cada semana el sistema te asigna un compañero 1:1 y el horario en común más próximo posible. Rota "todos con todos" para que no siempre te toque la misma persona, y prioriza a quienes muestran más compromiso y puntualidad. No tenés que buscar ni coordinar nada.'
          },
          {
            icon: <Check size={34} />,
            title: '3 · Confirmá (tu compromiso)',
            desc: 'Cuando te asignan una dupla, confirmá que vas a asistir. El link de Google Meet se genera recién cuando AMBOS confirman: así la confirmación es una señal real de compromiso. Cada propuesta te muestra hasta cuándo tenés tiempo de responder: el plazo es de 4 horas antes de la sesión, y se acorta (2 h, 1 h, 30 min) si te la asignaron con menos anticipación.'
          },
          {
            icon: <RefreshCw size={34} />,
            title: '4 · Si no confirmás, se reasigna',
            desc: 'Si dejás vencer ese plazo sin responder, la propuesta se cancela sola y el sistema busca reasignarte otro compañero que esté libre y sin otra reunión ya aceptada. La idea: que nadie quede esperando a alguien que no iba a venir.'
          },
          {
            icon: <Handshake size={34} />,
            title: '5 · Cancelaciones y respeto mutuo',
            desc: 'Todo esto es por respeto mutuo del tiempo y la predisposición de tus compañeros. Si no podés asistir, cancelá con +24 h de antelación: no pasa nada. Cancelar con menos de 24 h (o no presentarte) requiere un motivo y cuenta como falta. Con 3 faltas en el mes quedás fuera de la rotación hasta el 1° del mes siguiente, y volvés solo. Si ese patrón se repite en 3 meses distintos, la cuenta pierde el acceso a la sala. Llegar puntual (tolerancia 10 min) suma a tu confiabilidad y te da prioridad en los próximos emparejamientos.'
          },
          {
            icon: <LayoutDashboard size={34} />,
            title: '6 · Qué hay en cada sección',
            desc: 'Panel de Control: tu propuesta de la semana y la agenda de toda la sala. Cargar Disponibilidad: tu grilla de horarios. Mapa de Calor: en qué franjas hay más gente libre, en tu hora local. Afinidad Horaria: cuánto se solapa tu horario con el de cada compañero. Gestionar Equipo: quiénes están en la sala y su estado. Reportes y Análisis: tu confiabilidad y la de la sala, según lo que se reporta después de cada sesión.'
          }
        ];
        const step = steps[onboardingStep];
        const isLast = onboardingStep === steps.length - 1;

        return (
          <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-desc">
            <div className="onboarding-card glass" ref={onboardingModalRef} tabIndex={-1}>
              <button className="onboarding-close" onClick={closeOnboarding} title="Cerrar guía" aria-label="Cerrar guía de bienvenida">
                <X size={16} aria-hidden="true" />
              </button>

              <div className={`onboarding-icon ${onboardingStep === 0 ? 'brand' : ''}`}>
                {step.icon}
              </div>
              <h3 className="onboarding-title" id="onboarding-title">{step.title}</h3>
              <p className="onboarding-desc" id="onboarding-desc">{step.desc}</p>

              {/* aria-label con el total y aria-current marcando el actual: el
                  punto activo se distinguía solo por color y ancho, así que con
                  lector de pantalla no había forma de saber en qué paso estabas
                  ni cuántos faltaban. */}
              <div className="onboarding-dots">
                {steps.map((_, i) => (
                  <button
                    key={i}
                    className={`onboarding-dot ${i === onboardingStep ? 'active' : ''}`}
                    onClick={() => setOnboardingStep(i)}
                    aria-label={`Paso ${i + 1} de ${steps.length}`}
                    aria-current={i === onboardingStep ? 'step' : undefined}
                  />
                ))}
              </div>

              <div className="onboarding-actions">
                {onboardingStep > 0 ? (
                  <button className="btn btn-outline" onClick={() => setOnboardingStep(onboardingStep - 1)}>
                    <ChevronLeft size={14} /> Atrás
                  </button>
                ) : (
                  <button className="btn btn-outline" onClick={closeOnboarding}>
                    Saltar guía
                  </button>
                )}
                {isLast ? (
                  <button className="btn btn-indigo" onClick={() => { closeOnboarding(); setActiveTab('wizard'); setWizardStep(1); }}>
                    <CalendarCheck size={14} /> Cargar mi disponibilidad
                  </button>
                ) : (
                  <button className="btn btn-indigo" onClick={() => setOnboardingStep(onboardingStep + 1)}>
                    Siguiente <ChevronRight size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
