import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { Card, Grade, ImageMode, LibraryData, Mood, PracticeStats, Quote, QuoteEmotion, StoredImage } from './types';
import { getAllImages, loadLibrary, saveImage, saveLibrary } from './storage';
import { IMAGE_MODES, displaySrc, finalizeImage, imageModeLabel, prepareImage, type PreparedImage } from './imageCodec';
import { bleManager } from './ble/BleManager';
import { MAX_FOLDER_BYTES, MAX_TEXT_BYTES, type DeviceInfo, type StorageInfo } from './ble/protocol';
import { ArrowLeftIcon, BluetoothIcon, BookmarkIcon, ChevronRightIcon, CloseIcon, GlassesIcon, ImageIcon, LibraryIcon, PencilIcon, PlayIcon, PlusIcon, SearchIcon, SettingsIcon, ShuffleIcon, TrashIcon, UndoIcon } from './icons';
import { Mascot } from './mascot/Mascot';
import { FloatyText } from './mascot/FloatyText';
import { MOOD_LABELS, dayKey, moodFromUrl, recordPracticeStats } from './mascot/mood';
import { DIRECTOR_RULES, eggDisplay, handleAppOpen, quoteDisplay, resolveQuoteOfTheDay, type Display } from './mascot/director';
import { DAY, GRADE_LABELS, countCards, endOfToday, formatWait, legacyRating, schedule, type DeckCounts } from './study/scheduler';
import { applyGrade, recallRate, shuffled, smartQueue, startSession, type Session, type SessionMode } from './study/session';
import { activeStreak, cardsToday, recordHistory, weekStrip } from './study/progress';
import { Lens, MasteryBar, Switch, WeekStrip } from './ui/parts';
import './styles.css';

type ConnectionState = 'disconnected' | 'connecting' | 'connected';
type CardSide = 'front' | 'back';
type Screen = 'home' | 'folder' | 'study' | 'summary' | 'editor' | 'sync' | 'settings';

type DialogState =
  | { kind: 'prompt'; title: string; label: string; confirm: string; onSubmit: (value: string) => void }
  | { kind: 'confirm'; title: string; body: string; confirm: string; onConfirm: () => void };

/** Everything needed to take back the last answer. */
interface UndoSnapshot {
  session: Session;
  card: Card;
  practice: PracticeStats | undefined;
  history: Record<string, number> | undefined;
}

const GOAL_CHOICES = [5, 10, 20, 30];
/** A session is a small bite (about 5 cards). The day's work is split into bites so it feels easy to start. */
const SECTION_CARDS = 5;
function sectionSize(total: number): number {
  return total <= 0 ? 0 : Math.ceil(total / Math.ceil(total / SECTION_CARDS));
}
const NO_CARDS: Card[] = [];

function newCard(folder = 'OllO'): Card {
  return { id: crypto.randomUUID(), folder, front: '', back: '' };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value.replace(/[\t\r\n]/g, ' ')).length;
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function folderNames(cards: Card[]): string[] {
  return [...new Set(cards.map((card) => card.folder.trim() || 'OllO'))].sort((a, b) => a.localeCompare(b));
}

/** Short text is shown big, long text smaller so a whole answer fits on the card. */
function sizeClass(text: string): string {
  const n = text.length;
  if (n <= 36) return 't-xl';
  if (n <= 110) return 't-lg';
  if (n <= 280) return 't-md';
  return 't-sm';
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function App() {
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [images, setImages] = useState<Map<number, StoredImage>>(new Map());
  const [screen, setScreen] = useState<Screen>('home');
  const [selectedFolder, setSelectedFolder] = useState('OllO');
  const [editorCard, setEditorCard] = useState<Card | null>(null);
  const [editorReturn, setEditorReturn] = useState<'folder' | 'study'>('folder');
  const [studyFrom, setStudyFrom] = useState<'home' | 'folder'>('home');
  const [session, setSession] = useState<Session | null>(null);
  const [finished, setFinished] = useState<Session | null>(null);
  const [revealed, setRevealed] = useState(false);
  /** True once the answer has been seen for the current card, so the grade buttons stay even if the card is flipped back. */
  const [peeked, setPeeked] = useState(false);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [undoSnap, setUndoSnap] = useState<UndoSnapshot | null>(null);
  const [playScope, setPlayScope] = useState<'all' | 'folder' | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState('');
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const [imageMode, setImageMode] = useState<ImageMode>('gray2');
  const [imageTarget, setImageTarget] = useState<CardSide>('front');
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [pendingImage, setPendingImage] = useState<PreparedImage | undefined>();
  const [pickerBusy, setPickerBusy] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>(bleManager.state);
  const [connectionMessage, setConnectionMessage] = useState('Not connected');
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | undefined>(bleManager.info);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | undefined>(bleManager.storage);
  const [syncProgress, setSyncProgress] = useState({ done: 0, total: 0, label: 'Ready to synchronize' });
  const [syncBusy, setSyncBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [viewerSrc, setViewerSrc] = useState<string | undefined>();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const fileInput = useRef<HTMLInputElement>(null);
  // What the yellow quote spot shows right now (quote of the day, one of ollo's own lines, or the Easter egg).
  const [display, setDisplay] = useState<Display | null>(null);
  const libraryRef = useRef<LibraryData | null>(null);
  const screenRef = useRef(screen);
  const previousScreen = useRef(screen);
  const studiedSinceDisplay = useRef(false);
  const pendingOpenDisplay = useRef<Display | null>(null);
  const menuVisits = useRef<number[]>([]);
  const hiddenAt = useRef<number | null>(null);
  /** Cards already answered since the learner last started from the home screen (so "keep going" brings new ones). */
  const seenIds = useRef<Set<string>>(new Set());
  const keyHandlers = useRef({ reveal: () => {}, grade: (_grade: Grade) => {}, undo: () => {}, exit: () => {} });
  const [newQuoteText, setNewQuoteText] = useState('');
  const [newQuoteEmotion, setNewQuoteEmotion] = useState<QuoteEmotion>('auto');

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const loaded = await loadLibrary();
      const storedImages = await getAllImages();
      if (!mounted) return;
      // Every app open: ollo decides whether to speak, show the quote of the day, or fire the Easter egg.
      const opened = handleAppOpen(loaded, Date.now());
      void saveLibrary(opened.library);
      setLibrary(opened.library);
      setDisplay(opened.display);
      setImages(new Map(storedImages.map((image) => [image.id, image])));
      setImageMode(loaded.settings.defaultImageMode);
      const first = folderNames(loaded.cards)[0];
      if (first) setSelectedFolder(first);
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => bleManager.onState((state, message) => {
    setConnection(state);
    setConnectionMessage(message);
  }), []);

  useEffect(() => bleManager.onInfo((info, storage) => {
    setDeviceInfo(info);
    setStorageInfo(storage);
  }), []);

  useEffect(() => bleManager.onProgress((done, total, label) => setSyncProgress({ done, total, label })), []);

  useEffect(() => {
    if (!library?.settings.autoReconnect) return;
    void bleManager.autoReconnect();
    const onFocus = () => { if (document.visibilityState === 'visible') void bleManager.autoReconnect(); };
    window.addEventListener('focus', onFocus);
    let appListener: { remove: () => Promise<void> } | undefined;
    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
        if (isActive) void bleManager.autoReconnect();
      }).then((listener) => { appListener = listener; });
    }
    return () => {
      window.removeEventListener('focus', onFocus);
      void appListener?.remove();
    };
  }, [library?.settings.autoReconnect]);

  // Keeps "due" counts honest while the app sits open.
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Escape closes whichever overlay is on top.
  useEffect(() => {
    if (!viewerSrc && !dialog && !playScope && !showImagePicker && !showAddSheet) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (viewerSrc) setViewerSrc(undefined);
      else if (dialog) setDialog(null);
      else if (playScope) setPlayScope(null);
      else if (showAddSheet) setShowAddSheet(false);
      else closeImagePicker();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerSrc, dialog, playScope, showImagePicker, showAddSheet]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Coming back to the main menu.
  useEffect(() => {
    const came = previousScreen.current !== 'home' && screen === 'home';
    previousScreen.current = screen;
    const current = libraryRef.current;
    if (!came || !current) return;
    const now = Date.now();

    menuVisits.current = [...menuVisits.current.filter((t) => now - t < DIRECTOR_RULES.eggMenuWindowMs), now];
    const eggReady = menuVisits.current.length >= DIRECTOR_RULES.eggMenuVisits;

    if (eggReady) {
      // Easter egg: hopping in and out of the menu to find ollo's other emotions.
      menuVisits.current = menuVisits.current.slice(-(DIRECTOR_RULES.eggMenuVisits - 1));
      pendingOpenDisplay.current = null;
      studiedSinceDisplay.current = false;
      setDisplay(eggDisplay());
      updateLibrary((previous) => ({ ...previous, meta: { ...previous.meta, lastEggAt: now } }));
    } else if (studiedSinceDisplay.current) {
      // The user just studied: back to the quote of the day.
      studiedSinceDisplay.current = false;
      pendingOpenDisplay.current = null;
      const qotd = resolveQuoteOfTheDay(current, now);
      setDisplay(quoteDisplay(current, qotd, now));
      if (qotd.slot !== current.quoteOfTheDay?.slot || qotd.quoteId !== current.quoteOfTheDay?.quoteId) {
        updateLibrary((previous) => ({ ...previous, quoteOfTheDay: qotd }));
      }
    } else if (pendingOpenDisplay.current) {
      setDisplay(pendingOpenDisplay.current);
      pendingOpenDisplay.current = null;
    }
  }, [screen]);

  // Coming back to the app from the background counts as opening it again.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); return; }
      setNowMs(Date.now());
      const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;
      const current = libraryRef.current;
      if (!current || away < 5000) return;
      const opened = handleAppOpen(current, Date.now());
      updateLibrary(() => opened.library);
      if (screenRef.current === 'home' && !studiedSinceDisplay.current) setDisplay(opened.display);
      else pendingOpenDisplay.current = opened.display;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  libraryRef.current = library;
  screenRef.current = screen;
  // ollo's face follows whatever is on screen. ?mood=angry in the URL forces a face for testing.
  const mood: Mood = moodFromUrl() ?? display?.emotion ?? 'neutral';
  const allCards = library?.cards ?? NO_CARDS;
  const goal = library?.settings.dailyGoal ?? 10;
  const folders = useMemo(() => folderNames(allCards), [allCards]);
  const cardsById = useMemo(() => new Map(allCards.map((card) => [card.id, card])), [allCards]);
  const folderCounts = useMemo(() => {
    const map = new Map<string, DeckCounts>();
    for (const folder of folders) map.set(folder, countCards(allCards.filter((card) => card.folder === folder), nowMs));
    return map;
  }, [allCards, folders, nowMs]);
  const homeFolders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return folders.filter((folder) => {
      const matches = !bookmarksOnly || allCards.some((card) => card.folder === folder && card.bookmarked);
      return matches && (!term || folder.toLowerCase().includes(term));
    });
  }, [allCards, folders, bookmarksOnly, search]);
  const searchCards = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return NO_CARDS;
    return allCards.filter((card) => (!bookmarksOnly || card.bookmarked) && `${card.front} ${card.back}`.toLowerCase().includes(term)).slice(0, 50);
  }, [allCards, bookmarksOnly, search]);
  const folderCards = useMemo(() => allCards.filter((card) => card.folder === selectedFolder), [allCards, selectedFolder]);
  const todayAll = useMemo(() => smartQueue(allCards, { size: goal, now: nowMs }), [allCards, goal, nowMs]);
  const todayQueue = useMemo(() => todayAll.slice(0, sectionSize(todayAll.length)), [todayAll]);
  const folderAll = useMemo(() => smartQueue(allCards, { size: goal, now: nowMs, folder: selectedFolder }), [allCards, goal, nowMs, selectedFolder]);
  const folderQueue = useMemo(() => folderAll.slice(0, sectionSize(folderAll.length)), [folderAll]);
  const studyCard = session ? cardsById.get(session.queue[0]) : undefined;
  const faceImage = (card: Card | undefined, side: CardSide): StoredImage | undefined => {
    const id = card ? (side === 'front' ? card.frontImageId : card.backImageId) : undefined;
    return id ? images.get(id) : undefined;
  };
  const allImageRecords = [...images.values()];
  const referencedImageIds = new Set(allCards.flatMap((card) => [card.frontImageId, card.backImageId].filter((id): id is number => typeof id === 'number')));
  const referencedImages = allImageRecords.filter((image) => referencedImageIds.has(image.id));
  const syncedCounts = library?.lastSyncedCounts ?? { cards: 0, images: 0, folders: 0 };
  const freeBytes = storageInfo ? Math.max(0, storageInfo.totalBytes - storageInfo.usedBytes) : undefined;
  const needsSync = !!library?.lastSyncedAt && (allCards.length !== syncedCounts.cards || allCards.some((card) => (card.updatedAt ?? 0) > (library?.lastSyncedAt ?? 0)));

  useEffect(() => {
    if (screen !== 'study' || !studyCard || !library) return;
    const { id, folder } = studyCard;
    if (library.lastStudied?.cardId === id && library.lastCardByFolder?.[folder] === id) return;
    updateLibrary((previous) => ({
      ...previous,
      lastStudied: { folder, cardId: id },
      lastCardByFolder: { ...previous.lastCardByFolder, [folder]: id }
    }));
  }, [screen, studyCard?.id]);

  // Keyboard shortcuts for the study screen: Space reveals, 1-4 grade, Z undoes, Esc leaves.
  useEffect(() => {
    if (screen !== 'study') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.getAttribute('role') === 'button')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const h = keyHandlers.current;
      if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); h.reveal(); }
      else if (event.key >= '1' && event.key <= '4') h.grade(Number(event.key) as Grade);
      else if (event.key.toLowerCase() === 'z') h.undo();
      else if (event.key === 'Escape') h.exit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen]);

  function updateLibrary(updater: (previous: LibraryData) => LibraryData) {
    setLibrary((previous) => {
      if (!previous) return previous;
      const next = updater(previous);
      void saveLibrary(next);
      return next;
    });
  }

  function askText(title: string, label: string, initial: string, confirm: string, onSubmit: (value: string) => void) {
    setDialogValue(initial);
    setDialog({ kind: 'prompt', title, label, confirm, onSubmit });
  }

  function askConfirm(title: string, body: string, confirm: string, onConfirm: () => void) {
    setDialog({ kind: 'confirm', title, body, confirm, onConfirm });
  }

  // ───────── Study ─────────

  function openSession(mode: SessionMode, ids: string[], from: 'home' | 'folder', folder?: string) {
    if (!library) return;
    if (!ids.length) { setNotice('There are no cards to study yet.'); return; }
    setSession(startSession(mode, ids, library.cards, Date.now(), folder));
    setFinished(null);
    setUndoSnap(null);
    setRevealed(false);
    setPeeked(false);
    setStudyFrom(from);
    setScreen('study');
  }

  /** The main way to study: what is due plus a few new cards, mixed across folders (or one folder). */
  function startSmart(scope: 'all' | 'folder') {
    if (!library) return;
    const folder = scope === 'folder' ? selectedFolder : undefined;
    seenIds.current = new Set();
    const all = smartQueue(library.cards, { size: library.settings.dailyGoal, now: Date.now(), folder });
    const ids = all.slice(0, sectionSize(all.length));
    if (!ids.length) { setPlayScope(scope); return; }
    openSession('smart', ids, scope === 'folder' ? 'folder' : 'home', folder);
  }

  function keepGoing() {
    if (!library) return;
    const all = smartQueue(library.cards, { size: library.settings.dailyGoal, now: Date.now(), folder: finished?.folder, exclude: seenIds.current });
    const ids = all.slice(0, sectionSize(all.length));
    if (!ids.length) { setNotice('Nothing else is ready. Nice work.'); setScreen(studyFrom === 'folder' ? 'folder' : 'home'); return; }
    openSession('smart', ids, studyFrom, finished?.folder);
  }

  /** The card to continue from. In a folder: that folder's last card. On home: the last card studied anywhere. */
  function resumeCardFor(scope: 'all' | 'folder'): Card | undefined {
    if (!library) return undefined;
    if (scope === 'folder') {
      const id = library.lastCardByFolder?.[selectedFolder];
      return library.cards.find((card) => card.id === id && card.folder === selectedFolder);
    }
    return library.cards.find((card) => card.id === library.lastStudied?.cardId);
  }

  function startPractice(kind: 'resume' | 'shuffle') {
    if (!library || !playScope) return;
    const scope = playScope;
    setPlayScope(null);
    if (kind === 'shuffle') {
      const pool = scope === 'folder' ? library.cards.filter((card) => card.folder === selectedFolder) : library.cards;
      openSession('shuffle', shuffled(pool.map((card) => card.id)), scope === 'folder' ? 'folder' : 'home', scope === 'folder' ? selectedFolder : undefined);
      return;
    }
    // Where I left off: stay inside one folder, in order, from the last card studied there.
    const resume = resumeCardFor(scope);
    const folder = scope === 'folder' ? selectedFolder : (resume?.folder ?? folders[0]);
    const inFolder = library.cards.filter((card) => card.folder === folder);
    const start = Math.max(0, inFolder.findIndex((card) => card.id === resume?.id));
    setSelectedFolder(folder);
    openSession('resume', inFolder.slice(start).map((card) => card.id), scope === 'folder' ? 'folder' : 'home', folder);
  }

  /** Tap the card to see the other side. Tap again to go back. */
  function toggleFace() {
    if (!studyCard) return;
    if (!revealed) setPeeked(true);
    setRevealed(!revealed);
  }

  /** Opens a card in learning mode: the folder in order, starting at this card. Practice only. */
  function openCardInLearning(card: Card, from: 'home' | 'folder') {
    if (!library) return;
    const inFolder = library.cards.filter((item) => item.folder === card.folder);
    const start = Math.max(0, inFolder.findIndex((item) => item.id === card.id));
    setSelectedFolder(card.folder);
    openSession('resume', inFolder.slice(start).map((item) => item.id), from, card.folder);
  }

  function gradeCard(grade: Grade) {
    if (!library || !session || !studyCard || !peeked) return;
    const now = Date.now();
    const card = studyCard;
    // Practice runs (shuffle / where I left off) never move the schedule.
    const nextSched = session.mode === 'smart' ? schedule(card.sched, grade, now) : undefined;
    const practiceAfter = recordPracticeStats(library.practice, card.id, new Date(now));
    if (practiceAfter.shieldDay === dayKey(new Date(now)) && library.practice?.shieldDay !== practiceAfter.shieldDay) {
      setNotice('Rest day used. Your streak is safe.');
    }
    setUndoSnap({ session, card, practice: library.practice, history: library.history });
    updateLibrary((previous) => {
      const practice = recordPracticeStats(previous.practice, card.id, new Date(now));
      return {
        ...previous,
        practice,
        history: recordHistory(previous.history, practice.todayCount, new Date(now)),
        cards: previous.cards.map((item) => item.id === card.id ? { ...item, rating: legacyRating(grade), ...(nextSched ? { sched: nextSched } : {}) } : item)
      };
    });
    studiedSinceDisplay.current = true;
    seenIds.current.add(card.id);
    const next = applyGrade(session, grade, nextSched, now);
    setSession(next);
    setRevealed(false);
    setPeeked(false);
    if (!next.queue.length) {
      setFinished(next);
      setUndoSnap(null);
      setScreen('summary');
    }
  }

  function undoGrade() {
    if (!undoSnap) return;
    const snap = undoSnap;
    updateLibrary((previous) => ({
      ...previous,
      practice: snap.practice,
      history: snap.history,
      cards: previous.cards.map((item) => item.id === snap.card.id ? snap.card : item)
    }));
    setSession(snap.session);
    setUndoSnap(null);
    setRevealed(false);
    setPeeked(false);
  }

  function exitStudy() {
    setScreen(studyFrom === 'folder' ? 'folder' : 'home');
  }

  keyHandlers.current = { reveal: toggleFace, grade: gradeCard, undo: undoGrade, exit: exitStudy };

  // ───────── Library & editor ─────────

  function askNewFolder() {
    askText('New folder', 'Folder name', '', 'Create', (value) => {
      const name = value.trim();
      if (!name) return;
      if (byteLength(name) > MAX_FOLDER_BYTES) { setNotice('Folder names must be 20 UTF-8 bytes or fewer.'); return; }
      startNewCard(name);
    });
  }

  function openFolder(folder: string) {
    setSelectedFolder(folder);
    setScreen('folder');
  }

  function startNewCard(folder = selectedFolder || 'OllO') {
    setEditorCard(newCard(folder));
    setEditorReturn('folder');
    setScreen('editor');
  }

  function openEditor(card: Card, from: 'folder' | 'study') {
    setSelectedFolder(card.folder);
    setEditorCard({ ...card });
    setEditorReturn(from);
    setScreen('editor');
  }

  function saveEditor(addAnother = false) {
    if (!editorCard || !library) return;
    const folder = editorCard.folder.trim() || 'OllO';
    if (byteLength(folder) > MAX_FOLDER_BYTES) {
      setNotice('Folder names must be 20 UTF-8 bytes or fewer.');
      return;
    }
    if (byteLength(editorCard.front) > MAX_TEXT_BYTES || byteLength(editorCard.back) > MAX_TEXT_BYTES) {
      setNotice(`Each card side must be ${MAX_TEXT_BYTES.toLocaleString()} bytes or fewer.`);
      return;
    }
    if (!editorCard.front.trim() && !editorCard.frontImageId) {
      setNotice('Write the question or add an image first.');
      return;
    }
    const saved: Card = { ...editorCard, folder, updatedAt: Date.now() };
    const exists = library.cards.some((card) => card.id === saved.id);
    updateLibrary((previous) => ({
      ...previous,
      cards: exists ? previous.cards.map((card) => card.id === saved.id ? saved : card) : [...previous.cards, saved]
    }));
    setSelectedFolder(folder);
    if (addAnother) {
      setEditorCard(newCard(folder));
      setNotice('Card saved. Add the next one.');
      window.scrollTo({ top: 0 });
      return;
    }
    setNotice('Card saved');
    setScreen(editorReturn === 'study' && session ? 'study' : 'folder');
  }

  function deleteCurrentCard() {
    if (!editorCard) return;
    const id = editorCard.id;
    askConfirm('Delete this card?', 'It will also be removed from your glasses the next time you sync.', 'Delete card', () => {
      updateLibrary((previous) => ({ ...previous, cards: previous.cards.filter((card) => card.id !== id) }));
      if (session) setSession({ ...session, queue: session.queue.filter((queued) => queued !== id) });
      setScreen('folder');
      setNotice('Card deleted');
    });
  }

  function renameFolder() {
    const current = selectedFolder;
    askText('Rename folder', 'Folder name', current, 'Rename', (value) => {
      const nextName = value.trim();
      if (!nextName || nextName === current) return;
      if (byteLength(nextName) > MAX_FOLDER_BYTES) { setNotice('Folder names must be 20 UTF-8 bytes or fewer.'); return; }
      const stamp = Date.now();
      updateLibrary((previous) => ({ ...previous, cards: previous.cards.map((card) => card.folder === current ? { ...card, folder: nextName, updatedAt: stamp } : card) }));
      setSelectedFolder(nextName);
    });
  }

  function deleteFolder() {
    const current = selectedFolder;
    askConfirm(`Delete “${current}”?`, `This removes the folder and its ${plural(folderCards.length, 'card')}. This can’t be undone.`, 'Delete folder', () => {
      updateLibrary((previous) => ({ ...previous, cards: previous.cards.filter((card) => card.folder !== current) }));
      setScreen('home');
    });
  }

  function toggleBookmark(cardId: string) {
    updateLibrary((previous) => ({ ...previous, cards: previous.cards.map((card) => card.id === cardId ? { ...card, bookmarked: !card.bookmarked } : card) }));
  }

  function addCustomQuote() {
    const text = newQuoteText.trim();
    if (!text) return;
    const quote: Quote = { id: crypto.randomUUID(), text, emotion: newQuoteEmotion };
    updateLibrary((previous) => ({ ...previous, settings: { ...previous.settings, customQuotes: [...previous.settings.customQuotes, quote] } }));
    setNewQuoteText('');
    setNotice('Quote added. It can show up as the quote of the day.');
  }

  function updateCustomQuote(id: string, patch: Partial<Quote>) {
    updateLibrary((previous) => ({ ...previous, settings: { ...previous.settings, customQuotes: previous.settings.customQuotes.map((quote) => quote.id === id ? { ...quote, ...patch } : quote) } }));
  }

  function deleteCustomQuote(id: string) {
    updateLibrary((previous) => ({ ...previous, settings: { ...previous.settings, customQuotes: previous.settings.customQuotes.filter((quote) => quote.id !== id) } }));
  }

  function closeImagePicker() {
    setShowImagePicker(false);
    setPendingImage(undefined);
    setPickerBusy(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  // Step 1: read the picked file and build the glasses copy for every mode, so they can be compared.
  async function processSelectedImage(file?: File) {
    if (!file) return;
    setPickerBusy(true);
    try {
      setPendingImage(await prepareImage(file));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not read this image.');
    } finally {
      setPickerBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  // Step 2: keep the original untouched and store the chosen glasses copy next to it.
  async function confirmPendingImage() {
    if (!pendingImage || !editorCard) return;
    try {
      const stored = finalizeImage(pendingImage, imageMode);
      await saveImage(stored);
      setImages((previous) => new Map(previous).set(stored.id, stored));
      setEditorCard((previous) => previous ? {
        ...previous,
        [imageTarget === 'front' ? 'frontImageId' : 'backImageId']: stored.id
      } : previous);
      setNotice(`${imageModeLabel(imageMode)} image added`);
      closeImagePicker();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save the image.');
    }
  }

  function removeSideImage(side: CardSide) {
    // Keep the binary until the edited card is saved; canceling the editor must not break the stored card.
    setEditorCard((previous) => previous ? { ...previous, [side === 'front' ? 'frontImageId' : 'backImageId']: undefined } : previous);
  }

  // ───────── Glasses ─────────

  async function connect() {
    try { await bleManager.pairAndConnect(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not connect to OllO.'); }
  }

  async function disconnect() {
    try { await bleManager.disconnect(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not disconnect.'); }
  }

  async function synchronize() {
    if (!library) return;
    setSyncBusy(true);
    setSyncProgress({ done: 0, total: 0, label: 'Starting synchronization' });
    try {
      await bleManager.synchronize(library.cards, allImageRecords);
      const counts = { cards: library.cards.length, images: referencedImages.length, folders: folders.length };
      updateLibrary((previous) => ({ ...previous, lastSyncedAt: Date.now(), lastSyncedCounts: counts }));
      setNotice('OllO synchronized successfully');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Synchronization failed.');
    } finally {
      setSyncBusy(false);
    }
  }

  function navigateBack() {
    if (screen === 'folder' || screen === 'sync' || screen === 'settings' || screen === 'summary') setScreen('home');
    else if (screen === 'study') exitStudy();
    else if (screen === 'editor') setScreen(editorReturn === 'study' && session ? 'study' : 'folder');
    else setScreen('home');
  }

  if (!library) return <main className="loading-screen"><Mascot mood="neutral" /><p>Preparing OllO…</p></main>;

  const now = nowMs;
  const streak = activeStreak(library.practice, new Date(now));
  const doneToday = cardsToday(library, new Date(now));
  const goalMet = doneToday >= goal;
  const focus = screen === 'study' || screen === 'summary' || screen === 'editor';
  const tab = screen === 'sync' ? 'glasses' : screen === 'settings' ? 'settings' : 'library';

  // ───────── Screens ─────────

  function renderHome() {
    const lib = library!;
    const queued = todayQueue.length;
    const minutes = Math.max(1, Math.round(queued * 0.25));
    const upcoming = lib.cards.filter((card) => card.sched && card.sched.due > now).map((card) => card.sched!.due).sort((a, b) => a - b)[0];
    let headline: string;
    let sub: string;
    if (!lib.cards.length) { headline = 'Make your first card'; sub = 'Cards you write here show up on your glasses too.'; }
    else if (!queued) { headline = 'You’re all caught up'; sub = upcoming ? `Your next card comes back in ${formatWait(upcoming - now)}.` : 'Come back later and the cards will be waiting.'; }
    else { headline = plural(queued, 'card'); sub = `about ${plural(minutes, 'min')}`; }

    return (
      <section>
        <div className="motivation-row">
          <div className={`quote ${display && display.text.length > 44 ? 'long' : ''}`}><FloatyText key={display?.id} text={display?.text ?? ''} /></div>
          <Mascot mood={mood} />
        </div>

        <div className="today-panel">
          <div className="today-top">
            <Lens value={doneToday} goal={goal} />
            <div className="today-copy"><h2>{headline}</h2><p>{sub}</p></div>
          </div>
          <WeekStrip days={weekStrip(lib.history, new Date(now))} />
        </div>

        <div className="filters list-filters">
          <button className="chip filter-chip" aria-pressed={!bookmarksOnly} onClick={() => setBookmarksOnly(false)}>All</button>
          <button className="chip filter-chip" aria-pressed={bookmarksOnly} onClick={() => setBookmarksOnly(true)}>Saved</button>
        </div>
        <div className="folder-list">
          {homeFolders.length === 0 && searchCards.length === 0 ? (
            <div className="empty">
              <strong>{bookmarksOnly ? 'No saved cards yet' : search ? 'Nothing matches that' : 'No folders yet'}</strong>
              {bookmarksOnly ? 'Tap the bookmark while studying to keep a card here.' : search ? 'Try a different word.' : 'Add a card and its folder appears here.'}
            </div>
          ) : homeFolders.map((folder) => {
            const counts = folderCounts.get(folder)!;
            return (
              <button className="folder-row" key={folder} onClick={() => openFolder(folder)}>
                <span className="folder-name">{folder}</span>
                <span className="folder-side"><ChevronRightIcon /></span>
                <span className="folder-meta"><MasteryBar counts={counts} /><span>{plural(counts.total, 'card')}</span></span>
              </button>
            );
          })}
        </div>
        {searchCards.length > 0 && (
          <>
            <h2 className="sub-head">Cards</h2>
            <div className="card-list">
              {searchCards.map((card) => (
                <button className="card-row" key={card.id} onClick={() => openCardInLearning(card, 'home')}>
                  <span className="q">{card.front || (card.frontImageId ? 'Image card' : 'Untitled card')}</span>
                  <span className="a">{card.back || (card.backImageId ? 'Image answer' : 'No answer yet')}</span>
                  <span className="state">{card.folder}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="dock">
          <button className="fab" onClick={() => (folders.length ? setShowAddSheet(true) : askNewFolder())} aria-label="Add flashcard"><PlusIcon /></button>
          <button className="start-btn" onClick={() => setPlayScope('all')} disabled={!lib.cards.length}><PlayIcon />Start session</button>
        </div>
      </section>
    );
  }

  function renderFolder() {
    const counts = folderCounts.get(selectedFolder) ?? countCards(folderCards, now);
    return (
      <section>
        <div className="folder-head">
          <h1>{selectedFolder}</h1>
          <div className="folder-facts"><span>{plural(counts.total, 'card')}</span></div>
          <MasteryBar counts={counts} />
          <div className="legend">
            <span><i className="m-mature" />Known</span><span><i className="m-young" />Getting there</span><span><i className="m-learning" />Learning</span><span><i className="m-new" />New</span>
          </div>
        </div>
        <div className="card-list">
          {folderCards.map((card) => (
            <button className="card-row" key={card.id} onClick={() => openCardInLearning(card, 'folder')}>
              <span className="q">{card.front || (card.frontImageId ? 'Image card' : 'Untitled card')}</span>
              <span className="a">{card.back || (card.backImageId ? 'Image answer' : 'No answer yet')}</span>
              {card.bookmarked && <span className="state"><BookmarkIcon /></span>}
            </button>
          ))}
        </div>
        <div className="dock">
          <button className="fab" onClick={() => startNewCard(selectedFolder)} aria-label="Add flashcard"><PlusIcon /></button>
          <button className="start-btn" onClick={() => setPlayScope('folder')} disabled={!counts.total}><PlayIcon />Start session</button>
        </div>
      </section>
    );
  }

  function renderFace(card: Card, side: CardSide) {
    const text = side === 'front' ? card.front : card.back;
    const image = faceImage(card, side);
    const hidden = side === 'front' ? revealed : !revealed;
    return (
      <div
        className={`face ${side}`}
        aria-hidden={hidden}
        role="button"
        tabIndex={hidden ? -1 : 0}
        aria-label={side === 'front' ? 'Question. Activate to show the answer.' : 'Answer. Activate to show the question.'}
        onClick={toggleFace}
        onKeyDown={(event: ReactKeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleFace(); } }}
      >
        <span className="face-tag">{side === 'front' ? 'Question' : 'Answer'}</span>
        <div className="face-body">
          {image && <img src={displaySrc(image)} alt="Card image (tap to enlarge)" onClick={(event) => { event.stopPropagation(); setViewerSrc(displaySrc(image)); }} />}
          {(text || !image) && <span className={`face-text ${sizeClass(text)}`}>{text || (side === 'back' ? 'No answer written yet.' : 'Empty card')}</span>}
        </div>
      </div>
    );
  }

  function renderStudy() {
    if (!session || !studyCard) return <div className="empty"><strong>This session is empty</strong><button className="btn quiet" onClick={exitStudy}>Back</button></div>;
    const shown = Math.min(session.total, session.done + 1);
    return (
      <section className="study">
        <div className="study-top">
          <button className="icon-btn plain" onClick={exitStudy} aria-label="Leave session"><CloseIcon /></button>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={session.total} aria-valuenow={session.done} aria-label="Session progress"><i style={{ width: `${session.total ? (session.done / session.total) * 100 : 0}%` }} /></div>
          <span className="study-count">{shown} / {session.total}</span>
        </div>
        <div className="study-meta">
          <span className="where"><b>{studyCard.folder}</b></span>
          <button className={`icon-btn plain ${studyCard.bookmarked ? 'on' : ''}`} onClick={() => toggleBookmark(studyCard.id)} aria-label={studyCard.bookmarked ? 'Remove bookmark' : 'Bookmark card'} aria-pressed={!!studyCard.bookmarked}><BookmarkIcon /></button>
          <button className="icon-btn plain" onClick={() => openEditor(studyCard, 'study')} aria-label="Edit card"><PencilIcon /></button>
        </div>
        <div className="deck enter" key={`${studyCard.id}-${session.done}-${session.queue.length}`}>
          <div className={`flipper ${revealed ? 'flipped' : ''}`}>
            {renderFace(studyCard, 'front')}
            {renderFace(studyCard, 'back')}
          </div>
        </div>
        <div className="study-actions">
          {!peeked ? (
            <>
              <button className="btn primary block" onClick={toggleFace}>Show answer</button>
              <p className="reveal-hint">Say it or picture it first. Remembering is what makes it stick.</p>
            </>
          ) : (
            <div className="grades" role="group" aria-label="How well did you remember?">
              {([4, 3, 2, 1] as const).map((grade) => (
                <button key={grade} className={`grade g${grade}`} onClick={() => gradeCard(grade)}>{GRADE_LABELS[grade]}</button>
              ))}
            </div>
          )}
          <div className="study-foot">{undoSnap && <button className="link-btn" onClick={undoGrade}><UndoIcon style={{ verticalAlign: '-3px', marginRight: 6 }} />Undo last answer</button>}</div>
        </div>
        <p className="sr-only" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{revealed ? 'Answer shown.' : ''}</p>
      </section>
    );
  }

  function renderSummary() {
    const s = finished;
    if (!s) return null;
    const total = s.grades[1] + s.grades[2] + s.grades[3] + s.grades[4];
    const rate = recallRate(s);
    const summaryMood: Mood = rate >= 0.8 ? 'proud' : rate >= 0.5 ? 'happy' : 'neutral';
    const headline = rate >= 0.8 ? 'Strong session' : rate >= 0.5 ? 'Solid work' : 'That was a tough one';
    const message = rate >= 0.8
      ? `You remembered ${s.grades[3] + s.grades[4]} of ${total} answers.`
      : rate >= 0.5
        ? 'The cards you missed come back soon. That’s how they stick.'
        : 'Struggling is part of learning. Missed cards return in a few minutes, then again tomorrow.';
    const minutes = Math.max(1, Math.round((Date.now() - s.startedAt) / 60_000));
    const tomorrowEnd = endOfToday(now) + DAY;
    const tomorrow = library!.cards.filter((card) => card.sched && card.sched.due > endOfToday(now) && card.sched.due <= tomorrowEnd).length;
    const more = smartQueue(library!.cards, { size: goal, now: Date.now(), folder: s.folder, exclude: seenIds.current }).length;
    const parts: [string, number, string][] = [['var(--coral)', s.grades[1], 'Again'], ['var(--amber)', s.grades[2], 'Hard'], ['var(--mint)', s.grades[3], 'Good'], ['var(--sky)', s.grades[4], 'Easy']];
    return (
      <section className="summary">
        <Mascot mood={summaryMood} />
        <div style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
          <h1>{headline}</h1>
          <p>{message}</p>
        </div>
        {s.mode !== 'smart' && <p>This was practice, so your review schedule didn’t change.</p>}
        <div style={{ display: 'grid', gap: 10, width: 'min(100%, 420px)' }}>
          <div className="result-bar" aria-hidden="true">{parts.filter(([, n]) => n > 0).map(([color, n, name]) => <span key={name} style={{ flex: n, background: color }} />)}</div>
          <div className="result-key">{parts.map(([color, n, name]) => <span key={name}><i style={{ background: color }} />{name}<b>{n}</b></span>)}</div>
        </div>
        <div className="summary-facts">
          <div className="fact"><span>Today</span><strong>{doneToday} of {goal} cards{goalMet ? ' ✓' : ''}</strong></div>
          <div className="fact"><span>Streak</span><strong>{streak.days > 0 ? plural(streak.days, 'day') : 'Starts today'}</strong></div>
          <div className="fact"><span>Coming back tomorrow</span><strong>{plural(tomorrow, 'card')}</strong></div>
          <div className="fact"><span>Time</span><strong>{plural(minutes, 'min')}</strong></div>
        </div>
        <div className="summary-actions">
          {more > 0 && <button className="btn primary" onClick={keepGoing}>Keep going</button>}
          <button className={`btn ${more > 0 ? 'quiet' : 'primary'}`} onClick={() => setScreen('home')}>Done</button>
        </div>
      </section>
    );
  }

  function renderSide(side: CardSide) {
    const card = editorCard!;
    const text = card[side];
    const bytes = byteLength(text);
    const image = faceImage(card, side);
    const over = bytes > MAX_TEXT_BYTES;
    return (
      <div className="side-field">
        <label className="side-label" htmlFor={`side-${side}`}>{side === 'front' ? 'Question' : 'Answer'}<span className={over ? 'warn' : ''}>{bytes.toLocaleString()} bytes{over ? ` · limit ${MAX_TEXT_BYTES.toLocaleString()}` : ''}</span></label>
        <div className={`side-box ${side === 'back' ? 'answer' : ''}`}>
          <textarea id={`side-${side}`} placeholder={side === 'front' ? 'What do you want to remember?' : 'What’s the answer?'} value={text} onChange={(event) => setEditorCard({ ...card, [side]: event.target.value })} />
          <div className="side-tools">
            {image ? (
              <>
                <img className="thumb" src={displaySrc(image)} alt="Selected card image (tap to enlarge)" onClick={() => setViewerSrc(displaySrc(image))} />
                <div className="thumb-info"><strong>{imageModeLabel(image.mode)} on glasses</strong><span>{image.width} × {image.height}{image.originalWidth ? ` · original ${image.originalWidth} × ${image.originalHeight}` : ''}</span></div>
                <button className="link-btn danger" onClick={() => removeSideImage(side)}>Remove</button>
              </>
            ) : (
              <button className="btn quiet small" onClick={() => { setImageTarget(side); setShowImagePicker(true); }}><ImageIcon />Add image</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderEditor() {
    const card = editorCard!;
    const isNew = !library!.cards.some((item) => item.id === card.id);
    return (
      <section className="editor">
        {renderSide('front')}
        {renderSide('back')}
        <div className="editor-actions">
          <button className="btn primary block" onClick={() => saveEditor(false)}>Save card</button>
          {isNew && <button className="btn quiet block" onClick={() => saveEditor(true)}>Save and add another</button>}
        </div>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => void processSelectedImage(event.target.files?.[0])} />
      </section>
    );
  }

  function renderSync() {
    const live = connection === 'connected';
    const busy = connection === 'connecting';
    return (
      <section>
        <div className="device">
          <div className="device-head">
            <div className={`device-badge ${live ? 'live' : busy ? 'busy' : ''}`}><BluetoothIcon /></div>
            <div>
              <h2>OllO glasses</h2>
              <span className={`device-state ${live ? 'live' : busy ? 'busy' : ''}`}>{live ? 'Connected' : busy ? 'Connecting…' : 'Not connected'}</span>
            </div>
          </div>
          {connectionMessage.trim().replace(/…|\.+$/g, '').toLowerCase() !== (live ? 'connected' : busy ? 'connecting' : 'not connected') && <p className="device-note">{connectionMessage}</p>}
          <div className="meter">
            <div className="meter-label"><span>Free space on glasses</span><strong>{freeBytes === undefined ? '—' : `${formatBytes(freeBytes)} of ${formatBytes(storageInfo?.totalBytes)}`}</strong></div>
            <div className="meter-track"><i style={{ width: storageInfo && storageInfo.totalBytes ? `${Math.min(100, storageInfo.usedBytes / storageInfo.totalBytes * 100)}%` : '0%' }} /></div>
          </div>
          <div className="counts">
            <div className="count"><strong>{syncedCounts.cards}/{allCards.length}</strong><span>Cards</span></div>
            <div className="count"><strong>{syncedCounts.images}/{referencedImages.length}</strong><span>Images</span></div>
            <div className="count"><strong>{syncedCounts.folders}/{folders.length}</strong><span>Folders</span></div>
          </div>
          {deviceInfo && <p className="fine" style={{ margin: 0 }}>Protocol v{deviceInfo.protocolVersion} · up to {deviceInfo.maxWidth} × {deviceInfo.maxHeight} · text limit {deviceInfo.maxTextBytes} bytes</p>}
        </div>
        {syncBusy && (
          <div className="meter sync-progress">
            <div className="meter-label"><span>{syncProgress.label}</span><strong>{syncProgress.total ? `${Math.round(syncProgress.done / syncProgress.total * 100)}%` : ''}</strong></div>
            <div className="meter-track"><i style={{ width: syncProgress.total ? `${syncProgress.done / syncProgress.total * 100}%` : '0%' }} /></div>
          </div>
        )}
        <div className="device-actions">
          {!live
            ? <button className="btn primary" onClick={() => void connect()} disabled={busy}>{busy ? 'Connecting…' : 'Connect glasses'}</button>
            : <button className="btn primary" onClick={() => void synchronize()} disabled={syncBusy}>{syncBusy ? 'Syncing…' : needsSync ? 'Sync changes' : 'Sync now'}</button>}
          {live && <button className="btn danger" onClick={() => void disconnect()}>Disconnect</button>}
        </div>
        <p className="fine">{library!.lastSyncedAt ? `Last synced ${new Date(library!.lastSyncedAt).toLocaleString()}${needsSync ? ' · you have changes to send' : ''}` : 'Your cards stay on this device until you sync.'}</p>
      </section>
    );
  }

  function renderSettings() {
    const lib = library!;
    const setSettings = (patch: Partial<LibraryData['settings']>) => updateLibrary((previous) => ({ ...previous, settings: { ...previous.settings, ...patch } }));
    return (
      <section className="settings">
        <div className="group">
          <h2>Studying</h2>
          <div className="group-box">
            <div className="setting-block">
              <div className="setting-text"><strong>Daily goal</strong><span>Cards per day. This also sets how long a session is.</span></div>
              <div className="segmented" role="group" aria-label="Daily goal">
                {GOAL_CHOICES.map((n) => <button key={n} aria-pressed={lib.settings.dailyGoal === n} onClick={() => setSettings({ dailyGoal: n })}>{n}</button>)}
              </div>
            </div>
          </div>
          <p className="footnote">Any single card keeps your streak alive. The goal is just something to aim for. One missed day a week is forgiven.</p>
        </div>

        <div className="group">
          <h2>Glasses</h2>
          <div className="group-box">
            <div className="setting"><div className="setting-text"><strong>Reconnect automatically</strong><span>Look for your saved glasses when OllO opens.</span></div><Switch checked={lib.settings.autoReconnect} onChange={(value) => setSettings({ autoReconnect: value })} label="Reconnect automatically" /></div>
            <div className="setting-block">
              <label className="setting-text" htmlFor="img-mode"><strong>Image style for new pictures</strong></label>
              <select id="img-mode" className="input" value={lib.settings.defaultImageMode} onChange={(event) => { const mode = event.target.value as ImageMode; setImageMode(mode); setSettings({ defaultImageMode: mode }); }}>
                <option value="mono">Black & white</option>
                <option value="gray2">Grayscale · 4 tones</option>
                <option value="rgb565">Color</option>
              </select>
            </div>
          </div>
          <div><button className="btn quiet small" onClick={() => { bleManager.forgetDevice(); setNotice('Saved glasses forgotten.'); }}>Forget saved glasses</button></div>
        </div>

        <div className="group">
          <h2>Quotes</h2>
          <div className="group-box">
            <div className="setting"><div className="setting-text"><strong>Use OllO’s own quotes</strong><span>Mix them into the quote of the day.</span></div><Switch checked={lib.settings.useBuiltInQuotes} onChange={(value) => setSettings({ useBuiltInQuotes: value })} label="Use OllO’s own quotes" /></div>
            <div className="setting-block">
              <div className="setting-text"><strong>Write your own</strong><span>The quote changes every 12 hours. Pick the face OllO makes while it shows.</span></div>
              <textarea className="input" value={newQuoteText} maxLength={100} aria-label="Your quote" placeholder="Write a quote that gets you going…" onChange={(event) => setNewQuoteText(event.target.value)} />
              <div className="quote-row">
                <label>OllO’s face
                  <select className="input" value={newQuoteEmotion} onChange={(event) => setNewQuoteEmotion(event.target.value as QuoteEmotion)}>
                    <option value="auto">Auto (follows my progress)</option>
                    {(Object.keys(MOOD_LABELS) as Mood[]).map((m) => <option key={m} value={m}>{MOOD_LABELS[m]}</option>)}
                  </select>
                </label>
                <Mascot mood={newQuoteEmotion === 'auto' ? 'happy' : newQuoteEmotion} pop={false} className="mascot-preview" label="Preview of OllO’s face" />
              </div>
              <button className="btn quiet" disabled={!newQuoteText.trim()} onClick={addCustomQuote}>Add quote</button>
              {lib.settings.customQuotes.length > 0 && (
                <div className="custom-quotes">
                  {lib.settings.customQuotes.map((quote) => (
                    <div className="custom-quote" key={quote.id}>
                      <span className="custom-quote-text">{quote.text}</span>
                      <select className="input" value={quote.emotion} aria-label="OllO’s face for this quote" onChange={(event) => updateCustomQuote(quote.id, { emotion: event.target.value as QuoteEmotion })}>
                        <option value="auto">Auto</option>
                        {(Object.keys(MOOD_LABELS) as Mood[]).map((m) => <option key={m} value={m}>{MOOD_LABELS[m]}</option>)}
                      </select>
                      <button className="icon-btn plain danger" onClick={() => deleteCustomQuote(quote.id)} aria-label="Delete quote"><TrashIcon /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <p className="footnote">OllO does not currently include firmware update controls.</p>
      </section>
    );
  }

  const titles: Partial<Record<Screen, string>> = { editor: library.cards.some((card) => card.id === editorCard?.id) ? 'Edit card' : 'New card', sync: 'Glasses', settings: 'Settings' };

  return (
    <>
      <div className={`app ${focus ? 'focus' : ''}`}>
        {!focus && (
          <nav className="nav" aria-label="Main">
            <div className="nav-brand"><img src="/ollo-mark.svg" alt="" />OllO</div>
            <button className="nav-item" aria-current={tab === 'library' ? 'page' : undefined} onClick={() => setScreen('home')}><span className="nav-icon"><LibraryIcon /></span>Library</button>
            <button className="nav-item" aria-current={tab === 'glasses' ? 'page' : undefined} onClick={() => setScreen('sync')}><span className="nav-icon"><GlassesIcon />{needsSync && <span className="nav-dot" />}</span>Glasses</button>
            <button className="nav-item" aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => setScreen('settings')}><span className="nav-icon"><SettingsIcon /></span>Settings</button>
          </nav>
        )}
        <main className="stage">
          {screen !== 'study' && screen !== 'summary' && (
            <header className="topbar">
              {screen === 'home' ? (
                <>
                  <span className="topbar-spacer" />
                  <button className={`chip ${needsSync ? 'attn' : ''}`} onClick={() => setScreen('sync')} aria-label="Glasses status"><span className={`pip ${connection === 'connected' ? 'live' : connection === 'connecting' ? 'busy' : ''}`} />{needsSync ? 'Sync' : connection === 'connected' ? 'Connected' : 'Glasses'}</button>
                  <button className={`icon-btn ${showSearch ? 'on' : ''}`} onClick={() => { setShowSearch((value) => !value); if (showSearch) setSearch(''); }} aria-label="Search" aria-pressed={showSearch}><SearchIcon /></button>
                </>
              ) : (
                <>
                  <button className="icon-btn plain" onClick={navigateBack} aria-label="Go back"><ArrowLeftIcon /></button>
                  <span className="topbar-title">{titles[screen] ?? ''}</span>
                  {screen === 'folder' && <><button className="icon-btn plain" onClick={renameFolder} aria-label="Rename folder"><PencilIcon /></button><button className="icon-btn plain danger" onClick={deleteFolder} aria-label="Delete folder"><TrashIcon /></button></>}
                  {screen === 'editor' && library.cards.some((card) => card.id === editorCard?.id) && <button className="icon-btn plain danger" onClick={deleteCurrentCard} aria-label="Delete card"><TrashIcon /></button>}
                </>
              )}
            </header>
          )}
          {screen === 'home' && showSearch && <input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search folders and cards" aria-label="Search folders and cards" autoFocus />}

          {screen === 'home' && renderHome()}
          {screen === 'folder' && renderFolder()}
          {screen === 'study' && renderStudy()}
          {screen === 'summary' && renderSummary()}
          {screen === 'editor' && editorCard && renderEditor()}
          {screen === 'sync' && renderSync()}
          {screen === 'settings' && renderSettings()}
        </main>
      </div>

      {playScope && (() => {
        const pool = playScope === 'folder' ? library.cards.filter((card) => card.folder === selectedFolder) : library.cards;
        const queue = playScope === 'folder' ? folderQueue : todayQueue;
        const resume = resumeCardFor(playScope);
        const resumeFolderCards = resume ? library.cards.filter((card) => card.folder === resume.folder) : [];
        const resumeText = resume
          ? `${playScope === 'all' ? `${resume.folder} · ` : ''}card ${resumeFolderCards.findIndex((card) => card.id === resume.id) + 1} of ${resumeFolderCards.length}`
          : 'Starts at the first card';
        return (
          <div className="backdrop" onClick={() => setPlayScope(null)}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label="Start session" onClick={(event) => event.stopPropagation()}>
              <h2>Start session</h2>
              <p>{playScope === 'folder' ? selectedFolder : 'All folders'}</p>
              {queue.length > 0 && <button className="choice primary-choice" onClick={() => { setPlayScope(null); startSmart(playScope); }}><span className="choice-icon"><PlayIcon /></span><span><strong>Study {plural(queue.length, 'card')}</strong><small>Picked for you · about {plural(Math.max(1, Math.round(queue.length * 0.25)), 'min')}</small></span></button>}
              <button className="choice" disabled={!pool.length} onClick={() => startPractice('resume')}><span className="choice-icon"><PlayIcon /></span><span><strong>Where I left off</strong><small>{resumeText}</small></span></button>
              <button className="choice" disabled={!pool.length} onClick={() => startPractice('shuffle')}><span className="choice-icon"><ShuffleIcon /></span><span><strong>Shuffle</strong><small>{playScope === 'folder' ? `Random order from ${selectedFolder}` : 'Random order from every folder'}</small></span></button>
              <div className="sheet-actions"><button className="btn quiet" onClick={() => setPlayScope(null)}>Cancel</button></div>
            </div>
          </div>
        );
      })()}

      {showAddSheet && (
        <div className="backdrop" onClick={() => setShowAddSheet(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Add a card" onClick={(event) => event.stopPropagation()}>
            <h2>Add a card to…</h2>
            {folders.map((name) => <button key={name} className="choice" onClick={() => { setShowAddSheet(false); startNewCard(name); }}><span className="choice-icon"><LibraryIcon /></span><span><strong>{name}</strong><small>{plural(folderCounts.get(name)?.total ?? 0, 'card')}</small></span></button>)}
            <button className="choice" onClick={() => { setShowAddSheet(false); askNewFolder(); }}><span className="choice-icon"><PlusIcon /></span><span><strong>New folder</strong></span></button>
            <div className="sheet-actions"><button className="btn quiet" onClick={() => setShowAddSheet(false)}>Cancel</button></div>
          </div>
        </div>
      )}

      {showImagePicker && (
        <div className="backdrop" onClick={closeImagePicker}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Add image" onClick={(event) => event.stopPropagation()}>
            <h2>Add image</h2>
            {!pendingImage ? (
              <>
                <p>Pick a picture. You can compare black & white, grayscale and color before choosing.</p>
                <div className="sheet-actions"><button className="btn quiet" onClick={closeImagePicker}>Cancel</button><button className="btn primary" disabled={pickerBusy} onClick={() => fileInput.current?.click()}>{pickerBusy ? 'Preparing…' : 'Choose image'}</button></div>
              </>
            ) : (
              <>
                <p>Tap a style. Your original stays untouched in the app; the glasses get the version you pick.</p>
                <div className="mode-previews">
                  {IMAGE_MODES.map((mode) => {
                    const variant = pendingImage.variants[mode];
                    return (
                      <button key={mode} className="mode-preview" aria-pressed={imageMode === mode} onClick={() => setImageMode(mode)}>
                        <img src={variant.preview} alt="" />
                        <b>{imageModeLabel(mode)}</b>
                        <small>{variant.width} × {variant.height}</small>
                      </button>
                    );
                  })}
                </div>
                <p>Original: {pendingImage.originalWidth} × {pendingImage.originalHeight}. Pictures larger than 640 × 480 are shrunk for the glasses only.</p>
                <div className="sheet-actions"><button className="btn quiet" onClick={() => setPendingImage(undefined)}>Back</button><button className="btn primary" onClick={() => void confirmPendingImage()}>Use this style</button></div>
              </>
            )}
          </div>
        </div>
      )}

      {dialog && (
        <div className="backdrop" onClick={() => setDialog(null)}>
          <form
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={dialog.title}
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              const current = dialog;
              setDialog(null);
              if (current.kind === 'prompt') current.onSubmit(dialogValue); else current.onConfirm();
            }}
          >
            <h2>{dialog.title}</h2>
            {dialog.kind === 'confirm' ? <p>{dialog.body}</p> : <input className="input" autoFocus aria-label={dialog.label} value={dialogValue} maxLength={40} onChange={(event) => setDialogValue(event.target.value)} onFocus={(event) => event.target.select()} />}
            <div className="sheet-actions">
              <button type="button" className="btn quiet" onClick={() => setDialog(null)}>Cancel</button>
              <button type="submit" className="btn primary" autoFocus={dialog.kind === 'confirm'}>{dialog.confirm}</button>
            </div>
          </form>
        </div>
      )}

      {viewerSrc && <div className="image-viewer" onClick={() => setViewerSrc(undefined)} role="dialog" aria-label="Full screen image"><button className="viewer-close" onClick={() => setViewerSrc(undefined)} aria-label="Close"><CloseIcon /></button><img src={viewerSrc} alt="Full screen card" /></div>}
      {notice && <div className={`toast ${focus ? 'focus' : ''}`} role="status">{notice}</div>}
    </>
  );
}
