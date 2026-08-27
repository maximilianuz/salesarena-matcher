import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { supabase } from './supabaseClient';
import { buildWeeklyPairsMultiRound, currentWeekStartISO, MIN_LEAD_MS, respondByMs, DEFAULT_WEEKLY_TARGET } from './matcher';
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
  CalendarPlus,
  CalendarDays,
  Handshake,
  Trophy,
  Mail,
  Pencil,
  Save,
  Eraser,
  Target,
  UserPlus,
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
  PanelLeftOpen,
  // Reseñas de la app + moderación
  Star,
  Inbox,
  // Cierre de sesión (lo que responden los dos después del role-play)
  ClipboardCheck,
  ThumbsUp,
  Gauge,
  AlertTriangle,
  PhoneCall,
  // Deshacer en la grilla de disponibilidad
  RotateCcw
} from 'lucide-react';

import { ChessKnightIcon, GoogleMark, ReliabilityBadge, LoginConnectionsOrbit, AvatarPhoto } from './components/Brand';
import CallAnalysisView from './callAnalysis/CallAnalysisView';
import { DIAS, ZONAS, getCountryFlag, tzCity, resolveTimezone, guessLocationFromBrowser } from './domain/zones';
import { getNextMatchDateUtc, formatMeetingDateUtc, canRecordJoin } from './domain/schedule';
import { scheduleRuleFromRow, attendanceFromRow, joinRoomErrorMessage } from './domain/rows';
import {
  visibleHours,
  toggleDay as toggleDayCells,
  toggleHourRow as toggleHourCells,
  describeDrag,
  goalState
} from './domain/availabilityGrid';
import {
  getEngagement,
  getReciprocity,
  getCredibility,
  getPraiseReceived,
  getOwedCloseouts,
  getVeracity,
  getProvenLies,
  getPatternStrikes,
  getMonthlyLies,
  isBlockedForLying,
  CLOSEOUT_WINDOW_MS,
  MONTHLY_LIES_LIMIT
} from './closeouts';
import {
  getInitials,
  avatarStyle,
  escapeLikeLiteral,
  nameFromEmail,
  sleep,
  slugifyRoomName,
  googleCalendarUrl
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

// Google entrega la foto de perfil en el token de OAuth. Supabase la
// normaliza como avatar_url; se cae a picture (el claim crudo de Google) por
// si alguna vez cambia el mapeo — mismo respaldo doble que ya se usa para el
// nombre (full_name || name) más abajo.
const googleAvatarUrl = (session) =>
  session?.user?.user_metadata?.avatar_url || session?.user?.user_metadata?.picture || null;

// Estado de una reseña, en palabras. Lo usan el botón del menú y la lista de
// moderación, que antes lo tenían escrito por separado.
const FEEDBACK_STATUS_LABEL = {
  pending: 'Pendiente',
  approved: 'Publicada',
  rejected: 'Rechazada'
};

// Cuántas acciones hacia atrás guarda el "deshacer" de la grilla horaria.
// Cada entrada es una copia del array de celdas: 40 pasos es más de lo que
// nadie deshace de corrido y sigue siendo memoria despreciable.
const HISTORY_LIMIT = 40;

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

  // Enlace de ingreso que viaja en el evento de Google Calendar
  // (?join=<meetingId>). Existe para que el click a la reunión pase por la app
  // y deje registro en joined_at, en vez de ir derecho a Meet: sin ese registro
  // el barrido marca no-show a quien sí asistió, y la resolución de disputas
  // del cierre se queda sin evidencia.
  //
  // Se guarda en sessionStorage por lo mismo que el código de invitación: si la
  // persona no tenía sesión abierta, el login con Google sale del sitio y vuelve
  // a una URL limpia.
  const JOIN_STORAGE_KEY = `salesarena-join:${getRoomIdFromUrl() || 'grupo-a'}`;
  const [joinMeetingId] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('join');
    if (fromUrl) {
      const clean = fromUrl.trim();
      try { sessionStorage.setItem(JOIN_STORAGE_KEY, clean); } catch { /* modo privado */ }
      const url = new URL(window.location.href);
      url.searchParams.delete('join');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      return clean;
    }
    try { return sessionStorage.getItem(JOIN_STORAGE_KEY) || ''; } catch { return ''; }
  });
  // null | 'entrando' | 'error'
  const [joinState, setJoinState] = useState(null);
  const [joinError, setJoinError] = useState('');
  const joinHandledRef = useRef(false);

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

  // Acciones de administración en vuelo. Sin esto, dos clics seguidos en
  // "Renovar código" rotaban el código DOS veces y el enlace que se acababa de
  // repartir quedaba muerto; renombrar dos veces disparaba dos migraciones de
  // sala concurrentes.
  const [addingMember, setAddingMember] = useState(false);
  const [roomSaving, setRoomSaving] = useState(false);
  const [codeRotating, setCodeRotating] = useState(false);

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

  // Reseña de la app (estrellas + comentario). myFeedback es la propia fila
  // (o null si nunca opinó); se usa tanto para prellenar el form como para
  // mostrar el estado ("pendiente de revisión" / "publicada").
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [myFeedback, setMyFeedback] = useState(null);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const feedbackModalRef = useDialogA11y(showFeedbackModal, () => setShowFeedbackModal(false));

  // Moderación (solo platform admin): lista de reseñas para aprobar/rechazar.
  const [showFeedbackReviewModal, setShowFeedbackReviewModal] = useState(false);
  const [feedbackReviewList, setFeedbackReviewList] = useState([]);

  // --- CIERRE DE SESIÓN (lo que responden los dos después del role-play) ---
  // openCloseouts: los que me faltan responder. standing: mi compromiso y mi
  // reciprocidad ya calculados. praise: los elogios que recibí, sin autor y
  // solo de sobres ya abiertos. Nunca entra acá nada de lo que respondió otra
  // persona sobre sí misma ni sobre terceros.
  const [openCloseouts, setOpenCloseouts] = useState([]);
  const [closeoutStanding, setCloseoutStanding] = useState(null);
  const [closeoutPraise, setCloseoutPraise] = useState([]);
  const [closeoutFlags, setCloseoutFlags] = useState([]); // solo admin
  const [closeoutTarget, setCloseoutTarget] = useState(null); // el pendiente que se está respondiendo
  const [closeoutAnswers, setCloseoutAnswers] = useState(null);
  const [closeoutSubmitting, setCloseoutSubmitting] = useState(false);
  const [feedbackReviewLoading, setFeedbackReviewLoading] = useState(false);
  const feedbackReviewModalRef = useDialogA11y(showFeedbackReviewModal, () => setShowFeedbackReviewModal(false));
  const pendingFeedbackCount = feedbackReviewList.filter(f => f.status === 'pending').length;

  // Estados de carga del Wizard
  const [wizardStep, setWizardStep] = useState(1); // 1: Bienvenida, 2: Opciones, 3: Grid
  const [wizardGrid, setWizardGrid] = useState([]); // [{dayIdx, hour}]
  // Corrección de la zona horaria detectada, desde el asistente.
  const [editingTz, setEditingTz] = useState(false);
  const [savingTz, setSavingTz] = useState(false);
  // Propuesta cuyo Meet se está creando ahora mismo, para no dispararlo dos
  // veces desde esta misma pantalla.
  const [creatingMeetFor, setCreatingMeetFor] = useState(null);
  // Cuántos role-plays quiere esta semana. Se precarga con lo que ya eligió
  // para que reabrir el asistente no le pise su preferencia con el valor base.
  const [wizardWeeklyTarget, setWizardWeeklyTarget] = useState(DEFAULT_WEEKLY_TARGET);
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
  // Solo se guarda QUÉ celda está elegida, nunca sus datos: el mapa se
  // recalcula (al resolverse la zona horaria de la sesión, o cuando alguien
  // cambia su disponibilidad) y una copia de count/names tomada en el click
  // dejaba el panel de detalle mostrando nombres viejos mientras la grilla ya
  // se había actualizado.
  const [selectedHeatmapCell, setSelectedHeatmapCell] = useState(null); // { day, hour }

  // Flechas / Inicio / Fin para recorrer el mapa de calor. La grilla expone una
  // sola parada de tabulación (roving tabindex), así que sin esto el teclado no
  // tendría forma de llegar a 167 de las 168 celdas. Se enfoca la celda destino
  // a mano porque el cambio de tabIndex por sí solo no mueve el foco.
  const handleHeatmapKeyDown = (e) => {
    const { day, hour } = selectedHeatmapCell || { day: 0, hour: 0 };
    let next;
    if (e.key === 'ArrowLeft') next = { day: Math.max(0, day - 1), hour };
    else if (e.key === 'ArrowRight') next = { day: Math.min(6, day + 1), hour };
    else if (e.key === 'ArrowUp') next = { day, hour: Math.max(0, hour - 1) };
    else if (e.key === 'ArrowDown') next = { day, hour: Math.min(23, hour + 1) };
    else if (e.key === 'Home') next = { day: 0, hour };
    else if (e.key === 'End') next = { day: 6, hour };
    else return;

    e.preventDefault();
    setSelectedHeatmapCell(next);
    document.querySelector(`[data-heatmap-cell="${next.day}-${next.hour}"]`)?.focus();
  };

  // Variables para arrastre en la grilla visual
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [dragMode, setDragMode] = useState(true); // true = pintar, false = borrar
  // Trazo en curso: qué celdas se vienen pintando y dónde está el puntero, para
  // mostrar el rango en vivo en vez de hacer contar celdas al soltar.
  const [dragInfo, setDragInfo] = useState(null);
  // Deshacer. Se apila una entrada por acción (un trazo entero, un clic de
  // cabecera, un Limpiar), no por celda.
  const [gridHistory, setGridHistory] = useState([]);

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

  // Producción: cargar SOLO la propuesta propia de la semana actual.
  //
  // Depende de `roomDataVersion` —igual que la carga del resto de la sala— y esa
  // es la pieza que faltaba para que el tablero se actualizara solo. Realtime
  // avisaba de la propuesta nueva, la versión subía y se recargaban miembros,
  // horarios y reuniones... pero NO las propuestas, que era justo el dato que
  // había cambiado. El match ya estaba en la base y en pantalla no aparecía
  // hasta recargar la página a mano.
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
  }, [currentUser?.email, currentRoomId, roomDataVersion]);

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
  const myLastClosedProposal = myLiveProposals.length > 0
    ? null
    : myWeekProposals.sort((x, y) => (y.id || 0) - (x.id || 0))[0] || null;

  // Modo demo: correr el emparejador localmente (en producción lo hace la
  // Edge Function semanal weekly-matcher; el cliente solo lee su propuesta)
  useEffect(() => {
    if (!useMockDb || !currentUser) return;
    const week = currentWeekStartISO();
    const pairKeyOf = (a, b) => [a.toLowerCase(), b.toLowerCase()].sort().join('|');
    const weekProposals = proposals.filter(p => p.weekStart === week);
    // Lo ÚNICO que bloquea a una dupla para toda la semana es un RECHAZO: ahí
    // hubo un "no" explícito y se respeta. Se excluye la dupla, no a la
    // persona: cada integrante queda libre para matchear con otros. Debe
    // coincidir con la Edge Function.
    const excludedPairs = new Set(
      weekProposals
        .filter(p => p.status === 'rechazado')
        .map(p => pairKeyOf(p.aEmail, p.bEmail))
    );
    // El resto es exclusión BLANDA: se prefiere a alguien nuevo, pero si no
    // queda nadie más la dupla se vuelve a ofrecer en OTRO horario.
    //   * EXPIRADO: nadie confirmó a tiempo.
    //   * CANCELADO: se cayó esa sesión puntual. Bloquear a la dupla por eso
    //     dejaba a dos personas disponibles sin practicar toda la semana.
    //   * PROPUESTO/CONFIRMADO: ya tienen una sesión juntos; alcanza para
    //     preferir a otro, no para negarles una segunda cuando no hay otro.
    const softPairs = new Set(
      weekProposals
        .filter(p => p.status !== 'rechazado')
        .map(p => pairKeyOf(p.aEmail, p.bEmail))
    );
    // Horarios ya comprometidos por las propuestas vivas: nadie puede terminar
    // con dos role-plays a la misma hora.
    const busySlots = new Map();
    const markBusy = (email, slot) => {
      const k = email.toLowerCase();
      if (!busySlots.has(k)) busySlots.set(k, new Set());
      busySlots.get(k).add(slot);
    };
    // Sesiones que cada persona ya tiene esta semana: el tope semanal las cuenta
    // para no volver a sumarle el tope entero en cada corrida.
    const sessionCounts = new Map();
    const addSession = (email) => {
      const k = email.toLowerCase();
      sessionCounts.set(k, (sessionCounts.get(k) ?? 0) + 1);
    };
    for (const p of weekProposals) {
      if (p.status !== 'propuesto' && p.status !== 'confirmado') continue;
      addSession(p.aEmail);
      addSession(p.bEmail);
      if (p.slot === null || p.slot === undefined) continue;
      markBusy(p.aEmail, p.slot);
      markBusy(p.bEmail, p.slot);
    }
    const pool = members.filter(m => m.active);
    if (pool.length < 2) return;

    const slotSets = computeSlotSets(pool, availabilities);
    const scores = new Map(pool.map(m => [m.email, getReliability(m.email)]));
    // Cuántas sesiones quiere cada uno: el cupo es de la persona, no global.
    const weeklyTargets = new Map(
      pool.map(m => [m.email.toLowerCase(), m.weeklyTarget ?? DEFAULT_WEEKLY_TARGET])
    );
    const pairs = buildWeeklyPairsMultiRound(
      pool, slotSets, scores, excludedPairs, new Map(), new Date(),
      softPairs, MIN_LEAD_MS, busySlots, sessionCounts, weeklyTargets
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

  // Credibilidad propia, con el factor de veracidad ya aplicado. Se calcula acá
  // y no dentro del JSX porque la tarjeta la muestra y la usa dos veces.
  const myCredibility = !currentUser || !closeoutStanding
    ? null
    : getCredibility(
        getReliability(currentUser.email),
        closeoutStanding.engagement,
        closeoutStanding.reciprocity,
        closeoutStanding.veracity
      );

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
          active: d.active,
          avatarUrl: d.avatar_url,
          // Cuántos role-plays quiere por semana. La columna es nueva: si la
          // migración todavía no corrió, se cae al valor de arranque en vez de
          // dejar el cupo en undefined y que el motor no proponga nada.
          weeklyTarget: d.weekly_target ?? DEFAULT_WEEKLY_TARGET
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

  // --- LA SALA EN VIVO ---
  //
  // Antes los datos se leían una sola vez, al abrir. Lo que hacía la otra
  // persona —aceptar la propuesta, crear el Meet, cancelar— no se veía hasta
  // recargar a mano, y como el cron corre cada 10 minutos la sensación era que
  // "la app tarda 10 minutos" cuando el dato ya estaba guardado.
  //
  // Se escuchan los cambios de ESTA sala y se refresca. El refetch va demorado
  // 400ms porque una sola acción dispara varios cambios seguidos (la reunión,
  // sus dos filas de asistencia, la propuesta): sin eso serían cuatro recargas
  // para un solo evento.
  useEffect(() => {
    if (useMockDb || !isLoggedIn || !currentRoomId) return;

    let pendiente = null;
    const refrescarPronto = () => {
      clearTimeout(pendiente);
      pendiente = setTimeout(() => setRoomDataVersion(v => v + 1), 400);
    };

    const filtro = `room_id=eq.${currentRoomId}`;
    const canal = supabase.channel(`sala:${currentRoomId}`);
    for (const tabla of ['match_proposals', 'meetings', 'meeting_attendees', 'members', 'availabilities']) {
      canal.on('postgres_changes', { event: '*', schema: 'public', table: tabla, filter: filtro }, refrescarPronto);
    }
    canal.subscribe();

    // Respaldo para cuando Realtime no esté disponible (proyecto sin la
    // publicación, red que corta websockets): al volver a la pestaña se
    // refresca igual. Es el momento en que la persona vuelve a mirar.
    const alVolver = () => {
      if (document.visibilityState === 'visible') refrescarPronto();
    };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);

    return () => {
      clearTimeout(pendiente);
      supabase.removeChannel(canal);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', alVolver);
    };
  }, [currentRoomId, isLoggedIn]);

  // Fila de members → objeto de usuario de la app
  const memberFromRow = (row) => ({
    name: row.name,
    email: row.email,
    country: row.country,
    tz: row.timezone,
    active: row.active,
    avatarUrl: row.avatar_url
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
        // Refresca la foto si cambió la de Google. El resto del perfil
        // (nombre, país) no se pisa solo por volver a entrar —alguien pudo
        // haberlo corregido a mano en "Gestionar Equipo"— pero la foto no
        // tiene ninguna pantalla de edición propia, así que no hay nada que
        // proteger de un sobrescrito indeseado.
        const avatarUrl = googleAvatarUrl(session);
        if (avatarUrl && avatarUrl !== existing.avatar_url) {
          await supabase.from('members')
            .update({ avatar_url: avatarUrl })
            .eq('room_id', currentRoomId)
            .eq('email', existing.email);
          existing.avatar_url = avatarUrl;
          setMembers(prev => prev.map(m =>
            m.email.toLowerCase() === existing.email.toLowerCase() ? { ...m, avatarUrl } : m
          ));
        }
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
        await registerMember(googleName, guessLocationFromBrowser(), email, googleAvatarUrl(session));
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
      activeMembers, availabilities, currentUser?.tz || 'UTC', currentUser?.email
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
        if (i === j) return { name: partner.name, email: partner.email, pct: null };
        let common = 0;
        sets[i].forEach(s => { if (sets[j].has(s)) common++; });
        const denom = Math.min(sets[i].size, sets[j].size);
        const pct = denom ? Math.round((common / denom) * 100) : 0;
        return { name: partner.name, email: partner.email, pct };
      });
      // El email va en la fila, no solo en los stats: es la única forma de que
      // quien mira encuentre SU fila. Filtrar por nombre hacía que dos
      // homónimos de la misma sala vieran la afinidad del otro como propia,
      // igual que el bug que ruleBelongsTo (src/slots.js) ya corrigió para el
      // mapa de calor.
      return { name: member.name, email: member.email, stats: partnerStats };
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
        // Quien se da de baja no puede sostener sus role-plays: del otro lado
        // hay gente que se organizó para estar. Se cancelan para que vuelvan al
        // emparejamiento y puedan conseguir otro compañero esta misma semana.
        const caidas = await cancelStaleProposals(null);
        setWizardStatus({
          type: 'success',
          msg: caidas > 0
            ? `¡Registrado! Quedás excluido por esta semana y se cancelaron tus ${caidas === 1 ? 'role-play' : `${caidas} role-plays`} para que tus compañeros puedan reasignarse.`
            : '¡Registrado! Has sido excluido por esta semana.'
        });
        // Reasignar a los que quedaron sueltos en el acto, no en la próxima
        // pasada del cron: es gente que se organizó para practicar hoy.
        if (caidas > 0) triggerWeeklyMatcher({ yaGuardado: 'Registramos tu baja' });
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

  // Da de baja las propuestas vivas que dejaron de tener sentido.
  //
  // Antes, cambiar la disponibilidad o dejar de participar NO tocaba lo ya
  // propuesto: quedaba una propuesta apuntando a una hora que la persona ya no
  // tiene marcada, y del otro lado alguien esperando una sesión que no va a
  // ocurrir. Se cancela solo lo que corresponde:
  //   * `rules` con las reglas nuevas → cae lo que quedó fuera de ese horario.
  //   * `rules` en null (dejó de participar) → caen todas.
  // Devuelve cuántas se cancelaron, para poder avisarle a quien lo provocó.
  const cancelStaleProposals = async (rules) => {
    if (useMockDb || !currentUser) return 0;
    const myEmail = currentUser.email.toLowerCase();

    const mias = proposals.filter(p =>
      p.weekStart === currentWeekStartISO() &&
      (p.status === 'propuesto' || p.status === 'confirmado') &&
      [p.aEmail, p.bEmail].some(e => e?.toLowerCase() === myEmail)
    );
    if (mias.length === 0) return 0;

    let caducas;
    if (rules === null) {
      caducas = mias; // se dio de baja: no puede sostener ninguna
    } else {
      // Mismo cálculo que usa el emparejador, así lo que se conserva es
      // exactamente lo que seguiría siendo válido para él.
      const misSlots = computeSlotSets([currentUser], rules).get(currentUser.email) || new Set();
      caducas = mias.filter(p => !misSlots.has(p.slot));
    }
    if (caducas.length === 0) return 0;

    const ids = caducas.map(p => p.id);
    const { error } = await supabase
      .from('match_proposals')
      .update({ status: 'cancelado' })
      .in('id', ids);
    if (error) {
      console.error('cancelStaleProposals:', error);
      return 0;
    }
    setProposals(prev => prev.map(p =>
      ids.includes(p.id) ? { ...p, status: 'cancelado' } : p));
    return caducas.length;
  };

  // Dispara el weekly-matcher AL INSTANTE. Se llama en todo momento en que
  // alguien vuelve al pool o cambia lo que el emparejador necesita saber:
  // horarios nuevos, baja de participación, rechazo de una propuesta,
  // cancelación de una reunión. Sin esto había que esperar a la próxima pasada
  // del cron —hasta 10 minutos— para ver un match que ya se podía formar.
  // `yaGuardado` nombra lo que SÍ quedó guardado, para el aviso de error: la
  // función se llama desde flujos distintos y decirle "tus horarios se
  // guardaron" a quien acaba de cancelar una reunión no explica nada.
  const triggerWeeklyMatcher = async ({ yaGuardado = 'Tus horarios se guardaron' } = {}) => {
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

      const correr = () => fetch(
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

      let response = await correr();
      let data = response.ok ? await response.json() : null;

      // La sala estaba tomada por otra corrida (el cron, o dos personas que
      // tocaron algo en el mismo segundo). Dura menos de un segundo, así que se
      // espera y se reintenta en vez de dejar el cambio para dentro de 10 min.
      for (let intento = 0; intento < 3 && data?.skipped === 'already_running'; intento++) {
        await new Promise(r => setTimeout(r, 700 * (intento + 1)));
        response = await correr();
        data = response.ok ? await response.json() : null;
      }

      if (response.ok) {
        console.log('Weekly-matcher triggered:', data);
        // Refresco explícito: no se espera al evento de Realtime. Es el mismo
        // refetch que usa la sala en vivo, pero disparado por quien provocó el
        // cambio, que es justo la persona que está mirando la pantalla.
        setRoomDataVersion(v => v + 1);
        if (data?.created && Object.values(data.created).some(v => v > 0)) {
          showNotification('✨ ¡Se generaron nuevas propuestas de emparejamiento!');
        }
      } else {
        // Silenciar esto ya costó un incidente: el preflight de CORS fallaba
        // siempre, nadie se enteraba, y el emparejamiento parecía "no encontrar
        // a nadie" cuando en realidad la llamada nunca llegaba. El cambio SÍ
        // quedó guardado, así que el aviso dice qué se perdió y qué no.
        console.error('Weekly-matcher error:', response.statusText);
        showNotification(
          `${yaGuardado}, pero no pudimos buscar coincidencias ahora. Se reintenta solo en unos minutos.`,
          'error'
        );
      }
    } catch (err) {
      console.error('Failed to trigger weekly-matcher:', err);
      showNotification(
        `${yaGuardado}, pero no pudimos buscar coincidencias ahora. Se reintenta solo en unos minutos.`,
        'error'
      );
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

      await cancelStaleProposals(userTemplateRules);

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

    // 2b. Cuántos role-plays quiere esta semana. Si esto falla, los horarios YA
    // quedaron guardados, así que no se hace fracasar todo el paso — pero
    // TAMPOCO se toca el estado local: dejarlo en el número nuevo mostraría un
    // cupo que la base no tiene, y la persona creería que pidió 5 mientras el
    // emparejador le sigue dando 3.
    let targetGuardado = wizardWeeklyTarget;
    if (!useMockDb) {
      const { error: targetError } = await supabase
        .from('members')
        .update({ weekly_target: wizardWeeklyTarget })
        .eq('room_id', currentRoomId)
        .ilike('email', escapeLikeLiteral(currentUser.email));
      if (targetError) {
        console.error('weekly_target:', targetError);
        const anterior = members.find(
          mem => mem.email.toLowerCase() === currentUser.email.toLowerCase()
        )?.weeklyTarget ?? DEFAULT_WEEKLY_TARGET;
        targetGuardado = anterior;
        setWizardWeeklyTarget(anterior);
        showNotification(
          `Tus horarios se guardaron, pero no pudimos cambiar la cantidad de role-plays por semana: sigue en ${anterior}. Probá de nuevo desde el asistente.`,
          'error'
        );
      }
    }
    setMembers(prev => prev.map(mem =>
      mem.email.toLowerCase() === currentUser.email.toLowerCase()
        ? { ...mem, weeklyTarget: targetGuardado }
        : mem
    ));

    // Bajar el cupo NO cancela lo que ya está agendado: del otro lado hay
    // alguien que quizás ya confirmó. Se avisa para que no parezca que el
    // cambio no se guardó al seguir viendo más propuestas de las que pidió.
    const misPropuestasVivas = proposals.filter(p =>
      p.weekStart === currentWeekStartISO() &&
      (p.status === 'propuesto' || p.status === 'confirmado') &&
      [p.aEmail, p.bEmail].some(e => e?.toLowerCase() === currentUser.email.toLowerCase())
    ).length;
    if (misPropuestasVivas > wizardWeeklyTarget) {
      showNotification(
        `Ya tenés ${misPropuestasVivas} role-plays agendados esta semana, más de los ${wizardWeeklyTarget} que pediste. ` +
        'Esos siguen en pie porque del otro lado hay alguien esperándote: si no podés con alguno, cancelalo desde la tarjeta. ' +
        'El cupo nuevo se aplica desde la próxima semana.',
        'info'
      );
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

    // Lo que ya estaba propuesto fuera de este horario nuevo se cae: sostener
    // una sesión en una hora que la persona acaba de sacar dejaría al compañero
    // esperando de gusto.
    const caidas = await cancelStaleProposals(newRules);
    if (caidas > 0) {
      showNotification(
        caidas === 1
          ? 'Se canceló 1 role-play que quedaba fuera de tu horario nuevo. Tu compañero vuelve al emparejamiento.'
          : `Se cancelaron ${caidas} role-plays que quedaban fuera de tu horario nuevo. Tus compañeros vuelven al emparejamiento.`,
        'info'
      );
    }

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
      await registerMember(nameFromEmail(emailToUse), guessLocationFromBrowser(), emailToUse);
    }
  };

  // Registra un miembro nuevo en Supabase y actualiza el estado local.
  // Se usa desde el auto-registro OAuth, el flujo mock y el paso de
  // código de invitación.
  const registerMember = async (rawName, rawLocation, emailOverride, avatarUrl = null) => {
    const email = (emailOverride || loginEmail).trim().toLowerCase();
    // rawLocation viene de guessLocationFromBrowser: trae el país Y la zona.
    // La zona se toma de ahí y NO se re-deriva del nombre del país, porque para
    // alguien cuya zona no está en la tabla el nombre es el de su ciudad y
    // resolveTimezone no sabría traducirlo — terminaba cayendo a otro país.
    const finalCountry = typeof rawLocation === 'string' ? rawLocation : rawLocation.country;
    const finalTz = (typeof rawLocation === 'object' && rawLocation.tz)
      ? rawLocation.tz
      : resolveTimezone(finalCountry);
    const newUser = {
      name: rawName.trim(),
      email,
      country: finalCountry,
      tz: finalTz,
      active: true,
      avatarUrl
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
        p_timezone: newUser.tz,
        p_avatar_url: newUser.avatarUrl
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

  // Cambiar la zona horaria propia. Los horarios ya cargados NO se tocan: se
  // guardaron como "lunes de 9 a 12 en mi hora local", así que al cambiar la
  // zona pasan a significar 9 a 12 en la zona nueva, que es justo lo que quiere
  // alguien que estaba mal detectado. Lo que sí cambia es a qué hora UTC caen,
  // y eso lo recalcula el motor solo en la próxima corrida.
  const saveMyTimezone = async (nuevaTz) => {
    if (!nuevaTz || nuevaTz === currentUser?.tz) { setEditingTz(false); return; }
    const zona = ZONAS.find(z => z.tz === nuevaTz);
    if (!zona) { setEditingTz(false); return; }

    setSavingTz(true);
    try {
      if (!useMockDb) {
        const { error } = await supabase
          .from('members')
          .update({ country: zona.country, timezone: zona.tz })
          .eq('room_id', currentRoomId)
          .ilike('email', escapeLikeLiteral(currentUser.email));
        if (error) {
          showNotification('No pudimos guardar tu zona horaria. Intentá de nuevo en un momento.', 'error');
          return;
        }
      }
      const actualizado = { ...currentUser, country: zona.country, tz: zona.tz };
      applyLoggedInUser(actualizado);
      setMembers(prev => prev.map(mem =>
        mem.email.toLowerCase() === currentUser.email.toLowerCase()
          ? { ...mem, country: zona.country, tz: zona.tz }
          : mem
      ));
      setEditingTz(false);
      showNotification(
        `Listo: tus horarios ahora se leen en ${zona.country}. Revisá el calendario por las dudas.`,
        'success'
      );
    } finally {
      setSavingTz(false);
    }
  };

  const handleLogout = async () => {
    if (!useMockDb) {
      await supabase.auth.signOut();
    }
    setIsLoggedIn(false);
    setLoginEmail('');
    setLoginStep(1);

    // Todo lo que sea de ESTA persona se borra acá. La app es una SPA: al
    // deslogear no se remonta el árbol, así que sin este limpiado el siguiente
    // usuario que entre en la misma compu ve, hasta que resuelva su carga
    // asíncrona, el compromiso y los ELOGIOS del anterior — justo lo que el
    // sobre cerrado existe para no filtrar entre personas.
    setOpenCloseouts([]);
    setCloseoutStanding(null);
    setCloseoutPraise([]);
    setMyFeedback(null);
    setMembers([]);
    setAvailabilities([]);
    setMeetings([]);
    setAttendances([]);
    setProposals([]);
    setHeatmap([]);
    setAffinity([]);

    localStorage.removeItem('salesarena-logged');
    localStorage.removeItem('salesarena-user');
  };

  // --- GESTIÓN DE SALAS (ROOMS) ---
  const handleRenameRoom = async (e) => {
    e.preventDefault();
    if (!renameRoomInput.trim()) return;
    if (roomSaving) return;

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

    setRoomSaving(true);
    try {
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
    } finally {
      setRoomSaving(false);
    }
  };

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    if (!newRoomNameInput.trim()) return;
    if (roomSaving) return;

    const rawName = newRoomNameInput.trim();
    const slug = slugifyRoomName(rawName);

    if (!slug) {
      showNotification('Nombre de sala inválido.');
      return;
    }

    setRoomSaving(true);
    try {
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
    } finally {
      setRoomSaving(false);
    }
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
        // Sin este aviso, un fallo de red se ve idéntico a "esta sala todavía
        // no tiene código": quien administra copiaría el enlace SIN el código
        // y se lo mandaría a alguien que después no puede entrar.
        if (error) {
          console.error('get_room_access_code:', error);
          showNotification(
            'No pudimos cargar el código de acceso. Cerrá y volvé a abrir esta ventana antes de compartir el enlace.',
            'error'
          );
        }
      });
    return () => { cancelled = true; };
  }, [isRoomModalOpen, isRoomAdmin, currentRoomId]);

  const handleRegenerateAccessCode = async () => {
    if (codeRotating) return;
    const confirmed = await showConfirm(
      'Al generar un código nuevo, los enlaces de invitación que ya compartiste dejan de funcionar. Quienes ya son miembros de la sala no se ven afectados. ¿Continuar?',
      'Sí, generar'
    );
    if (!confirmed) return;

    setCodeRotating(true);
    try {
      const { data, error } = await supabase.rpc('rotate_room_access_code', { p_room_id: currentRoomId });
      if (error) {
        showNotification('No pudimos generar un código nuevo. Intentá de nuevo en un momento.', 'error');
        return;
      }
      setRoomAccessCode(data || '');
      showNotification('Código de acceso renovado. Compartí el enlace nuevo con quien quieras invitar.', 'success');
    } finally {
      setCodeRotating(false);
    }
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

  // --- RESEÑAS DE LA APP (estrellas + comentario) ---
  // Modo mock: se simula con localStorage, con una clave GLOBAL (no por sala,
  // a diferencia de meetings/attendees) porque una reseña es de la app en
  // general, no de una sala en particular — mismo criterio que UNIQUE
  // member_email en la tabla real.
  const loadMockFeedback = () => {
    try { return JSON.parse(localStorage.getItem('salesarena-mock-feedback') || '[]'); }
    catch { return []; }
  };
  const saveMockFeedback = (list) => {
    localStorage.setItem('salesarena-mock-feedback', JSON.stringify(list));
  };

  const loadMyFeedback = async () => {
    if (!currentUser) return;
    if (useMockDb) {
      const mine = loadMockFeedback().find(f => f.member_email === currentUser.email.toLowerCase());
      setMyFeedback(mine || null);
      return;
    }
    const { data, error } = await supabase.rpc('my_app_feedback');
    // Un fallo de red no significa "no dejaste reseña": si se blanquea, el
    // formulario se abre vacío y quien ya había escrito la suya cree que se
    // perdió. Ante error se deja lo que había y se avisa.
    if (error) {
      console.error('my_app_feedback:', error);
      showNotification('No pudimos cargar tu reseña. Revisá tu conexión.', 'error');
      return;
    }
    setMyFeedback(data || null);
  };

  const openFeedbackModal = () => {
    setFeedbackRating(myFeedback?.rating || 0);
    setFeedbackComment(myFeedback?.comment || '');
    setShowFeedbackModal(true);
  };

  const submitFeedback = async () => {
    if (feedbackRating < 1 || feedbackRating > 5) {
      showNotification('Elegí de 1 a 5 estrellas antes de enviar.', 'error');
      return;
    }
    const comment = feedbackComment.trim();
    if (!comment) {
      showNotification('Escribí un comentario antes de enviar.', 'error');
      return;
    }

    setFeedbackSubmitting(true);
    try {
      if (useMockDb) {
        const list = loadMockFeedback();
        const email = currentUser.email.toLowerCase();
        const idx = list.findIndex(f => f.member_email === email);
        const row = {
          id: idx >= 0 ? list[idx].id : Date.now(),
          member_email: email,
          member_name: currentUser.name,
          avatar_url: currentUser.avatarUrl || null,
          room_id: currentRoomId,
          rating: feedbackRating,
          comment: comment.slice(0, 600),
          status: 'pending',
          created_at: idx >= 0 ? list[idx].created_at : new Date().toISOString(),
          reviewed_at: null
        };
        if (idx >= 0) list[idx] = row; else list.push(row);
        saveMockFeedback(list);
        setMyFeedback(row);
      } else {
        const { data, error } = await supabase.rpc('submit_app_feedback', {
          p_rating: feedbackRating,
          p_comment: comment
        });
        if (error) {
          showNotification('No pudimos guardar tu reseña. Intentá de nuevo en un momento.', 'error');
          return;
        }
        setMyFeedback(data);
      }
      showNotification('¡Gracias por tu reseña! La vamos a revisar antes de publicarla.', 'success');
      setShowFeedbackModal(false);
      // La reseña recién enviada nace 'pending', así que suma al contador de
      // moderación. Sin este refresco el número del menú se quedaba con el
      // valor de la carga de la página y solo se corregía al abrir el modal.
      if (isAdmin) loadFeedbackForReview();
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  // --- MODERACIÓN DE RESEÑAS (solo platform admin) ---
  // Lo que ningún promedio resuelve solo: reportes de trato no cordial y
  // sesiones en disputa. Va junto a la moderación de reseñas porque es el mismo
  // trabajo —revisar a mano lo que el sistema no puede decidir.
  const loadCloseoutFlags = async () => {
    if (!isAdmin || useMockDb) return;
    const { data, error } = await supabase.rpc('list_closeout_flags');
    if (!error && data) setCloseoutFlags(data);
  };

  const loadFeedbackForReview = async () => {
    if (!isAdmin) return;
    loadCloseoutFlags();
    setFeedbackReviewLoading(true);
    try {
      if (useMockDb) {
        const list = [...loadMockFeedback()].sort((a, b) =>
          (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) ||
          new Date(b.created_at) - new Date(a.created_at)
        );
        setFeedbackReviewList(list);
        return;
      }
      const { data, error } = await supabase.rpc('list_feedback_for_review');
      if (!error) setFeedbackReviewList(data || []);
    } finally {
      setFeedbackReviewLoading(false);
    }
  };

  const openFeedbackReviewModal = () => {
    setShowFeedbackReviewModal(true);
    loadFeedbackForReview();
  };

  const reviewFeedback = async (id, approve) => {
    if (useMockDb) {
      const list = loadMockFeedback().map(f =>
        f.id === id ? { ...f, status: approve ? 'approved' : 'rejected', reviewed_at: new Date().toISOString() } : f
      );
      saveMockFeedback(list);
      setFeedbackReviewList(prev => prev.map(f =>
        f.id === id ? { ...f, status: approve ? 'approved' : 'rejected' } : f
      ));
      return;
    }
    const { error } = await supabase.rpc('review_app_feedback', { p_id: id, p_approve: approve });
    if (error) {
      showNotification('No pudimos actualizar esa reseña. Intentá de nuevo.', 'error');
      return;
    }
    setFeedbackReviewList(prev => prev.map(f =>
      f.id === id ? { ...f, status: approve ? 'approved' : 'rejected' } : f
    ));
  };

  // Carga la propia reseña (para el botón "Tu reseña" vs "Calificar la app")
  // y, si es platform admin, la lista completa (para el contador de
  // pendientes en el sidebar, sin tener que abrir el modal primero).
  useEffect(() => {
    if (!isLoggedIn || !currentUser) return;
    loadMyFeedback();
    if (isAdmin) loadFeedbackForReview();
  }, [isLoggedIn, currentUser?.email, isAdmin]);

  // --- CIERRE DE SESIÓN ---
  const mockCloseoutKey = `salesarena-mock-closeouts-${currentRoomId}`;
  const loadMockCloseouts = () => {
    try { return JSON.parse(localStorage.getItem(mockCloseoutKey) || '[]'); } catch { return []; }
  };
  const saveMockCloseouts = (list) => {
    try { localStorage.setItem(mockCloseoutKey, JSON.stringify(list)); } catch { /* modo privado */ }
  };

  // Qué cierres me faltan, mi situación y los elogios recibidos.
  //
  // En producción esto son tres RPC: el cliente NUNCA recibe la tabla de
  // cierres, porque el sobre cerrado se sostiene en las funciones del servidor
  // y no en lo que decida mostrar la pantalla. En modo demo se calcula local
  // con el mismo módulo puro que usan los tests.
  const loadCloseoutState = async () => {
    if (!currentUser) return;
    const email = currentUser.email.toLowerCase();

    if (useMockDb) {
      const all = loadMockCloseouts();
      const now = Date.now();
      const yaRespondi = new Set(
        all.filter(c => c.authorEmail.toLowerCase() === email).map(c => c.meetingId)
      );
      const pendientes = getOwedCloseouts(email, meetings, attendances, now)
        .filter(id => !yaRespondi.has(id))
        .filter(id => {
          const m = meetings.find(x => x.id === id);
          const fin = Date.parse(m.startsAt) + (m.duration || 60) * 60000;
          return now <= fin + CLOSEOUT_WINDOW_MS;
        })
        .map(id => {
          const m = meetings.find(x => x.id === id);
          const otro = attendances.find(a =>
            a.meetingId === id && a.memberEmail.toLowerCase() !== email);
          const perfil = members.find(x => x.email.toLowerCase() === otro?.memberEmail.toLowerCase());
          const fin = Date.parse(m.startsAt) + (m.duration || 60) * 60000;
          return {
            meetingId: id,
            startsAt: m.startsAt,
            closesAt: new Date(fin + CLOSEOUT_WINDOW_MS).toISOString(),
            partnerEmail: otro?.memberEmail || '',
            partnerName: otro?.memberName || perfil?.name || 'Tu compañero',
            partnerAvatarUrl: perfil?.avatarUrl || null
          };
        });
      setOpenCloseouts(pendientes);
      setCloseoutStanding({
        engagement: getEngagement(email, all, meetings, attendances, now),
        reciprocity: getReciprocity(email, all, meetings, attendances, now),
        veracity: getVeracity(email, all, meetings, attendances, now),
        monthlyLies: getMonthlyLies(email, all, meetings, attendances, now),
        provenLies: getProvenLies(email, all, meetings, attendances, now).length,
        patternStrikes: getPatternStrikes(email, all, meetings, attendances, now),
        blockedForLying: isBlockedForLying(email, all, meetings, attendances, now)
      });
      setCloseoutPraise(
        getPraiseReceived(email, all, meetings, attendances, now).map(p => p.praise)
      );
      return;
    }

    const [pend, standing, praise] = await Promise.all([
      supabase.rpc('my_open_closeouts'),
      supabase.rpc('my_closeout_standing'),
      supabase.rpc('my_closeout_praise', { p_limit: 5 })
    ]);
    if (!pend.error && pend.data) {
      setOpenCloseouts(pend.data.map(d => ({
        meetingId: d.meeting_id,
        startsAt: d.starts_at,
        closesAt: d.closes_at,
        partnerEmail: d.partner_email,
        partnerName: d.partner_name || 'Tu compañero',
        partnerAvatarUrl: d.partner_avatar_url
      })));
    }
    if (!standing.error && standing.data) {
      const row = Array.isArray(standing.data) ? standing.data[0] : standing.data;
      setCloseoutStanding(row ? {
        engagement: row.engagement_pct,
        // El servidor la devuelve en porcentaje y la lógica pura la espera 0..1.
        reciprocity: row.reciprocity_pct === null || row.reciprocity_pct === undefined
          ? null : row.reciprocity_pct / 100,
        veracity: row.veracity_pct === null || row.veracity_pct === undefined
          ? 1 : row.veracity_pct / 100,
        monthlyLies: row.monthly_lies ?? 0,
        provenLies: row.proven_lies ?? 0,
        patternStrikes: row.pattern_strikes ?? 0,
        blockedForLying: !!row.blocked_for_lying
      } : null);
    }
    if (!praise.error && praise.data) setCloseoutPraise(praise.data.map(p => p.praise));
  };

  // `members` entra en las dependencias porque el nombre y la foto del compañero
  // que muestra la tarjeta de cierre salen de ahí: sin esto, quien actualizaba
  // su avatar seguía apareciendo con el viejo en el pendiente de la otra persona
  // hasta que cambiara alguna reunión por otro motivo.
  useEffect(() => {
    if (!isLoggedIn || !currentUser) return;
    loadCloseoutState();
  }, [isLoggedIn, currentUser?.email, meetings, attendances, members]);

  // El cupo semanal del asistente arranca en lo que la persona ya eligió, no en
  // el valor base: si no, cada vez que reabre el asistente y guarda, su
  // preferencia se pisaría sola con el número por defecto.
  //
  // Se sincroniza UNA sola vez por usuario. `members` se recarga por muchos
  // motivos ajenos (alguien más entra, alguien cambia su foto) y volver a
  // aplicarlo pisaría el número que la persona está tipeando en ese momento.
  const targetSincronizadoPara = useRef(null);
  useEffect(() => {
    if (!currentUser) return;
    const email = currentUser.email.toLowerCase();
    if (targetSincronizadoPara.current === email) return;
    const mio = members.find(mem => mem.email.toLowerCase() === email);
    if (!mio) return; // todavía no cargó su fila
    targetSincronizadoPara.current = email;
    if (mio.weeklyTarget) setWizardWeeklyTarget(mio.weeklyTarget);
  }, [currentUser?.email, members]);

  // Plazo del cierre en la hora local de quien mira ("mañana 14:30", "hoy
  // 20:00"). Es un dato de urgencia, así que importa el día relativo más que
  // la fecha exacta.
  const closeoutDeadlineLabel = (iso) => {
    const tz = currentUser?.tz || 'UTC';
    const fecha = new Date(iso);
    const dia = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
    const hoy = dia(new Date());
    const manana = dia(new Date(Date.now() + 86400e3));
    const hora = new Intl.DateTimeFormat('es-AR', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
    }).format(fecha);
    const cuando = dia(fecha);
    if (cuando === hoy) return `hoy ${hora}`;
    if (cuando === manana) return `mañana ${hora}`;
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: tz, weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(fecha);
  };

  const openCloseoutForm = (pendiente) => {
    setCloseoutTarget(pendiente);
    setCloseoutAnswers({
      happened: '', engagement: '', learned: '', cordial: true, concern: '', praise: ''
    });
  };
  const closeCloseoutForm = () => {
    setCloseoutTarget(null);
    setCloseoutAnswers(null);
  };
  const closeoutModalRef = useDialogA11y(!!closeoutTarget, closeCloseoutForm);

  const submitCloseout = async () => {
    if (!closeoutTarget || !closeoutAnswers) return;
    const { happened, engagement, learned, cordial, concern, praise } = closeoutAnswers;
    if (!happened || !engagement || !learned) {
      showNotification('Respondé las tres primeras preguntas para poder cerrar la sesión.', 'error');
      return;
    }
    if (!cordial && !concern.trim()) {
      showNotification('Contanos brevemente qué pasó: eso lo lee solo quien administra.', 'error');
      return;
    }

    setCloseoutSubmitting(true);
    try {
      if (useMockDb) {
        const all = loadMockCloseouts();
        if (all.some(c => c.meetingId === closeoutTarget.meetingId &&
                          c.authorEmail.toLowerCase() === currentUser.email.toLowerCase())) {
          showNotification('Ya habías cerrado esta sesión.', 'error');
          return;
        }
        saveMockCloseouts([...all, {
          meetingId: closeoutTarget.meetingId,
          authorEmail: currentUser.email.toLowerCase(),
          subjectEmail: closeoutTarget.partnerEmail.toLowerCase(),
          happened, engagement, learned, cordial,
          concern: concern.trim() || null,
          praise: praise.trim().slice(0, 240) || null,
          createdAt: new Date().toISOString()
        }]);
      } else {
        const { error } = await supabase.rpc('submit_session_closeout', {
          p_meeting_id: closeoutTarget.meetingId,
          p_happened: happened,
          p_engagement: engagement,
          p_learned: learned,
          p_cordial: cordial,
          p_concern: concern.trim() || null,
          p_praise: praise.trim() || null
        });
        if (error) {
          const raw = `${error.message || ''} ${error.details || ''}`;
          showNotification(
            // Con el sobre sellado el cierre solo se congela por plazo, así que
            // este caso ya no debería ocurrir. Se conserva para las instancias
            // que todavía no aplicaron la migración, con un texto que no diga
            // si el compañero contestó o no.
            raw.includes('CLOSEOUT_ALREADY_OPEN')
              ? 'Este cierre ya quedó firme y no se puede modificar.'
              : raw.includes('CLOSEOUT_WINDOW_CLOSED')
                ? 'El plazo para cerrar esta sesión ya venció.'
                : 'No pudimos guardar el cierre. Intentá de nuevo en un momento.',
            'error'
          );
          return;
        }
      }
      closeCloseoutForm();
      // Si el cierre corrigió una ausencia mal puesta por el barrido, la
      // asistencia local quedó vieja: se vuelve a leer para que la persona vea
      // el cambio sin recargar. Es justo el dato que le importa — de eso
      // dependen sus faltas del mes.
      showNotification('¡Gracias! Tu compañero no ve lo que respondiste.', 'success');
      await loadCloseoutState();
      setRoomDataVersion(v => v + 1);
    } finally {
      setCloseoutSubmitting(false);
    }
  };

  // --- ADMINISTRAR MIEMBROS ---
  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!newMemberName || !newMemberEmail) return;
    if (addingMember) return;

    // Dar de alta a otra persona a mano es una acción de administración: la
    // política de INSERT de members la restringe a quien administra la sala.
    if (!isRoomAdmin) {
      showNotification('Solo quien administra la sala puede agregar miembros a mano. Compartí el enlace de invitación para que se registren.', 'error');
      return;
    }

    // El email es la identidad de la persona en toda la app (el emparejamiento,
    // la asistencia y el cierre se cruzan por ahí). Uno mal escrito da de alta a
    // alguien que nunca va a poder entrar, y encima ocupa un lugar en la
    // rotación. Se valida acá para poder decir QUÉ está mal, en vez de mostrar
    // el error crudo que devuelve la base.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newMemberEmail.trim())) {
      showNotification('Ese email no parece válido. Revisalo antes de agregar a la persona.', 'error');
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

    setAddingMember(true);
    try {
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
    } finally {
      setAddingMember(false);
    }
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

      // Darse de baja acá tiene que hacer lo MISMO que darse de baja desde el
      // asistente: borrar los horarios no alcanzaba, las propuestas vivas
      // seguían en pie y del otro lado quedaba gente con una sesión confirmada
      // contra alguien que ya no participa, sin poder reasignarse.
      const caidas = await cancelStaleProposals(null);
      showNotification(
        caidas > 0
          ? `Desactivaste tu participación. Se cancelaron tus ${caidas === 1 ? 'role-play' : `${caidas} role-plays`} para que tus compañeros puedan reasignarse.`
          : 'Has desactivado tu participación. No serás coordinado para los role-plays de esta semana.'
      );
      // Los que quedaron sueltos vuelven al pool ahora mismo.
      if (caidas > 0) triggerWeeklyMatcher({ yaGuardado: 'Registramos tu baja' });
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
  // Marca que esta propuesta está siendo agendada. Es una etiqueta temporal en
  // match_proposals.meeting_id: sirve de cerrojo entre las DOS personas de la
  // dupla, que ven el mismo botón al mismo tiempo.
  const MEET_CLAIM = 'creando';

  const createProposalMeeting = async (proposal) => {
    if (creatingMeetFor === proposal.id) return; // doble clic de la misma persona
    const participantsStr = `${proposal.aName}, ${proposal.bName}`;
    const title = `Roleplay — ${proposal.aName.split(' ')[0]} · ${proposal.bName.split(' ')[0]}`;

    // El botón "Crear Meet" lo ven los dos integrantes. Si ambos lo tocan se
    // creaban DOS eventos y dos reuniones; a la huérfana no entraba nadie y el
    // barrido de asistencia terminaba marcando ausentes a los dos, con la falta
    // correspondiente. Se reclama la propuesta antes de hablar con Google: el
    // UPDATE condicionado a meeting_id NULL solo puede ganarlo uno.
    if (!useMockDb) {
      const { data: claimed, error: claimError } = await supabase
        .from('match_proposals')
        .update({ meeting_id: MEET_CLAIM })
        .eq('id', proposal.id)
        .is('meeting_id', null)
        .select('id');

      if (claimError) {
        showNotification('No pudimos agendar la reunión ahora. Intentá de nuevo en un momento.', 'error');
        return;
      }
      if (!claimed || claimed.length === 0) {
        showNotification(
          'Tu compañero ya está creando el Meet de esta dupla. En unos segundos te aparece el enlace acá.',
          'info'
        );
        setRoomDataVersion(v => v + 1); // traer el enlace cuando esté
        return;
      }
    }
    setCreatingMeetFor(proposal.id);

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
    // Se guarda para poder volver a tocar el evento una vez que la reunión
    // tenga id: el enlace de ingreso de la app lo necesita.
    let calendarEventId = null;

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
        calendarEventId = eventData.id || null;
      } catch (err) {
        console.error('Error al agendar en Google Calendar:', err);
        setSchedulingStatus(null);
        setCreatingMeetFor(null);
        // Se suelta el cerrojo: si quedara puesto, nadie —ni esta persona ni su
        // compañero— podría volver a intentar agendar esta dupla nunca más.
        await supabase.from('match_proposals')
          .update({ meeting_id: null })
          .eq('id', proposal.id)
          .eq('meeting_id', MEET_CLAIM);
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
        // Enlace de ingreso por la app, encabezando el evento de Calendar.
        //
        // Va en un PATCH aparte porque recién acá existe el id de la reunión, y
        // el evento hay que crearlo antes para que Google genere el Meet.
        //
        // No reemplaza al botón "Unirse con Google Meet": ese lo pone Calendar
        // por su cuenta y no se puede sacar mientras el evento tenga
        // conferenceData. Lo que hace es ofrecer un camino visible que sí pasa
        // por la app, que es donde se registra la asistencia. Quien entre por el
        // botón azul sigue sin dejar rastro, y para ese caso está la
        // reincidencia del cierre.
        //
        // sendUpdates=none: es un retoque al evento recién creado, no amerita un
        // segundo mail a las dos personas. Y es fire-and-forget — si falla, el
        // evento queda como antes de este cambio.
        if (calendarEventId && newMeeting.id) {
          const joinUrl = `${window.location.origin}/room/${currentRoomId}?join=${newMeeting.id}`;
          supabase.auth.getSession().then(({ data: s }) => {
            const token = s.session?.provider_token;
            if (!token) return;
            return fetch(
              `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(calendarEventId)}?sendUpdates=none`,
              {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  location: joinUrl,
                  description:
                    `Entrá por acá para que quede registrada tu asistencia:\n${joinUrl}\n\n` +
                    'Ese enlace te lleva al mismo Meet. Si entrás por el botón de Google ' +
                    'Calendar la sesión funciona igual, pero la app no puede registrar que ' +
                    'estuviste y puede contarte una falta.\n\n' +
                    'Videollamada de entrenamiento agendada mediante Sales Arena Matcher.'
                })
              }
            );
          }).catch(err => console.error('No se pudo agregar el enlace de ingreso al evento:', err));
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

    // Vincular la reunión creada a la propuesta: la etiqueta del cerrojo se
    // reemplaza por el id real. Si la reunión no llegó a guardarse, se suelta
    // para que se pueda reintentar.
    if (!useMockDb) {
      await supabase.from('match_proposals')
        .update({ meeting_id: newMeeting.id != null ? String(newMeeting.id) : null })
        .eq('id', proposal.id);
    }
    setCreatingMeetFor(null);
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
      showNotification('Rechazaste la propuesta. Estamos buscándote otro compañero disponible.');
      // Los dos vuelven al pool en este mismo momento: se busca de nuevo ya, sin
      // esperar la pasada del cron.
      triggerWeeklyMatcher({ yaGuardado: 'Registramos tu rechazo' });
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
  //
  // El límite ya no es "mientras siga 'confirmado'" sino la ventana real de la
  // reunión (canRecordJoin). Dos motivos: quien entra 20 min tarde igual deja
  // constancia de que estuvo —el barrido ya lo resolvió, pero la resolución de
  // disputas del cierre usa joined_at como EVIDENCIA—, y al mismo tiempo nadie
  // puede abrir el enlace al día siguiente para fabricarse esa prueba.
  const markJoined = (meeting) => {
    if (!meeting || meeting.id == null || !currentUser) return;
    const mine = attendances.find(a =>
      a.meetingId === meeting.id &&
      a.memberEmail.toLowerCase() === currentUser.email.toLowerCase()
    );
    if (!mine || mine.joinedAt) return; // ya registrado
    if (mine.status === 'cancelado_con_aviso' || mine.status === 'cancelado_tarde') return;
    if (!canRecordJoin(meeting.startsAt, meeting.duration)) return;
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

  // Resuelve el enlace de ingreso que viene del evento de Calendar: deja el
  // registro y manda a Meet.
  //
  // Va por consulta directa en vez de esperar a que cargue toda la sala. Quien
  // llega por acá está tratando de entrar a una llamada que probablemente ya
  // empezó: hacerlo esperar a que se carguen miembros, horarios y propuestas
  // sería empujarlo de vuelta al botón de Calendar, que es justo lo que este
  // camino viene a evitar.
  useEffect(() => {
    if (!joinMeetingId || !isLoggedIn || !currentUser || joinHandledRef.current) return;
    joinHandledRef.current = true;
    // Se limpia antes de intentar: si algo sale mal, el próximo ingreso a la
    // sala no tiene que volver a secuestrar la navegación.
    try { sessionStorage.removeItem(JOIN_STORAGE_KEY); } catch { /* modo privado */ }
    setJoinState('entrando');

    const fallar = (msg) => { setJoinError(msg); setJoinState('error'); };

    (async () => {
      if (useMockDb) {
        const m = meetings.find(x => String(x.id) === String(joinMeetingId));
        if (!m?.meetLink) return fallar('No encontramos esa reunión.');
        markJoined(m);
        window.location.href = m.meetLink;
        return;
      }

      const { data: meeting, error } = await supabase
        .from('meetings')
        .select('id, starts_at, duration, meet_link')
        .eq('id', joinMeetingId)
        .maybeSingle();
      if (error || !meeting) {
        return fallar('No encontramos esa reunión. Puede que se haya cancelado.');
      }
      if (!meeting.meet_link) {
        return fallar('Esa reunión todavía no tiene enlace de Meet.');
      }

      // El registro se intenta, pero nunca frena la entrada: si falla, la
      // persona igual tiene que poder llegar a su sesión.
      if (canRecordJoin(meeting.starts_at, meeting.duration)) {
        const { data: mine } = await supabase
          .from('meeting_attendees')
          .select('id, joined_at, status')
          .eq('meeting_id', meeting.id)
          .ilike('member_email', currentUser.email)
          .maybeSingle();
        const cancelada = mine?.status === 'cancelado_con_aviso' || mine?.status === 'cancelado_tarde';
        if (mine && !mine.joined_at && !cancelada) {
          await supabase.from('meeting_attendees')
            .update({ joined_at: new Date().toISOString() })
            .eq('id', mine.id);
        }
      }
      window.location.href = meeting.meet_link;
    })().catch(() => fallar('No pudimos abrir la reunión. Probá de nuevo en un momento.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinMeetingId, isLoggedIn, currentUser]);

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
    // Con 'cancelado', ambos vuelven al pool: pueden reasignarse con otro
    // compañero y también volver a coincidir ENTRE ELLOS en otro horario, que
    // es lo único que 'cancelado' no bloquea (solo un rechazo cierra la dupla).
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

    // Se busca reemplazo en el acto. Sin esto había que esperar al cron: el
    // horario quedaba libre para los dos pero la pantalla no mostraba nada
    // nuevo hasta 10 minutos después.
    if (linkedProposal) {
      triggerWeeklyMatcher({ yaGuardado: 'Registramos tu cancelación' });
    }
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

  // Toda edición de la grilla guarda antes el estado anterior. Sin esto, un
  // arrastre que se fue de largo solo se arreglaba con Limpiar y empezar de
  // cero — perdiendo también todo lo que ya estaba bien cargado.
  const pushGridHistory = () => {
    setGridHistory(prev => [...prev.slice(-HISTORY_LIMIT + 1), wizardGrid]);
  };

  const undoGridChange = () => {
    setGridHistory(prev => {
      if (!prev.length) return prev;
      setWizardGrid(prev[prev.length - 1]);
      return prev.slice(0, -1);
    });
  };

  // ⌘Z / Ctrl+Z mientras se edita la grilla. Solo en el paso 3 y solo fuera de
  // un campo de texto, para no pisarle el deshacer propio al input de sesiones.
  useEffect(() => {
    if (activeTab !== 'wizard' || wizardStep !== 3) return;
    const onKeyDown = (e) => {
      if (e.key !== 'z' && e.key !== 'Z') return;
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      undoGridChange();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, wizardStep]);

  const handleCellMouseDown = (dayIdx, hour, e) => {
    setIsMouseDown(true);
    const exists = wizardGrid.some(s => s.dayIdx === dayIdx && s.hour === hour);
    const active = !exists;
    setDragMode(active);
    pushGridHistory();
    // Un trazo entero es UNA acción: el historial se apila al apretar, no en
    // cada celda que se pinta al pasar.
    setDragInfo({ active, touched: [{ dayIdx, hour }], x: e?.clientX ?? 0, y: e?.clientY ?? 0 });
    toggleCell(dayIdx, hour, active);
  };

  const endCellDrag = () => {
    setIsMouseDown(false);
    setDragInfo(null);
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

  const handleCellMouseEnter = (dayIdx, hour, e) => {
    if (!isMouseDown) return;
    toggleCell(dayIdx, hour, dragMode);
    setDragInfo(prev => {
      if (!prev) return prev;
      const yaTocada = prev.touched.some(t => t.dayIdx === dayIdx && t.hour === hour);
      return {
        ...prev,
        x: e?.clientX ?? prev.x,
        y: e?.clientY ?? prev.y,
        touched: yaTocada ? prev.touched : [...prev.touched, { dayIdx, hour }]
      };
    });
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
    pushGridHistory();
    setWizardGrid([]);
  };

  // Atajos de cabecera: un clic marca un día entero o una franja horaria en los
  // siete días. Cargar "todas las mañanas" pasaba por 21 clics uno por uno.
  const handleDayHeaderClick = (dayIdx) => {
    pushGridHistory();
    setWizardGrid(prev => toggleDayCells(prev, dayIdx, visibleHours(showAllHours)));
  };

  const handleHourHeaderClick = (hour) => {
    pushGridHistory();
    setWizardGrid(prev => toggleHourCells(prev, hour));
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
            backgroundColor: 'rgba(var(--danger-rgb), 0.1)', color: 'var(--color-danger)'
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
          <button type="button" title="Análisis de Llamada" className={`nav-link ${activeTab === 'analisis' ? 'active' : ''}`} aria-current={activeTab === 'analisis' ? 'page' : undefined} onClick={() => handleTabClick('analisis')}>
            <PhoneCall size={17} aria-hidden="true" /> <span className="nav-link-label">Análisis de Llamada</span>
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
            <div className="profile-avatar" style={avatarStyle(currentUser.name)}>
              <AvatarPhoto avatarUrl={currentUser.avatarUrl}>{getInitials(currentUser.name)}</AvatarPhoto>
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
          {/* La reseña va en una fila propia y con relleno sólido: es el único
              botón lleno de todo el pie del menú, así que se distingue de un
              vistazo del resto (Moderar, Guía, Salir), que son acciones de
              mantenimiento. Cuando todavía no hay reseña el botón invita a
              dejarla; cuando ya existe, muestra en qué estado quedó. */}
          <div className="profile-card-actions profile-card-actions-secondary">
            <button
              type="button"
              className={`profile-action-btn profile-review-btn ${myFeedback ? 'has-review' : ''}`}
              onClick={openFeedbackModal}
              title={myFeedback
                ? `Ver o editar tu reseña — ${FEEDBACK_STATUS_LABEL[myFeedback.status] || 'enviada'}`
                : 'Calificar la app y dejar un comentario'}
            >
              {/* La estrella crece hasta llenar el botón al pasar el mouse y el
                  texto se corre para dejarla pasar. Va detrás del texto (no al
                  revés) para que la etiqueta siga legible durante el barrido. */}
              <Star className="profile-review-star" size={14} fill="currentColor" strokeWidth={0} aria-hidden="true" />
              <span className="profile-review-label">
                {myFeedback ? 'Tu reseña' : 'Calificar la app'}
              </span>
              {myFeedback && (
                <span className={`profile-review-dot profile-review-dot-${myFeedback.status}`} aria-hidden="true" />
              )}
            </button>
          </div>
          {isAdmin && (
            <div className="profile-card-actions profile-card-actions-secondary">
              <button
                type="button"
                className="profile-action-btn"
                onClick={openFeedbackReviewModal}
                title="Aprobar o rechazar reseñas para la web pública"
              >
                <Inbox size={13} /> Moderar
                {pendingFeedbackCount > 0 && (
                  <span className="profile-pending-badge">{pendingFeedbackCount}</span>
                )}
              </button>
            </div>
          )}
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
              {activeTab === 'affinity' && 'Afinidad Horaria'}
              {activeTab === 'members' && 'Gestionar Equipo'}
              {activeTab === 'reportes' && 'Reportes y Análisis'}
              {activeTab === 'analisis' && 'Análisis de Llamada'}
            </h2>
            <p className="view-subtitle">
              {activeTab === 'dashboard' && 'Revisa el estado de la sala, coincidencias activas y links de Meet.'}
              {activeTab === 'wizard' && 'Configura tu participación en los role-plays de esta semana en pocos clics.'}
              {activeTab === 'heatmap' && 'Visualiza de forma horaria colectiva en qué momento hay más personas disponibles.'}
              {activeTab === 'affinity' && 'Con quiénes del equipo compartís más horas libres, de mayor a menor.'}
              {activeTab === 'members' && 'Administra quiénes participan del grupo y configura sus correos y países.'}
              {activeTab === 'reportes' && 'Métricas de asistencia y coordinación de la sala, en base a lo que cada participante reporta después de cada sesión.'}
              {activeTab === 'analisis' && 'Tomá notas cronometradas de una llamada de ejemplo, clasificalas por fase y compará con lo que anotó el resto de la sala.'}
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

              {/* REQUIERE TU ACCIÓN.
                  Los cierres y los reportes de asistencia vencen; el resto del
                  panel no. Antes convivían con todo lo demás al mismo peso
                  visual y quedaban terceros y cuartos en una pila de ocho
                  tarjetas iguales. La franja solo existe si hay algo adentro. */}
              {(openCloseouts.length > 0 || pendingReports.filter(({ meeting }) =>
                !openCloseouts.some(c => c.meetingId === meeting.id)).length > 0) && (
                <div className="dash-urgent">
                  <div className="dash-urgent-label">
                    <span className="dash-urgent-dot" aria-hidden="true"></span>
                    Requiere tu acción
                  </div>
              {/* CIERRES DE SESIÓN PENDIENTES.
                  Es lo que reemplaza al viejo "¿se conectó?": pregunta por la
                  sesión entera, no solo por la presencia, y lo responden los
                  dos por separado sin verse. */}
              {openCloseouts.length > 0 && (
                <div className="attendance-prompts">
                  {openCloseouts.map(p => (
                    <div className="closeout-prompt-card glass" key={p.meetingId}>
                      <div className="attendance-prompt-info">
                        <div className="attendance-prompt-avatar" style={avatarStyle(p.partnerName)}>
                          <AvatarPhoto avatarUrl={p.partnerAvatarUrl}>{getInitials(p.partnerName)}</AvatarPhoto>
                        </div>
                        <div>
                          <div className="attendance-prompt-question">
                            Cerrá tu role-play con <strong>{p.partnerName}</strong>
                          </div>
                          <div className="attendance-prompt-meta">
                            <ClipboardCheck size={12} /> 4 preguntas · tenés tiempo hasta {closeoutDeadlineLabel(p.closesAt)}
                          </div>
                        </div>
                      </div>
                      <div className="attendance-prompt-actions">
                        <button type="button" className="btn btn-indigo closeout-prompt-btn" onClick={() => openCloseoutForm(p)}>
                          Responder
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* PROMPTS DE ASISTENCIA PENDIENTES.
                  Respaldo para cuando el barrido automático no llegó a
                  resolver la reunión. Se oculta si esa misma sesión ya tiene
                  un cierre pendiente: preguntar dos veces por lo mismo, con
                  dos formularios distintos, solo confunde. */}
              {pendingReports.filter(({ meeting }) =>
                !openCloseouts.some(c => c.meetingId === meeting.id)).length > 0 && (
                <div className="attendance-prompts">
                  {pendingReports.filter(({ meeting }) =>
                    !openCloseouts.some(c => c.meetingId === meeting.id)
                  ).map(({ meeting, attendance }) => {
                    const reportedMember = members.find(m => m.email.toLowerCase() === attendance.memberEmail.toLowerCase());
                    return (
                    <div className="attendance-prompt-card glass" key={attendance.id}>
                      <div className="attendance-prompt-info">
                        <div className="attendance-prompt-avatar" style={avatarStyle(attendance.memberName)}>
                          <AvatarPhoto avatarUrl={reportedMember?.avatarUrl}>{getInitials(attendance.memberName)}</AvatarPhoto>
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
                  );
                  })}
                </div>
              )}

                </div>
              )}

              {/* LA RESPUESTA. Es la pregunta con la que se entra al panel:
                  ¿con quién practico esta semana? Antes quedaba séptima,
                  debajo de cuatro KPIs que nadie vino a mirar. */}
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
                            <span className="participant-avatar-mini match-avatar-lg" style={avatarStyle(partnerName)}>
                              <AvatarPhoto avatarUrl={partnerMember?.avatarUrl}>{getInitials(partnerName)}</AvatarPhoto>
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
                          {/* El plazo va en la zona del PERFIL, no en la del
                              dispositivo: el resto de la tarjeta ya usa
                              currentUser.tz, y quien viaja veía dos horas
                              distintas para el mismo vencimiento. */}
                          {!isConfirmed && (
                            <div className="match-deadline-chip" title={`Vence el ${new Date(effectiveDeadline).toLocaleString('es-AR', { timeZone: currentUser?.tz || 'UTC' })}`}>
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
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                                <a href={linkedMeeting.meetLink} target="_blank" rel="noopener noreferrer" className="btn btn-indigo" style={{ width: '100%', textDecoration: 'none', boxSizing: 'border-box' }} onClick={() => markJoined(linkedMeeting)}>
                                  <Video size={14} /> Abrir Google Meet
                                </a>
                                {/* Segunda vía para entrar, independiente del
                                    evento automático: ese lo crea quien aceptó
                                    segundo con su permiso de Google, y a la otra
                                    persona le llega como invitación que Google
                                    agrega o no según su configuración. */}
                                {googleCalendarUrl({
                                  title: linkedMeeting.title,
                                  startsAt: linkedMeeting.startsAt,
                                  durationMin: linkedMeeting.duration,
                                  meetLink: linkedMeeting.meetLink
                                }) && (
                                  <a
                                    href={googleCalendarUrl({
                                      title: linkedMeeting.title,
                                      startsAt: linkedMeeting.startsAt,
                                      durationMin: linkedMeeting.duration,
                                      meetLink: linkedMeeting.meetLink
                                    })}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn-add-calendar btn-add-calendar-wide"
                                    title="Agregar este role-play a tu Google Calendar"
                                  >
                                    <CalendarPlus size={13} /> Agregar a mi Google Calendar
                                  </a>
                                )}
                              </div>
                            ) : (
                              <button
                                className="btn btn-indigo"
                                style={{ width: '100%' }}
                                onClick={() => createProposalMeeting(proposal)}
                                disabled={creatingMeetFor === proposal.id}
                              >
                                <Video size={14} />
                                {creatingMeetFor === proposal.id ? 'Creando el Meet...' : 'Crear Meet de la dupla'}
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
                                {/* El evento automático lo crea quien aceptó
                                    segundo, con su permiso de Google; a la otra
                                    persona le llega como invitación y Google la
                                    agrega o no según su configuración. Este
                                    enlace no depende de nada de eso. */}
                                {googleCalendarUrl({
                                  title: meet.title,
                                  startsAt: meet.startsAt,
                                  durationMin: meet.duration,
                                  meetLink: meet.meetLink
                                }) && (
                                  <a
                                    href={googleCalendarUrl({
                                      title: meet.title,
                                      startsAt: meet.startsAt,
                                      durationMin: meet.duration,
                                      meetLink: meet.meetLink
                                    })}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn-add-calendar"
                                    title="Agregar este role-play a tu Google Calendar"
                                  >
                                    <CalendarPlus size={11} /> Agendar
                                  </a>
                                )}
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
              {/* CONTEXTO. Todo lo que sigue es referencia, no titular: se
                  consulta, no se actúa sobre ello al entrar. */}
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

              {/* MI CREDIBILIDAD.
                  Cada quien ve la suya y nada más: nunca la de otro, y nunca
                  quién dijo qué. El compromiso llega ya promediado desde el
                  servidor y los elogios vienen sin autor. */}
              {closeoutStanding && (closeoutStanding.engagement !== null || closeoutPraise.length > 0
                || (closeoutStanding.veracity ?? 1) < 1) && (
                <div className="section-card glass credibility-card">
                  <h4 className="section-title">
                    <Gauge size={15} className="section-title-icon" /> Tu credibilidad
                  </h4>
                  <div className="credibility-grid">
                    <div className="credibility-metric">
                      <span className="credibility-value">
                        {myCredibility ?? '—'}
                        {myCredibility !== null && '%'}
                      </span>
                      <span className="credibility-label">General</span>
                    </div>
                    <div className="credibility-metric">
                      <span className="credibility-value">
                        {getReliability(currentUser.email) ?? '—'}
                        {getReliability(currentUser.email) !== null && '%'}
                      </span>
                      <span className="credibility-label">Asistencia</span>
                    </div>
                    <div className="credibility-metric">
                      <span className="credibility-value">
                        {closeoutStanding.engagement ?? '—'}
                        {closeoutStanding.engagement !== null && '%'}
                      </span>
                      <span className="credibility-label">Compromiso</span>
                    </div>
                    <div className="credibility-metric">
                      <span className="credibility-value">
                        {closeoutStanding.reciprocity === null ? '—' : `${Math.round(closeoutStanding.reciprocity * 100)}%`}
                      </span>
                      <span className="credibility-label">Cierres respondidos</span>
                    </div>
                  </div>
                  <p className="credibility-note">
                    El compromiso lo arman tus compañeros al cerrar cada sesión. Nunca vas a ver qué respondieron,
                    ni ellos lo que respondiste vos. Los cierres empiezan a contar 48hs después de cada reunión,
                    hayan contestado los dos o uno solo.
                  </p>

                  {/* Se avisa con el motivo y el número: una sanción que no se
                      explica se lee como un error de la app. */}
                  {(closeoutStanding.veracity ?? 1) < 1 && (
                    <p className="credibility-warning">
                      <AlertTriangle size={13} />
                      <span>
                        {closeoutStanding.provenLies > 0 && (
                          closeoutStanding.provenLies === 1
                            ? 'Dijiste que una sesión no se hizo, pero el registro muestra que los dos entraron al Meet y tu compañero la dio por hecha. '
                            : `Dijiste que ${closeoutStanding.provenLies} sesiones no se hicieron, pero el registro muestra que los dos entraron al Meet y tu compañero las dio por hechas. `
                        )}
                        {closeoutStanding.patternStrikes > 0 && (
                          'Además venís negando sesiones que tus compañeros dan por hechas, sin haber entrado al Meet desde la app en ninguna. '
                        )}
                        Tu credibilidad queda multiplicada por {Math.round((closeoutStanding.veracity ?? 1) * 100)}% mientras esos cierres sigan en la ventana de 60 días.
                        {closeoutStanding.blockedForLying
                          ? ` Con ${MONTHLY_LIES_LIMIT} comprobadas en el mismo mes quedás fuera de la rotación hasta el 1° del mes que viene.`
                          : ''}
                        {closeoutStanding.patternStrikes > 0 && !closeoutStanding.provenLies
                          ? ' Entrá al Meet desde la app y no desde el botón de Calendar: así queda registrado que estuviste y tu palabra pesa.'
                          : ''}
                      </span>
                    </p>
                  )}
                  {closeoutPraise.length > 0 && (
                    <div className="credibility-praise">
                      <div className="credibility-praise-title"><ThumbsUp size={13} /> Lo que rescataron de vos</div>
                      {closeoutPraise.map((p, i) => (
                        <blockquote className="credibility-praise-item" key={i}>{p}</blockquote>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* KPIs */}
              <div className="metrics-grid">
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(var(--primary-rgb), 0.08)', color: 'var(--color-primary)' }}>
                    <Users size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{activeMembersCount}</span>
                    <span className="kpi-label">{activeMembersCount === 1 ? 'Miembro Activo' : 'Miembros Activos'}</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(var(--neutral-rgb), 0.08)', color: 'var(--text-muted)' }}>
                    <Clock size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{availabilities.length}</span>
                    <span className="kpi-label">{availabilities.length === 1 ? 'Bloque Semanal' : 'Bloques Semanales'}</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.12)', color: 'var(--color-accent)' }}>
                    <Sparkles size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{myLiveProposals.length}</span>
                    <span className="kpi-label">{myLiveProposals.length === 1 ? 'Mi Propuesta Activa' : 'Mis Propuestas Activas'}</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(var(--warning-rgb), 0.12)', color: 'var(--color-warning)' }}>
                    <Video size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{upcomingMeetings.length}</span>
                    <span className="kpi-label">{upcomingMeetings.length === 1 ? 'Meet Próximo' : 'Meets Próximos'}</span>
                  </div>
                </div>
              </div>

              {/* Invitar a la sala. Era una tarjeta con ícono de 40px arriba de
                  todo, con el mismo peso que un cierre que vence — y es algo que
                  se usa una vez en la vida de la sala. Baja a una línea. */}
              <div className="dash-invite">
                <span className="dash-invite-text">
                  <Share2 size={14} aria-hidden="true" />
                  Sumá gente a <strong>{roomName}</strong> con el enlace de la sala.
                </span>
                <button type="button" className="btn-small" onClick={handleCopyRoomInvite}>
                  <Copy size={13} aria-hidden="true" /> Copiar enlace
                </button>
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

                  {/* La zona horaria se detecta del navegador y hasta ahora no
                      había NINGÚN lugar para corregirla. Si la detección erraba,
                      la persona marcaba "9 a 12" y recibía propuestas a otra
                      hora, sin forma de darse cuenta de por qué. Va acá, al
                      inicio del asistente, porque todo lo que sigue —el
                      calendario, el mapa de calor, las propuestas— se
                      interpreta con este dato. */}
                  <div className="wizard-tz-row">
                    <span className="wizard-tz-current">
                      <Globe size={13} aria-hidden="true" />
                      Tus horarios se leen en <strong>{tzCity(currentUser?.tz)}</strong>
                    </span>
                    {editingTz ? (
                      <div className="wizard-tz-edit">
                        <select
                          className="form-input"
                          aria-label="Elegí tu país o zona horaria"
                          value={ZONAS.some(z => z.tz === currentUser?.tz) ? currentUser.tz : ''}
                          onChange={(e) => saveMyTimezone(e.target.value)}
                          disabled={savingTz}
                        >
                          <option value="" disabled>
                            {ZONAS.some(z => z.tz === currentUser?.tz)
                              ? 'Elegí tu país...'
                              : `Detectada: ${tzCity(currentUser?.tz)}`}
                          </option>
                          {ZONAS.map(z => (
                            <option key={z.tz} value={z.tz}>{z.flag} {z.country}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn-small"
                          onClick={() => setEditingTz(false)}
                          disabled={savingTz}
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="btn-small" onClick={() => setEditingTz(true)}>
                        No es mi zona
                      </button>
                    )}
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
                  {/* Decir el tope acá evita el malentendido de fondo: marcar
                      muchas horas NO agenda muchas sesiones. Sin esta frase la
                      gente marcaba el día entero creyendo que era necesario. */}
                  <p className="wizard-desc" style={{ fontSize: '12px', margin: 0 }}>
                    Marcá las horas en las que podrías hacer un role-play. Son opciones, no
                    compromisos: de todas las que marques se van a usar solo las que hagan falta
                    para llegar a la cantidad que elijas abajo.
                  </p>

                  {/* Cuántas sesiones querés es una pregunta DISTINTA de cuándo
                      podés, y antes se deducía de la segunda: quien marcaba el
                      día entero recibía una propuesta por hora. Preguntarlo de
                      frente evita ese malentendido y saca el tope fijo que le
                      quedaba corto a quien tiene tiempo. */}
                  <div className="weekly-target-row">
                    <label className="weekly-target-label" htmlFor="weekly-target">
                      <Target size={13} aria-hidden="true" />
                      ¿Cuántos role-plays querés por semana?
                    </label>
                    <div className="weekly-target-control">
                      <button
                        type="button"
                        className="weekly-target-step"
                        onClick={() => setWizardWeeklyTarget(n => Math.max(1, n - 1))}
                        disabled={wizardWeeklyTarget <= 1}
                        aria-label="Uno menos"
                      >−</button>
                      <input
                        id="weekly-target"
                        type="number"
                        className="weekly-target-input"
                        min="1"
                        max="168"
                        value={wizardWeeklyTarget}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          setWizardWeeklyTarget(Number.isNaN(n) ? 1 : Math.min(168, Math.max(1, n)));
                        }}
                      />
                      <button
                        type="button"
                        className="weekly-target-step"
                        onClick={() => setWizardWeeklyTarget(n => Math.min(168, n + 1))}
                        aria-label="Uno más"
                      >+</button>
                    </div>
                  </div>
                  {(() => {
                    const g = goalState(wizardGrid.length, wizardWeeklyTarget);
                    const horas = `${wizardGrid.length} ${wizardGrid.length === 1 ? 'hora' : 'horas'}`;
                    const sesiones = `${wizardWeeklyTarget} ${wizardWeeklyTarget === 1 ? 'sesión' : 'sesiones'}`;
                    const comodo = wizardWeeklyTarget * 3;
                    return (
                      <div className={`wizard-goal wizard-goal-${g.tone}`}>
                        <div className="wizard-goal-head">
                          <span className="wizard-goal-count">
                            <b>{horas}</b> marcadas para <b>{sesiones}</b>
                          </span>
                          <span className="wizard-goal-label">
                            {g.tone === 'good' && <Check size={13} aria-hidden="true" />}
                            {g.tone === 'short' && <AlertCircle size={13} aria-hidden="true" />}
                            {g.label}
                          </span>
                        </div>
                        <div
                          className="wizard-goal-bar"
                          role="progressbar"
                          aria-valuenow={g.pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label="Cobertura de tu disponibilidad"
                        >
                          <div className="wizard-goal-fill" style={{ width: `${g.pct}%` }}></div>
                        </div>
                        <p className="wizard-goal-hint">
                          {g.tone === 'short' && `Necesitás al menos ${wizardWeeklyTarget} ${wizardWeeklyTarget === 1 ? 'hora' : 'horas'} para que haya dónde ubicarlas.`}
                          {g.tone === 'ok' && `Con ${comodo} horas el emparejador tiene alternativas al cruzar con la agenda del resto.`}
                          {g.tone === 'good' && 'Lo que marcaste de más da margen, no compromiso: se usan solo las horas que hagan falta.'}
                        </p>
                      </div>
                    );
                  })()}

                  <div className="editor-toolbar">
                    <span className="tz-chip" title="Tus horarios se guardan en esta zona horaria">
                      <Globe size={12} /> {tzCity(currentUser?.tz)}
                    </span>
                    <span className="hours-counter">
                      <Clock size={12} /> {wizardGrid.length} {wizardGrid.length === 1 ? 'hora seleccionada' : 'horas seleccionadas'}
                    </span>
                  </div>

                  {/* Los atajos "Laboral 9–18", "Mañanas" y "Noches" se
                      quitaron: marcaban 45, 28 y 28 horas de una, y empujaban a
                      declarar una disponibilidad que no era real. Además hacían
                      creer que había que elegir un "tipo" de horario. Marcar a
                      mano las horas que de verdad sirven es más claro y da
                      mejores coincidencias. Queda solo el borrado, que no
                      interpreta nada. */}
                  {(wizardGrid.length > 0 || gridHistory.length > 0) && (
                    <div className="preset-bar">
                      <button
                        type="button"
                        className="preset-btn"
                        onClick={undoGridChange}
                        disabled={gridHistory.length === 0}
                        title="Deshacer el último cambio (⌘Z)"
                      >
                        <RotateCcw size={12} /> Deshacer
                      </button>
                      <button type="button" className="preset-btn preset-btn-clear" onClick={clearAllCells} disabled={wizardGrid.length === 0} title="Borrar toda la selección">
                        <Eraser size={12} /> Limpiar
                      </button>
                    </div>
                  )}

                  <div className="editor-grid-scroll" onMouseLeave={endCellDrag} onMouseUp={endCellDrag}>
                    <table className="editor-table">
                      <thead>
                        <tr>
                          <th className="editor-th editor-th-hour">Hora</th>
                          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d, i) => (
                            <th key={d} className={`editor-th ${i >= 5 ? 'weekend' : ''}`}>
                              <button
                                type="button"
                                className="editor-head-btn"
                                onClick={() => handleDayHeaderClick(i)}
                                aria-label={`Marcar o borrar todas las horas visibles del ${DIAS[i]}`}
                              >
                                {d}
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: 24 }).map((_, h) => {
                          if (!showAllHours && (h < 6)) return null;
                          return (
                            <tr key={h}>
                              <td className="editor-hour-label">
                                <button
                                  type="button"
                                  className="editor-head-btn"
                                  onClick={() => handleHourHeaderClick(h)}
                                  aria-label={`Marcar o borrar las ${String(h).padStart(2, '0')}:00 en los siete días`}
                                >
                                  {String(h).padStart(2, '0')}:00
                                </button>
                              </td>
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
                                    onMouseDown={(e) => handleCellMouseDown(d, h, e)}
                                    onMouseEnter={(e) => handleCellMouseEnter(d, h, e)}
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

                  {/* Lectura en vivo del trazo. Sigue al puntero y se voltea
                      cerca del borde derecho para no salirse de la pantalla. */}
                  {dragInfo && dragInfo.touched.length > 0 && (
                    <div
                      className={`wizard-drag-badge ${dragInfo.active ? '' : 'is-erasing'}`}
                      style={{
                        left: dragInfo.x,
                        top: dragInfo.y,
                        transform: dragInfo.x > window.innerWidth - 240 ? 'translate(-100%, 20px)' : 'translate(16px, 20px)'
                      }}
                      aria-hidden="true"
                    >
                      {!dragInfo.active && 'Borrando · '}
                      {describeDrag(dragInfo.touched)}
                    </div>
                  )}

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
              { max: 0.25, bg: 'rgba(var(--accent-rgb), 0.18)',      ink: 'var(--text-main)',  label: 'Hasta 25%' },
              { max: 0.5,  bg: 'rgba(var(--accent-rgb), 0.38)',      ink: 'var(--text-main)',  label: '26–50%' },
              // Niveles 3 y 4: el verde ya es lo bastante saturado en claro y oscuro
              // como para que el texto oscuro pierda contraste sobre fondo oscuro (bg-main).
              // Blanco funciona en ambos temas para estos dos escalones.
              { max: 0.75, bg: 'rgba(var(--accent-rgb), 0.62)',      ink: '#ffffff',           label: '51–75%' },
              { max: 1,    bg: 'rgba(var(--accent-rgb), 0.9)',       ink: '#ffffff',           label: 'Más de 75%' },
            ];
            const levelFor = (count) => {
              const ratio = totalActive ? count / totalActive : 0;
              if (ratio === 0) return HEATMAP_LEVELS[0];
              return HEATMAP_LEVELS.find(l => ratio <= l.max) || HEATMAP_LEVELS[HEATMAP_LEVELS.length - 1];
            };

            // La franja más concurrida. La app ya tenía el dato y hacía que se
            // dedujera mirando 168 celdas: ahora lo dice. Ante empate gana la
            // más temprana de la semana, que es el orden en que se recorre.
            let pico = null;
            for (let d = 0; d < 7; d++) {
              for (let h = 0; h < 24; h++) {
                const celda = heatmap[d]?.[h];
                if (celda && celda.count > (pico?.count ?? 0)) pico = { day: d, hour: h, count: celda.count };
              }
            }

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

                  {/* La conclusión, antes de la tabla. Era el dato que uno viene
                      a buscar y había que deducirlo de 168 celdas. */}
                  {pico && (
                    <button
                      type="button"
                      className="heatmap-lead"
                      onClick={() => setSelectedHeatmapCell({ day: pico.day, hour: pico.hour })}
                    >
                      <Flame size={16} aria-hidden="true" />
                      <span>
                        La franja con más gente libre es el <strong>{DIAS[pico.day].toLowerCase()} a las {String(pico.hour).padStart(2, '0')}:00</strong>
                        {' · '}{pico.count} de {totalActive} {totalActive === 1 ? 'persona' : 'personas'}
                      </span>
                      <ChevronRight size={15} aria-hidden="true" />
                    </button>
                  )}

                  {/* SCALE LEGEND: la única forma antes era el tooltip, ahora la escala es siempre visible */}
                  <div className="heatmap-legend" role="img" aria-label="Escala de disponibilidad: de nadie a más del 75% del equipo">
                    {HEATMAP_LEVELS.map(l => (
                      <div className="heatmap-legend-item" key={l.label}>
                        <span className="heatmap-legend-swatch" style={{ backgroundColor: l.bg === 'transparent' ? 'var(--bg-card-hover)' : l.bg }}></span>
                        <span className="heatmap-legend-text">{l.label}</span>
                      </div>
                    ))}
                    {/* La marca propia se explica acá y no en un tooltip: el
                        borde no significa nada por sí solo la primera vez. */}
                    <div className="heatmap-legend-item">
                      <span className="heatmap-legend-swatch heatmap-legend-swatch-mine"></span>
                      <span className="heatmap-legend-text">Tus horas</span>
                    </div>
                  </div>

                  <div className="table-responsive-wrapper">
                    {/* Navegación tipo grilla: una sola parada de tabulación para
                        las 168 celdas (antes eran 168, imposible de atravesar con
                        teclado) y flechas/Inicio/Fin para moverse dentro. */}
                    <table className="heatmap-table" onKeyDown={handleHeatmapKeyDown}>
                      <thead>
                        <tr>
                          <th scope="col" className="heatmap-th" style={{ width: '60px' }}>Hora</th>
                          {DIAS.map(d => (
                            <th scope="col" className="heatmap-th" key={d}>{d.substring(0, 3)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: 24 }).map((_, h) => (
                          <tr key={h}>
                            <th scope="row" className="heatmap-td-hour">{String(h).padStart(2, '0')}:00</th>
                            {Array.from({ length: 7 }).map((_, d) => {
                              const cellData = heatmap[d]?.[h] || { count: 0, names: '', mine: false };
                              const level = levelFor(cellData.count);
                              const isSelected = selectedHeatmapCell?.day === d && selectedHeatmapCell?.hour === h;
                              // Sin celda elegida, la única tabulable es la primera.
                              const isTabStop = selectedHeatmapCell ? isSelected : (d === 0 && h === 0);

                              return (
                                <td key={d} className="heatmap-cell-wrap">
                                  <button
                                    type="button"
                                    data-heatmap-cell={`${d}-${h}`}
                                    tabIndex={isTabStop ? 0 : -1}
                                    className={`heatmap-cell-btn ${isSelected ? 'selected' : ''} ${cellData.mine ? 'is-mine' : ''}`}
                                    style={{ backgroundColor: level.bg, color: level.ink }}
                                    onClick={() => setSelectedHeatmapCell({ day: d, hour: h })}
                                    aria-pressed={isSelected}
                                    aria-label={`${DIAS[d]} ${String(h).padStart(2, '0')}:00 — ${cellData.count === 0 ? 'nadie disponible' : `${cellData.count} ${cellData.count === 1 ? 'persona disponible' : 'personas disponibles'}`}${cellData.mine ? ', marcaste esta hora' : ''}`}
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
                      Funciona con click, teclado (Enter/Espacio en el botón) y touch (tap).
                      Los datos se leen del heatmap ACTUAL, no de una copia hecha en el
                      click: si el mapa se recalcula, el panel se actualiza con él. */}
                  <div className="heatmap-detail-panel" aria-live="polite">
                    {selectedHeatmapCell ? (() => {
                      const sel = heatmap[selectedHeatmapCell.day]?.[selectedHeatmapCell.hour] || { count: 0, names: '' };
                      const when = `${DIAS[selectedHeatmapCell.day]} ${String(selectedHeatmapCell.hour).padStart(2, '0')}:00`;
                      return sel.count > 0 ? (
                        <>
                          <div className="heatmap-detail-title">
                            <Clock size={13} /> {when} · {sel.count} {sel.count === 1 ? 'persona disponible' : 'personas disponibles'}
                          </div>
                          <div className="heatmap-detail-names">{sel.names}</div>
                        </>
                      ) : (
                        <div className="heatmap-detail-title heatmap-detail-empty">
                          <Clock size={13} /> {when} · Nadie disponible en ese bloque
                        </div>
                      );
                    })() : (
                      <div className="heatmap-detail-placeholder">Elegí un bloque de la grilla para ver quiénes están disponibles.</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* VIEW: AFFINITY */}
          {activeTab === 'affinity' && (() => {
            // Una sola rampa de intensidad para toda la app (--ramp-*): antes
            // esta pantalla tenía su propia escala gris→naranja→verde, que no
            // se parecía a la del Mapa de Calor ni a la del medidor.
            const nivelAfinidad = (pct) => {
              if (pct >= 70) return { bg: 'var(--ramp-4)', ink: '#09090b' };
              if (pct >= 45) return { bg: 'var(--ramp-3)', ink: '#09090b' };
              if (pct >= 20) return { bg: 'var(--ramp-2)', ink: 'var(--text-main)' };
              return { bg: 'var(--ramp-1)', ink: 'var(--text-main)' };
            };

            const miFila = affinity.find(row => row.email?.toLowerCase() === currentUser.email.toLowerCase());
            // Ordenada de mayor a menor y COMPLETA. Antes se mostraba una
            // tabla-matriz de N columnas para una sola fila —una lista
            // disfrazada de matriz— y debajo la misma información otra vez
            // recortada al top 2.
            //
            // pct null es la celda de uno consigo mismo (i === j en el cálculo),
            // no "sin horas": se descarta. Un 0 sí es un dato real — no hay
            // ninguna hora en común, sea porque no se cruzan o porque alguno de
            // los dos todavía no cargó nada.
            const companeros = (miFila?.stats || [])
              .filter(s => s.pct !== null)
              .sort((a, b) => b.pct - a.pct);
            const sinCruce = companeros.filter(s => s.pct === 0).length;
            const mejor = companeros.find(s => s.pct > 0) || null;

            return (
            <div className="section-card glass">
              <h4 className="section-title">
                <Handshake size={15} className="section-title-icon" />
                Tu Solapamiento Horario con el Equipo
              </h4>
              <p className="section-subtitle" style={{ margin: 0 }}>
                Cuánto se solapan tus horas con las de cada compañero. El detalle hora por hora de todo el equipo está en el Mapa de Calor.
              </p>

              {/* La conclusión primero: la app ya la tenía calculada y hacía
                  que la dedujeras de la tabla. */}
              {mejor && (
                <div className="affinity-lead">
                  <Trophy size={16} aria-hidden="true" />
                  <span>
                    Con quien más coincidís es <strong>{mejor.name}</strong>, en un <strong>{mejor.pct}%</strong> de tus horas.
                  </span>
                </div>
              )}

              {companeros.length === 0 && (
                <div className="empty-state">
                  <Users size={30} />
                  <span className="empty-state-title">Todavía no hay compañeros activos</span>
                  <span className="empty-state-desc">Cuando se sumen más personas a la sala, vas a ver acá con quién más coincidís.</span>
                </div>
              )}

              {companeros.length > 0 && !mejor && (
                <div className="empty-state">
                  <AlertCircle size={30} />
                  <span className="empty-state-title">Aún sin coincidencias horarias</span>
                  <span className="empty-state-desc">Por ahora ningún compañero comparte horas libres con las tuyas. Cargá más franjas en "Cargar Disponibilidad" para aumentar tus chances.</span>
                </div>
              )}

              {mejor && (
                <ul className="affinity-list">
                  {companeros.map(s => {
                    const nivel = nivelAfinidad(s.pct);
                    const compa = members.find(m => m.email.toLowerCase() === s.email.toLowerCase());
                    return (
                      <li className={`affinity-row ${s.pct === 0 ? 'affinity-row-empty' : ''}`} key={s.email || s.name}>
                        <span className="participant-avatar-mini" style={avatarStyle(s.name)}>
                          <AvatarPhoto avatarUrl={compa?.avatarUrl}>{getInitials(s.name)}</AvatarPhoto>
                        </span>
                        <span className="affinity-row-name">{s.name}</span>
                        <span className="affinity-bar">
                          {s.pct > 0 && (
                            <span className="affinity-bar-fill" style={{ width: `${s.pct}%`, backgroundColor: nivel.bg }}></span>
                          )}
                        </span>
                        <span className="affinity-row-pct">{s.pct}%</span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {mejor && sinCruce > 0 && (
                <p className="section-subtitle" style={{ margin: 0 }}>
                  {sinCruce === 1
                    ? 'Con un compañero no compartís ninguna hora todavía: puede ser que sus franjas no se crucen con las tuyas, o que aún no haya cargado ninguna.'
                    : `Con ${sinCruce} compañeros no compartís ninguna hora todavía: puede ser que sus franjas no se crucen con las tuyas, o que aún no hayan cargado ninguna.`}
                </p>
              )}
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
                      <div className="member-row-avatar" style={avatarStyle(m.name)}>
                        <AvatarPhoto avatarUrl={m.avatarUrl}>{getInitials(m.name)}</AvatarPhoto>
                      </div>
                      <div className="member-row-info">
                        {/* Antes esta linea llevaba hasta cinco distintivos a la
                            vez —bandera, "Tu", participa/excluido, confiabilidad
                            y un candado— compitiendo entre si. Cuando todo esta
                            destacado, nada lo esta. Queda el nombre y un estado;
                            la bandera baja junto al pais que ya figura abajo y
                            la confiabilidad pasa al margen derecho. */}
                        <span className="member-row-name">
                          {m.name}
                          {isSelf && <span className="member-badge-self">Tú</span>}
                          <span className={m.active ? 'member-badge-active' : 'member-badge-inactive'}>
                            {m.active ? 'Participa' : 'Excluido'}
                          </span>
                        </span>
                        {/* El email es un dato de contacto personal y en el
                            padrón no cumple ninguna función: para practicar con
                            alguien alcanza con su nombre. Se muestra solo a la
                            propia persona y a quien administra la sala, que lo
                            necesita para dar de baja o corregir una ficha. */}
                        {(isSelf || isRoomAdmin) && (
                          <span className="member-row-details"><Mail size={11} /> {m.email}</span>
                        )}
                        <span className="member-row-details">
                          <span className="participant-flag" title={m.country}>{getCountryFlag(m.country)}</span>
                          {m.country} · {tzCity(m.tz)}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <ReliabilityBadge pct={getReliability(m.email)} />
                        {isSelf && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: 'var(--t-small)', color: 'var(--text-muted)' }}>Participa:</span>
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

                  <button type="submit" className="btn btn-indigo" style={{ marginTop: '8px', width: '100%' }} disabled={addingMember}>
                    <UserPlus size={16} /> {addingMember ? 'Agregando...' : 'Agregar a la Sala'}
                  </button>
                </form>
              </div>

            </div>
          )}

          {activeTab === 'reportes' && (
            <div>
              {/* El descargo abria la pantalla con cinco lineas antes de mostrar
                  un solo dato. Es necesario, pero no es el titular: pasa a un
                  desplegable que sigue estando a un clic. */}
              <details className="reportes-nota">
                <summary>
                  <BarChart3 size={14} aria-hidden="true" />
                  Cómo se calculan estos números
                </summary>
                <p>
                  Salen de lo que cada participante reporta después de cada sesión (asistió, llegó tarde, no se presentó). La app no accede al contenido de las videollamadas: su función es coordinar los emparejamientos, no analizarlos. Un mes puntual con problemas de conexión no te perjudica frente al resto de la sala: estos números son para tu propia referencia, no un ranking público.
                </p>
              </details>

              {/* KPIs personales */}
              <h4 className="section-title" style={{ marginBottom: '12px' }}>
                <Award size={15} className="section-title-icon" />
                Tu Actividad
              </h4>
              <div className="metrics-grid" style={{ marginBottom: '28px' }}>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(var(--primary-rgb), 0.08)', color: 'var(--color-primary)' }}>
                    <ShieldCheck size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{getReliability(currentUser.email) !== null ? `${getReliability(currentUser.email)}%` : '—'}</span>
                    <span className="kpi-label">Tu Confiabilidad (60 días)</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.12)', color: 'var(--color-accent)' }}>
                    <Handshake size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{mySessionsCompleted}</span>
                    <span className="kpi-label">Sesiones Completadas</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: getMonthlyFaltas(currentUser.email) > 0 ? 'rgba(var(--danger-rgb), 0.1)' : 'rgba(var(--neutral-rgb), 0.08)', color: getMonthlyFaltas(currentUser.email) > 0 ? 'var(--color-danger)' : 'var(--text-muted)' }}>
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
              {/* Los cuatro numeros de la sala son contexto, no titular: entre
                  "Tu confiabilidad" y "Role-players en la sala" no habia ninguna
                  diferencia visual aunque uno es sobre vos y el otro no. Bajan a
                  una fila secundaria. */}
              <div className="room-stats">
                <div className="room-stat">
                  <span className="room-stat-val">{meetingsThisMonth.length}</span>
                  <span className="room-stat-label">sesiones este mes</span>
                </div>
                <div className="room-stat">
                  <span className="room-stat-val">{roomReliability !== null ? `${roomReliability}%` : '—'}</span>
                  <span className="room-stat-label">confiabilidad de la sala</span>
                </div>
                <div className="room-stat">
                  <span className="room-stat-val">{members.length}</span>
                  <span className="room-stat-label">{members.length === 1 ? 'role-player' : 'role-players'}</span>
                </div>
                <div className="room-stat">
                  <span className={`room-stat-val ${blockedMembersCount > 0 ? 'is-warn' : ''}`}>{blockedMembersCount}</span>
                  <span className="room-stat-label">sin emparejamiento este mes</span>
                </div>
              </div>
              <p className="section-subtitle" style={{ margin: '0 0 24px' }}>
                "Sin emparejamiento este mes" cuenta a quienes acumularon 3+ ausencias o cancelaciones tardías en el mes en curso: vuelven a la rotación automáticamente el mes que viene. Solo si ese patrón se repite en {CHRONIC_BLOCK_THRESHOLD} meses distintos, la cuenta pierde el acceso a esta sala.
              </p>

            </div>
          )}

          {/* VIEW: ANÁLISIS DE LLAMADA */}
          {activeTab === 'analisis' && (
            <CallAnalysisView
              supabase={supabase}
              useMockDb={useMockDb}
              roomId={currentRoomId}
              currentUser={currentUser}
            />
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
            {/* A quien no administra esta sala se le explica por qué solo ve el
                formulario de crear la suya. Sin esta línea, el modal se abre
                casi vacío y parece que algo falló. */}
            {!isRoomAdmin && (
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5', paddingBottom: '18px', borderBottom: '1px solid var(--border-color)' }}>
                <strong>{roomName}</strong> la administra quien la creó: renombrarla o eliminarla le corresponde
                a esa persona, porque afecta a todo el equipo. Acá podés crear una sala propia, de la que vas a
                quedar a cargo.
              </p>
            )}

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
                  disabled={codeRotating}
                  title="Genera un código nuevo e invalida los enlaces ya compartidos"
                  style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
                >
                  <RefreshCw size={12} aria-hidden="true" /> {codeRotating ? 'Generando...' : 'Renovar'}
                </button>
              </div>
            </div>
            )}

            {/* Renombrar la sala mueve a TODO el equipo a una URL nueva, así que
                es de quien la administra y de nadie más. La base ya lo impedía
                (rename_room corta con NOT_ROOM_ADMIN), pero mostrarle el
                formulario a un invitado lo invita a romper algo ajeno y a
                comerse un error sin entender por qué. Mismo criterio que el
                bloque del código de acceso, acá arriba. */}
            {isRoomAdmin && (
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
                  <button type="submit" className="btn btn-indigo" style={{ padding: '8px 16px', fontSize: '13px' }} disabled={roomSaving}>
                    {roomSaving ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </form>
            )}

            {/* Formulario 2: Crear Nueva Sala. Abierto a cualquiera: quien la
                crea queda como su dueño y es el único que puede renombrarla o
                borrarla — la sala de otra persona no se toca. */}
            <form onSubmit={handleCreateRoom} style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '20px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Crear Nueva Sala (Desde Cero)</label>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                Al crear una nueva sala con un nombre personalizado, se generará una URL limpia. El nombre debe ser único: no se puede repetir el de otra sala existente. Vas a quedar como quien la administra, y solo vos vas a poder renombrarla o eliminarla.
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
                <button type="submit" className="btn btn-indigo" style={{ padding: '8px 16px', fontSize: '13px' }} disabled={roomSaving}>
                  {roomSaving ? 'Creando...' : 'Crear'}
                </button>
              </div>
            </form>

            {/* Eliminar la sala borra a todos sus miembros y su historial. Que
                un invitado siquiera vea el botón es peor que lo de renombrar:
                lo que ofrece es destruir el espacio de trabajo de otra gente. */}
            {isRoomAdmin && (
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
            )}
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

      {/* MODAL: CALIFICAR LA APP (estrellas + comentario) */}
      {showFeedbackModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="feedback-modal-title"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '20px'
          }}
        >
          <div
            className="glass"
            ref={feedbackModalRef}
            tabIndex={-1}
            style={{
              width: '100%', maxWidth: '440px', backgroundColor: 'var(--bg-sidebar)',
              borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column',
              gap: '16px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', border: '1px solid var(--border-color)',
              boxSizing: 'border-box', position: 'relative'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 id="feedback-modal-title" style={{ margin: 0, fontSize: '17px', fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Star size={17} className="section-title-icon" /> Calificá la app
              </h3>
              <button
                type="button"
                onClick={() => setShowFeedbackModal(false)}
                aria-label="Cerrar"
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', display: 'flex' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Acá iba un aviso de que la reseña pasa por revisión. Se quitó:
                escribir una opinión no debería sentirse como presentar un
                trámite. La moderación sigue igual del lado del servidor —solo
                el administrador de plataforma aprueba lo que se publica—, pero
                eso es asunto nuestro y no una advertencia para quien escribe. */}

            <div className="feedback-star-picker" role="radiogroup" aria-label="Puntuación de 1 a 5 estrellas">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={feedbackRating === n}
                  aria-label={`${n} ${n === 1 ? 'estrella' : 'estrellas'}`}
                  className={`feedback-star-btn ${feedbackRating >= n ? 'filled' : ''}`}
                  onClick={() => setFeedbackRating(n)}
                >
                  <Star size={28} />
                </button>
              ))}
            </div>

            <textarea
              className="form-input"
              rows={4}
              maxLength={600}
              placeholder="Contanos qué te parece la app. Puede aparecer con tu nombre y foto en la web pública."
              value={feedbackComment}
              onChange={(e) => setFeedbackComment(e.target.value)}
              style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box', padding: '10px 14px', fontFamily: 'inherit' }}
            />

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowFeedbackModal(false)}>Cancelar</button>
              <button type="button" className="btn btn-indigo" onClick={submitFeedback} disabled={feedbackSubmitting}>
                {feedbackSubmitting
                  ? <span className="spinner" style={{ width: '14px', height: '14px' }}></span>
                  : <Check size={14} />}
                {myFeedback ? 'Actualizar reseña' : 'Enviar reseña'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: MODERAR RESEÑAS (solo platform admin) */}
      {showFeedbackReviewModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="feedback-review-modal-title"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '20px'
          }}
        >
          <div
            className="glass"
            ref={feedbackReviewModalRef}
            tabIndex={-1}
            style={{
              width: '100%', maxWidth: '560px', maxHeight: '80vh', backgroundColor: 'var(--bg-sidebar)',
              borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column',
              gap: '16px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', border: '1px solid var(--border-color)',
              boxSizing: 'border-box', position: 'relative', overflow: 'hidden'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <h3 id="feedback-review-modal-title" style={{ margin: 0, fontSize: '17px', fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Inbox size={17} className="section-title-icon" /> Moderar reseñas
              </h3>
              <button
                type="button"
                onClick={() => setShowFeedbackReviewModal(false)}
                aria-label="Cerrar"
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', display: 'flex' }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-muted)', flexShrink: 0 }}>
              Solo lo que apruebes acá aparece en sales-arena-matcher.com, con nombre y foto de quien lo escribió.
            </p>

            {/* BANDERAS DEL CIERRE DE SESIÓN.
                Un caso suelto no penaliza a nadie: lo que importa es ver si la
                misma persona reaparece. Por eso se listan en crudo, sin
                convertirlos en un puntaje automático. */}
            {closeoutFlags.length > 0 && (
              <div className="closeout-flags">
                <div className="closeout-flags-title">
                  <AlertCircle size={14} /> Requieren tu criterio ({closeoutFlags.length})
                </div>
                {closeoutFlags.map((f, i) => (
                  <div className={`closeout-flag closeout-flag-${f.kind}`} key={`${f.meeting_id}-${i}`}>
                    <span className="closeout-flag-kind">
                      {f.kind === 'disputa' ? 'Versiones distintas' : 'Trato'}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="closeout-flag-who">{f.subject_email}</div>
                      <div className="closeout-flag-detail">{f.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {feedbackReviewLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px', padding: '20px 0', justifyContent: 'center' }}>
                  <span className="spinner" style={{ width: '16px', height: '16px' }}></span> Cargando reseñas…
                </div>
              ) : feedbackReviewList.length === 0 ? (
                <div className="empty-state">
                  <Inbox size={30} />
                  <span className="empty-state-title">Todavía no hay reseñas</span>
                  <span className="empty-state-desc">Cuando alguien califique la app, va a aparecer acá para que la revises.</span>
                </div>
              ) : feedbackReviewList.map(f => (
                <div key={f.id} className="feedback-review-row">
                  <div className="feedback-review-row-header">
                    <span className="participant-avatar-mini" style={{ width: '32px', height: '32px', fontSize: '12px', ...avatarStyle(f.member_name) }}>
                      <AvatarPhoto avatarUrl={f.avatar_url}>{getInitials(f.member_name)}</AvatarPhoto>
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: '700', fontSize: '13px', color: 'var(--text-main)' }}>{f.member_name}</div>
                      <div className="feedback-review-stars" aria-label={`${f.rating} de 5 estrellas`}>
                        {[1, 2, 3, 4, 5].map(n => (
                          <Star key={n} size={12} className={n <= f.rating ? 'filled' : ''} />
                        ))}
                      </div>
                    </div>
                    <span className={`feedback-status-badge feedback-status-${f.status}`}>
                      {FEEDBACK_STATUS_LABEL[f.status] || f.status}
                    </span>
                  </div>
                  <p className="feedback-review-comment">{f.comment}</p>
                  <div className="feedback-review-actions">
                    <button
                      type="button"
                      className="attendance-btn attendance-btn-yes"
                      disabled={f.status === 'approved'}
                      onClick={() => reviewFeedback(f.id, true)}
                    >
                      <Check size={13} /> Aprobar
                    </button>
                    <button
                      type="button"
                      className="attendance-btn attendance-btn-no"
                      disabled={f.status === 'rejected'}
                      onClick={() => reviewFeedback(f.id, false)}
                    >
                      <X size={13} /> Rechazar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CIERRE DE SESIÓN.
          Lo responden los dos por separado y ninguno ve lo del otro. Son cuatro
          preguntas cortas a propósito: un formulario largo no se completa, y un
          cierre que nadie contesta no mide nada. */}
      {closeoutTarget && closeoutAnswers && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="closeout-title"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '20px'
          }}
        >
          <div
            className="glass closeout-modal"
            ref={closeoutModalRef}
            tabIndex={-1}
            style={{
              width: '100%', maxWidth: '520px', backgroundColor: 'var(--bg-sidebar)',
              borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column',
              gap: '14px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', border: '1px solid var(--border-color)',
              boxSizing: 'border-box', maxHeight: '88vh'
            }}
          >
            <h3 className="section-title" id="closeout-title">
              <ClipboardCheck size={17} className="section-title-icon" />
              Cierre de tu role-play con {closeoutTarget.partnerName}
            </h3>
            <p className="closeout-privacy">
              <Lock size={12} /> {closeoutTarget.partnerName} no va a ver nunca lo que respondas.
              Lo único que se comparte es el elogio final, y recién 48hs después de la reunión.
            </p>

            <div className="closeout-questions">
              {[
                {
                  key: 'happened',
                  label: '¿La sesión se hizo?',
                  // Es la única respuesta que se cruza con la del compañero y con
                  // el registro de ingreso al Meet, así que conviene que quede
                  // claro dónde está el límite: si arrancó y se cayó, es
                  // "se cortó antes" y no cuesta nada. "No se hizo" es para
                  // cuando no hubo sesión.
                  hint: 'Si empezaron y se cortó por lo que sea, elegí "se cortó antes": eso no penaliza a nadie.',
                  options: [
                    { v: 'completa', t: 'Sí, completa' },
                    { v: 'cortada', t: 'Se cortó antes' },
                    { v: 'no_se_hizo', t: 'No se hizo' }
                  ]
                },
                {
                  key: 'engagement',
                  label: `¿Cómo participó ${closeoutTarget.partnerName.split(' ')[0]}?`,
                  options: [
                    { v: 'preparado', t: 'Preparado, sostuvo el role-play' },
                    { v: 'a_medias', t: 'A medias' },
                    { v: 'no_participo', t: 'No participó en serio' }
                  ]
                },
                {
                  key: 'learned',
                  label: '¿Te sirvió para aprender algo?',
                  options: [
                    { v: 'si', t: 'Sí, me llevo algo concreto' },
                    { v: 'mas_o_menos', t: 'Más o menos' },
                    { v: 'no', t: 'No' }
                  ]
                }
              ].map(q => (
                <fieldset className="closeout-question" key={q.key}>
                  <legend className="closeout-question-label">{q.label}</legend>
                  {q.hint && <p className="closeout-question-hint">{q.hint}</p>}
                  <div className="closeout-options">
                    {q.options.map(o => (
                      <button
                        type="button"
                        key={o.v}
                        className={`closeout-option ${closeoutAnswers[q.key] === o.v ? 'selected' : ''}`}
                        aria-pressed={closeoutAnswers[q.key] === o.v}
                        onClick={() => setCloseoutAnswers(a => ({ ...a, [q.key]: o.v }))}
                      >
                        {o.t}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ))}

              <fieldset className="closeout-question">
                <legend className="closeout-question-label">¿El trato fue cordial?</legend>
                <div className="closeout-options">
                  <button
                    type="button"
                    className={`closeout-option ${closeoutAnswers.cordial ? 'selected' : ''}`}
                    aria-pressed={closeoutAnswers.cordial}
                    onClick={() => setCloseoutAnswers(a => ({ ...a, cordial: true, concern: '' }))}
                  >
                    Sí
                  </button>
                  <button
                    type="button"
                    className={`closeout-option ${!closeoutAnswers.cordial ? 'selected' : ''}`}
                    aria-pressed={!closeoutAnswers.cordial}
                    onClick={() => setCloseoutAnswers(a => ({ ...a, cordial: false }))}
                  >
                    Hay algo que reportar
                  </button>
                </div>
                {!closeoutAnswers.cordial && (
                  <textarea
                    className="closeout-textarea"
                    rows={3}
                    maxLength={600}
                    placeholder="¿Qué pasó? Esto lo lee solo quien administra la plataforma."
                    value={closeoutAnswers.concern}
                    onChange={(e) => setCloseoutAnswers(a => ({ ...a, concern: e.target.value }))}
                  />
                )}
              </fieldset>

              <fieldset className="closeout-question">
                <legend className="closeout-question-label">
                  <ThumbsUp size={12} /> Una cosa que rescatás de tu compañero <span className="closeout-optional">(opcional)</span>
                </legend>
                <textarea
                  className="closeout-textarea"
                  rows={2}
                  maxLength={240}
                  placeholder="Esto sí se lo vamos a mostrar, cuando los dos hayan cerrado."
                  value={closeoutAnswers.praise}
                  onChange={(e) => setCloseoutAnswers(a => ({ ...a, praise: e.target.value }))}
                />
              </fieldset>
            </div>

            {/* "Enviar cierre" y no "Cerrar sesión": ese texto se confunde con
                salir de la cuenta, que además es un botón real del menú.
                flexShrink 0: el cuerpo de preguntas scrollea, este pie no se
                comprime — en mobile con el teclado abierto quedaba aplastado. */}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexShrink: 0 }}>
              <button type="button" className="btn btn-secondary" onClick={closeCloseoutForm}>
                Ahora no
              </button>
              <button
                type="button"
                className="btn btn-indigo"
                onClick={submitCloseout}
                disabled={closeoutSubmitting}
              >
                {closeoutSubmitting
                  ? <><span className="spinner" style={{ width: '14px', height: '14px' }}></span> Guardando…</>
                  : <>Enviar cierre</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INGRESO DESDE EL EVENTO DE CALENDAR.
          Tapa la app mientras se registra la asistencia y se redirige a Meet.
          Es deliberadamente un paso en blanco de un segundo: la persona
          clickeó "entrar a la reunión", no vino a navegar la sala. */}
      {joinState && (
        <div
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1100, padding: '20px'
          }}
        >
          <div className="glass join-card">
            {joinState === 'entrando' ? (
              <>
                <span className="spinner"></span>
                <h3 className="join-title">Entrando a tu role-play…</h3>
                <p className="join-desc">Registramos que estuviste y te llevamos a Meet.</p>
              </>
            ) : (
              <>
                <AlertTriangle size={22} style={{ color: 'var(--color-warning)' }} />
                <h3 className="join-title">No pudimos abrir la reunión</h3>
                <p className="join-desc">{joinError}</p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { setJoinState(null); setJoinError(''); }}
                >
                  Ir a la sala
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
