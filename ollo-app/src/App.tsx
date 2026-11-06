import { useEffect, useMemo, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { Card, ImageMode, LibraryData, Mood, Quote, QuoteEmotion, StoredImage } from './types';
import { getAllImages, loadLibrary, saveImage, saveLibrary } from './storage';
import { IMAGE_MODES, displaySrc, finalizeImage, imageModeLabel, prepareImage, type PreparedImage } from './imageCodec';
import { bleManager } from './ble/BleManager';
import { MAX_FOLDER_BYTES, MAX_TEXT_BYTES, type DeviceInfo, type StorageInfo } from './ble/protocol';
import { ArrowLeftIcon, ArrowRightIcon, BluetoothIcon, BookmarkIcon, CloseIcon, FlipIcon, PencilIcon, PlayIcon, PlusIcon, SearchIcon, SettingsIcon, ShuffleIcon, TrashIcon } from './icons';
import { Mascot } from './mascot/Mascot';
import { FloatyText } from './mascot/FloatyText';
import { MOOD_LABELS, moodFromUrl, recordPracticeStats } from './mascot/mood';
import { DIRECTOR_RULES, eggDisplay, handleAppOpen, quoteDisplay, resolveQuoteOfTheDay, type Display } from './mascot/director';
import './styles.css';

type ConnectionState = 'disconnected' | 'connecting' | 'connected';
type CardSide = 'front' | 'back';

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

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function App() {
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [images, setImages] = useState<Map<number, StoredImage>>(new Map());
  const [screen, setScreen] = useState<'home' | 'folder' | 'study' | 'editor' | 'sync' | 'settings'>('home');
  const [selectedFolder, setSelectedFolder] = useState('Physics 101');
  const [, setSelectedCardId] = useState<string | undefined>();
  const [editorCard, setEditorCard] = useState<Card | null>(null);
  const [editorSide, setEditorSide] = useState<CardSide>('front');
  const [studyIndex, setStudyIndex] = useState(0);
  // null = the selected folder in order; otherwise an explicit (random) order of card ids
  const [studyIds, setStudyIds] = useState<string[] | null>(null);
  const [studyFrom, setStudyFrom] = useState<'home' | 'folder'>('folder');
  const [playScope, setPlayScope] = useState<'all' | 'folder' | null>(null);
  const [studyBack, setStudyBack] = useState(false);
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

  useEffect(() => {
    if (!viewerSrc) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setViewerSrc(undefined); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerSrc]);

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
  const folders = useMemo(() => library ? folderNames(library.cards) : [], [library]);
  const homeFolders = useMemo(() => {
    if (!library) return [];
    return folders.filter((folder) => {
      const folderCards = library.cards.filter((card) => card.folder === folder);
      const matches = !bookmarksOnly || folderCards.some((card) => card.bookmarked);
      const searchMatch = !search || folder.toLowerCase().includes(search.toLowerCase()) || folderCards.some((card) => `${card.front} ${card.back}`.toLowerCase().includes(search.toLowerCase()));
      return matches && searchMatch;
    });
  }, [library, folders, bookmarksOnly, search]);
  const folderCards = useMemo(() => library?.cards.filter((card) => card.folder === selectedFolder) ?? [], [library, selectedFolder]);
  const studyCards = useMemo(() => {
    if (!studyIds || !library) return folderCards;
    const byId = new Map(library.cards.map((card) => [card.id, card]));
    return studyIds.map((id) => byId.get(id)).filter((card): card is Card => !!card);
  }, [studyIds, library, folderCards]);
  const activeStudyCard = studyCards[studyIndex];
  const activeStudyImageId = activeStudyCard ? (studyBack ? activeStudyCard.backImageId : activeStudyCard.frontImageId) : undefined;
  const activeStudyImage = activeStudyImageId ? images.get(activeStudyImageId) : undefined;
  const activeEditorImageId = editorCard ? (editorSide === 'front' ? editorCard.frontImageId : editorCard.backImageId) : undefined;
  const activeEditorImage = activeEditorImageId ? images.get(activeEditorImageId) : undefined;
  const allImageRecords = [...images.values()];
  const referencedImageIds = new Set(library?.cards.flatMap((card) => [card.frontImageId, card.backImageId].filter((id): id is number => typeof id === 'number')) ?? []);
  const referencedImages = allImageRecords.filter((image) => referencedImageIds.has(image.id));
  const syncedCounts = library?.lastSyncedCounts ?? { cards: 0, images: 0, folders: 0 };
  const freeBytes = storageInfo ? Math.max(0, storageInfo.totalBytes - storageInfo.usedBytes) : undefined;

  useEffect(() => {
    if (screen !== 'study' || !activeStudyCard || !library) return;
    const { id, folder } = activeStudyCard;
    if (library.lastStudied?.cardId === id && library.lastCardByFolder?.[folder] === id) return;
    updateLibrary((previous) => ({
      ...previous,
      lastStudied: { folder, cardId: id },
      lastCardByFolder: { ...previous.lastCardByFolder, [folder]: id }
    }));
  }, [screen, activeStudyCard?.id]);

  function updateLibrary(updater: (previous: LibraryData) => LibraryData) {
    setLibrary((previous) => {
      if (!previous) return previous;
      const next = updater(previous);
      void saveLibrary(next);
      return next;
    });
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

  function startPlay(kind: 'continue' | 'random') {
    if (!library || !playScope) return;
    const scope = playScope;
    setPlayScope(null);
    setStudyBack(false);
    setStudyFrom(scope === 'folder' ? 'folder' : 'home');

    if (kind === 'random') {
      const pool = scope === 'folder' ? library.cards.filter((card) => card.folder === selectedFolder) : library.cards;
      if (!pool.length) { setNotice('There are no cards to study yet.'); return; }
      setStudyIds(shuffled(pool.map((card) => card.id)));
      setStudyIndex(0);
      setScreen('study');
      return;
    }

    // Continue: stay inside one folder (the one the user is in, or the one they left off in).
    const resume = resumeCardFor(scope);
    const folder = scope === 'folder' ? selectedFolder : (resume?.folder ?? folders[0]);
    const cards = library.cards.filter((card) => card.folder === folder);
    if (!folder || !cards.length) { setNotice('There are no cards to study yet.'); return; }
    setSelectedFolder(folder);
    setStudyIds(null);
    setStudyIndex(Math.max(0, cards.findIndex((card) => card.id === resume?.id)));
    setScreen('study');
  }

  function openFolder(folder: string) {
    setSelectedFolder(folder);
    setScreen('folder');
  }

  function startNewCard(folder = selectedFolder || 'OllO') {
    setEditorCard(newCard(folder));
    setEditorSide('front');
    setScreen('editor');
  }

  function openEditor(card: Card) {
    setSelectedCardId(card.id);
    setSelectedFolder(card.folder);
    setEditorCard({ ...card });
    setEditorSide('front');
    setScreen('editor');
  }

  function saveEditor() {
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
    const exists = library.cards.some((card) => card.id === editorCard.id);
    updateLibrary((previous) => ({
      ...previous,
      cards: exists
        ? previous.cards.map((card) => card.id === editorCard.id ? { ...editorCard, folder } : card)
        : [...previous.cards, { ...editorCard, folder }]
    }));
    setSelectedFolder(folder);
    setSelectedCardId(editorCard.id);
    setScreen('folder');
    setNotice('Card saved');
  }

  function deleteCurrentCard() {
    if (!editorCard || !window.confirm('Delete this flashcard?')) return;
    updateLibrary((previous) => ({ ...previous, cards: previous.cards.filter((card) => card.id !== editorCard.id) }));
    setScreen('folder');
    setNotice('Card deleted');
  }

  function renameFolder() {
    const nextName = window.prompt('Rename folder', selectedFolder)?.trim();
    if (!nextName || nextName === selectedFolder) return;
    if (byteLength(nextName) > 20) { setNotice('Folder names must be 20 UTF-8 bytes or fewer.'); return; }
    updateLibrary((previous) => ({ ...previous, cards: previous.cards.map((card) => card.folder === selectedFolder ? { ...card, folder: nextName } : card) }));
    setSelectedFolder(nextName);
  }

  function deleteFolder() {
    if (!window.confirm(`Delete folder “${selectedFolder}” and all its cards?`)) return;
    updateLibrary((previous) => ({ ...previous, cards: previous.cards.filter((card) => card.folder !== selectedFolder) }));
    setScreen('home');
  }

  function toggleBookmark(cardId: string) {
    updateLibrary((previous) => ({ ...previous, cards: previous.cards.map((card) => card.id === cardId ? { ...card, bookmarked: !card.bookmarked } : card) }));
    if (editorCard?.id === cardId) setEditorCard((previous) => previous ? { ...previous, bookmarked: !previous.bookmarked } : previous);
  }

  /** Counts a card as practiced (each card counts once per day) so ollo can react to it. */
  function recordPractice(cardId: string) {
    studiedSinceDisplay.current = true;
    updateLibrary((previous) => ({ ...previous, practice: recordPracticeStats(previous.practice, cardId) }));
  }

  function flipStudyCard() {
    if (activeStudyCard && !studyBack) recordPractice(activeStudyCard.id);
    setStudyBack((value) => !value);
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

  function rateCard(rating: 1 | 2 | 3 | 4) {
    if (!activeStudyCard) return;
    recordPractice(activeStudyCard.id);
    updateLibrary((previous) => ({ ...previous, cards: previous.cards.map((card) => card.id === activeStudyCard.id ? { ...card, rating } : card) }));
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

  function removeEditorImage() {
    if (!editorCard || !activeEditorImageId) return;
    // Keep the binary until the edited card is saved; canceling the editor must not break the stored card.
    setEditorCard((previous) => previous ? { ...previous, [editorSide === 'front' ? 'frontImageId' : 'backImageId']: undefined } : previous);
  }

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
    if (screen === 'folder' || screen === 'sync' || screen === 'settings') setScreen('home');
    else if (screen === 'study') setScreen(studyFrom === 'home' ? 'home' : 'folder');
    else if (screen === 'editor') setScreen('folder');
    else setScreen('home');
  }

  if (!library) return <main className="loading-screen"><Mascot mood="neutral" /><p>Preparing OllO…</p></main>;

  return (
    <main className="app-shell">
      <header className="topbar">
        {screen !== 'home' ? <button className="icon-button back-button" onClick={navigateBack} aria-label="Go back"><ArrowLeftIcon /></button> : <button className={`icon-button big ${bookmarksOnly ? 'active' : ''}`} onClick={() => setBookmarksOnly((value) => !value)} aria-label="Show bookmarks"><BookmarkIcon /></button>}
        {screen === 'home' && (
          <div className="top-actions">
            {showSearch && <input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search folders and cards" autoFocus />}
            <button className="icon-button" onClick={() => { setShowSearch((value) => !value); if (showSearch) setSearch(''); }} aria-label="Search"><SearchIcon /></button>
            <button className="pill-button" onClick={() => setScreen('sync')}>sync</button>
          </div>
        )}
        {screen === 'folder' && <button className="pill-button push-right" onClick={() => setScreen('sync')}>sync</button>}
        {screen === 'study' && activeStudyCard && (
          <div className="top-actions">
            <button className={`round-action ${activeStudyCard.bookmarked ? 'selected' : ''}`} onClick={() => toggleBookmark(activeStudyCard.id)} aria-label="Bookmark card"><BookmarkIcon /></button>
            <button className="round-action" onClick={() => openEditor(activeStudyCard)} aria-label="Edit card"><PencilIcon /></button>
          </div>
        )}
        {screen === 'editor' && <><div className="page-heading">EDIT</div><button className="icon-button danger plain" onClick={deleteCurrentCard} aria-label="Delete card"><TrashIcon /></button></>}
        {screen === 'sync' && <><div className="page-heading">sync</div><span className="topbar-spacer" /></>}
        {screen === 'settings' && <><div className="page-heading">SETTINGS</div><span className="topbar-spacer" /></>}
      </header>

      {screen === 'home' && (
        <section className="home-screen">
          <div className="motivation-row">
            <div className={`quote ${display && display.text.length > 44 ? 'long' : ''}`}><FloatyText key={display?.id} text={display?.text ?? ''} /></div>
            <Mascot mood={mood} />
          </div>
          <div className="folder-list">
            {homeFolders.length === 0 ? <div className="empty-state">No folders yet. Add your first flashcard.</div> : homeFolders.map((folder) => {
              const count = library.cards.filter((card) => card.folder === folder).length;
              return <button className="folder-tile" key={folder} onClick={() => openFolder(folder)}><strong>{folder}</strong><span>{count} {count === 1 ? 'card' : 'cards'}</span></button>;
            })}
          </div>
          <div className="home-bottom-actions">
            <button className="floating-play" onClick={() => { if (library.cards.length) setPlayScope('all'); else setNotice('Add a flashcard first.'); }} aria-label="Start studying"><PlayIcon /></button>
            <button className="settings-shortcut" onClick={() => setScreen('settings')} aria-label="Settings"><SettingsIcon /></button>
            <button className="floating-add" onClick={() => {
              const folder = window.prompt('Folder name for the new card', selectedFolder || 'OllO')?.trim();
              if (!folder) return;
              if (byteLength(folder) > MAX_FOLDER_BYTES) { setNotice('Folder names must be 20 UTF-8 bytes or fewer.'); return; }
              startNewCard(folder);
            }} aria-label="Add flashcard"><PlusIcon /></button>
          </div>
        </section>
      )}

      {screen === 'folder' && (
        <section className="folder-screen">
          <div className="folder-management-card">
            <div className="folder-management-top"><strong>{selectedFolder}</strong><div className="row-actions"><button className="text-icon muted" onClick={renameFolder} aria-label="Rename folder"><PencilIcon /></button><button className="text-icon danger" onClick={deleteFolder} aria-label="Delete folder"><TrashIcon /></button></div></div>
            <div className="folder-management-bottom"><span>{folderCards.length} cards</span><span className="synced-label">{library.lastSyncedAt ? 'Synced' : 'Not synced'}</span></div>
          </div>
          <div className="folder-card-list">
            {folderCards.map((card) => <button className="flashcard-preview" key={card.id} onClick={() => { setSelectedCardId(card.id); setStudyIds(null); setStudyFrom('folder'); setStudyIndex(folderCards.findIndex((item) => item.id === card.id)); setStudyBack(false); setScreen('study'); }}>
              {card.frontImageId && images.get(card.frontImageId) ? <img src={displaySrc(images.get(card.frontImageId)!)} alt="Card front" /> : <span>{card.front || 'Untitled card'}</span>}
            </button>)}
          </div>
          <div className="home-bottom-actions"><button className="floating-play" onClick={() => { if (folderCards.length) setPlayScope('folder'); else setNotice('Add a flashcard first.'); }} aria-label="Study folder"><PlayIcon /></button><button className="floating-add" onClick={() => startNewCard(selectedFolder)} aria-label="Add flashcard"><PlusIcon /></button></div>
        </section>
      )}

      {screen === 'study' && (
        <section className="study-screen">
          {activeStudyCard ? <>
            <div className="study-card" role="button" tabIndex={0} onClick={flipStudyCard} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); flipStudyCard(); } }}>
              {activeStudyImage ? <img src={displaySrc(activeStudyImage)} alt="Flashcard (tap to enlarge)" onClick={(event) => { event.stopPropagation(); setViewerSrc(displaySrc(activeStudyImage)); }} /> : <span>{studyBack ? activeStudyCard.back : activeStudyCard.front}</span>}
            </div>
            <div className="study-navigation"><button onClick={() => { setStudyIndex((value) => Math.max(0, value - 1)); setStudyBack(false); }} aria-label="Previous card"><ArrowLeftIcon /></button><button onClick={flipStudyCard} aria-label="Flip card"><FlipIcon /></button><button onClick={() => { setStudyIndex((value) => Math.min(studyCards.length - 1, value + 1)); setStudyBack(false); }} aria-label="Next card"><ArrowRightIcon /></button></div>
            <div className="difficulty-rating" aria-label="Rate difficulty to memorize this card">
              {([1, 2, 3, 4] as const).map((rating) => <button key={rating} className={`rating-segment rating-${rating} ${activeStudyCard.rating === rating ? 'chosen' : ''}`} onClick={() => rateCard(rating)} title={['Easy', 'Moderate', 'Difficult', 'Very difficult'][rating - 1]} aria-label={`Difficulty ${rating}`} />)}
            </div>
            <div className="rating-caption">{activeStudyCard.rating ? ['Easy', 'Moderate', 'Difficult', 'Very difficult'][activeStudyCard.rating - 1] : 'How difficult was this to memorize?'}</div>
            <div className="study-counter">{studyIndex + 1} / {studyCards.length}</div>
          </> : <div className="empty-state">This folder has no cards yet.</div>}
        </section>
      )}

      {screen === 'editor' && editorCard && (
        <section className="editor-screen">
                    <textarea className="card-editor-text" placeholder={editorSide === 'front' ? 'Write the question…' : 'Write the answer…'} value={editorCard[editorSide]} onChange={(event) => setEditorCard({ ...editorCard, [editorSide]: event.target.value })} />
          <div className="editor-counter">{editorSide === 'front' ? 'FRONT' : 'BACK'} · {byteLength(editorCard[editorSide]).toLocaleString()} bytes</div>
          {activeEditorImage && <div className="editor-image-preview"><img src={displaySrc(activeEditorImage)} alt="Selected card image (tap to enlarge)" onClick={() => setViewerSrc(displaySrc(activeEditorImage))} /><div><strong>{imageModeLabel(activeEditorImage.mode)} on glasses</strong><span>Glasses copy {activeEditorImage.width} × {activeEditorImage.height}</span>{activeEditorImage.originalWidth && <span>Original {activeEditorImage.originalWidth} × {activeEditorImage.originalHeight}</span>}<button className="text-link danger" onClick={removeEditorImage}>Remove image</button></div></div>}
          <div className="editor-actions"><button className="soft-button" onClick={() => { setImageTarget(editorSide); setShowImagePicker(true); }}>Add image</button></div>
          <button className="flip-editor" onClick={() => setEditorSide((value) => value === 'front' ? 'back' : 'front')} aria-label="Flip card side"><FlipIcon /></button>
          <label className="field-label">Folder<input className="text-field compact" value={editorCard.folder} onChange={(event) => setEditorCard({ ...editorCard, folder: event.target.value })} maxLength={40} /></label>
          <button className="primary-button save-button" onClick={saveEditor}>SAVE CARD</button>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => void processSelectedImage(event.target.files?.[0])} />
          {showImagePicker && <div className="modal-backdrop" onClick={closeImagePicker}><div className="image-picker-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title">Add image</div>
            {!pendingImage ? <>
              <p>Pick a picture. You can compare black & white, grayscale and color before choosing.</p>
              <div className="modal-actions"><button className="soft-button" onClick={closeImagePicker}>Cancel</button><button className="primary-button" disabled={pickerBusy} onClick={() => fileInput.current?.click()}>{pickerBusy ? 'Preparing…' : 'Choose image'}</button></div>
            </> : <>
              <p>Tap a style to choose it. Your original stays untouched in the app; the glasses get the version you pick.</p>
              <div className="mode-previews">
                {IMAGE_MODES.map((mode) => {
                  const variant = pendingImage.variants[mode];
                  return <button key={mode} className={imageMode === mode ? 'mode-preview selected' : 'mode-preview'} onClick={() => setImageMode(mode)}>
                    <img src={variant.preview} alt={imageModeLabel(mode)} />
                    <span className="mode-preview-name">{imageModeLabel(mode)}</span>
                    <span className="mode-preview-size">{variant.width} × {variant.height}</span>
                  </button>;
                })}
              </div>
              <p className="mode-hint">Original: {pendingImage.originalWidth} × {pendingImage.originalHeight}. Pictures larger than 640 × 480 are shrunk for the glasses only.</p>
              <div className="modal-actions"><button className="soft-button" onClick={() => setPendingImage(undefined)}>Back</button><button className="primary-button" onClick={() => void confirmPendingImage()}>Use this style</button></div>
            </>}
          </div></div>}
        </section>
      )}

      {screen === 'sync' && (
        <section className="sync-screen">
          <div className="device-panel">
            <div className="device-heading"><div className="bluetooth-symbol"><BluetoothIcon /></div><div><strong>OllO Glasses</strong><span className={connection === 'connected' ? 'device-connected' : 'device-disconnected'}>Status: {connection === 'connected' ? 'CONNECTED' : connection === 'connecting' ? 'CONNECTING' : 'DISCONNECTED'}</span></div></div>
            <p className="connection-message">{connectionMessage}</p>
            <div className="panel-divider" />
            <div className="storage-label"><span>FREE STORAGE</span><span>{freeBytes === undefined ? '—' : `${formatBytes(freeBytes)} / ${formatBytes(storageInfo?.totalBytes)}`}</span></div>
            <div className="storage-track"><div className="storage-fill" style={{ width: storageInfo && storageInfo.totalBytes ? `${Math.min(100, storageInfo.usedBytes / storageInfo.totalBytes * 100)}%` : '0%' }} /></div>
            <div className="sync-stats">
              <div className="stat-tile"><span>CARDS SYNCED</span><strong>{syncedCounts.cards} / {library.cards.length}</strong></div>
              <div className="stat-tile"><span>IMAGES SYNCED</span><strong>{syncedCounts.images} / {referencedImages.length}</strong></div>
              <div className="stat-tile stat-centered"><span>FOLDERS SYNCED</span><strong>{syncedCounts.folders} / {folders.length}</strong></div>
            </div>
            {deviceInfo && <div className="protocol-note">Protocol v{deviceInfo.protocolVersion} · {deviceInfo.maxWidth} × {deviceInfo.maxHeight} max · text limit {deviceInfo.maxTextBytes} bytes</div>}
          </div>
          {syncBusy && <div className="sync-progress-area"><div className="sync-progress-label"><span>{syncProgress.label}</span><span>{syncProgress.total ? `${Math.round(syncProgress.done / syncProgress.total * 100)}%` : ''}</span></div><div className="storage-track"><div className="storage-fill" style={{ width: syncProgress.total ? `${syncProgress.done / syncProgress.total * 100}%` : '0%' }} /></div></div>}
          <div className="sync-actions">
            {connection !== 'connected' ? <button className="primary-button connect-button" onClick={() => void connect()} disabled={connection === 'connecting'}>{connection === 'connecting' ? 'CONNECTING…' : 'CONNECT'}</button> : <button className="primary-button connect-button" onClick={() => void synchronize()} disabled={syncBusy}>{syncBusy ? 'SYNCING…' : 'SYNC NOW'}</button>}
            {connection === 'connected' && <button className="disconnect-button" onClick={() => void disconnect()}>DISCONNECT</button>}
          </div>
          <p className="last-sync">{library.lastSyncedAt ? `Last synchronized ${new Date(library.lastSyncedAt).toLocaleString()}` : 'Your library is stored on this device until you synchronize.'}</p>
        </section>
      )}

      {screen === 'settings' && (
        <section className="settings-screen">
          <div className="settings-card"><div><strong>Automatic reconnection</strong><span>Reconnect to your saved glasses when OllO opens.</span></div><input type="checkbox" checked={library.settings.autoReconnect} onChange={(event) => updateLibrary((previous) => ({ ...previous, settings: { ...previous.settings, autoReconnect: event.target.checked } }))} /></div>
          <div className="settings-card"><div><strong>Built-in quotes</strong><span>Mix OllO's own motivational quotes into the quote of the day.</span></div><input type="checkbox" checked={library.settings.useBuiltInQuotes} onChange={(event) => updateLibrary((previous) => ({ ...previous, settings: { ...previous.settings, useBuiltInQuotes: event.target.checked } }))} /></div>
          <div className="quote-editor">
            <div className="quote-editor-title">Motivational quotes</div>
            <p className="mode-hint">The quote of the day changes every 12 hours. Add your own and pick the face OllO makes while it is showing.</p>
            <textarea className="text-field" value={newQuoteText} maxLength={100} placeholder="Write your own motivational quote…" onChange={(event) => setNewQuoteText(event.target.value)} />
            <div className="quote-editor-row">
              <label className="quote-emotion-label">OllO's face
                <select className="text-field compact" value={newQuoteEmotion} onChange={(event) => setNewQuoteEmotion(event.target.value as QuoteEmotion)}>
                  <option value="auto">Auto (follows my progress)</option>
                  {(Object.keys(MOOD_LABELS) as Mood[]).map((m) => <option key={m} value={m}>{MOOD_LABELS[m]}</option>)}
                </select>
              </label>
              <Mascot mood={newQuoteEmotion === 'auto' ? 'happy' : newQuoteEmotion} pop={false} className="mascot-preview" label="Preview of OllO's face" />
            </div>
            <button className="primary-button" disabled={!newQuoteText.trim()} onClick={addCustomQuote}>ADD QUOTE</button>
            {library.settings.customQuotes.length > 0 && <div className="custom-quote-list">
              {library.settings.customQuotes.map((quote) => <div className="custom-quote" key={quote.id}>
                <span className="custom-quote-text">{quote.text}</span>
                <select className="custom-quote-emotion" value={quote.emotion} aria-label="OllO's face for this quote" onChange={(event) => updateCustomQuote(quote.id, { emotion: event.target.value as QuoteEmotion })}>
                  <option value="auto">Auto</option>
                  {(Object.keys(MOOD_LABELS) as Mood[]).map((m) => <option key={m} value={m}>{MOOD_LABELS[m]}</option>)}
                </select>
                <button className="text-icon danger" onClick={() => deleteCustomQuote(quote.id)} aria-label="Delete quote"><TrashIcon /></button>
              </div>)}
            </div>}
          </div>
          <label className="settings-field"><span>Default image mode</span><select value={library.settings.defaultImageMode} onChange={(event) => { const mode = event.target.value as ImageMode; setImageMode(mode); updateLibrary((previous) => ({ ...previous, settings: { ...previous.settings, defaultImageMode: mode } })); }}><option value="mono">Black & white</option><option value="gray2">Grayscale · 4 tones</option><option value="rgb565">Color</option></select></label>
          <button className="soft-button forget-device" onClick={() => { bleManager.forgetDevice(); setNotice('Saved glasses forgotten.'); }}>Forget saved glasses</button>
          <p className="settings-footnote">OllO does not currently include firmware update controls.</p>
        </section>
      )}

      {playScope && (() => {
        const pool = playScope === 'folder' ? library.cards.filter((card) => card.folder === selectedFolder) : library.cards;
        const resume = resumeCardFor(playScope);
        const resumeFolderCards = resume ? library.cards.filter((card) => card.folder === resume.folder) : [];
        const resumeText = resume
          ? `${playScope === 'all' ? `${resume.folder} · ` : ''}card ${resumeFolderCards.findIndex((card) => card.id === resume.id) + 1} of ${resumeFolderCards.length}`
          : 'Starts at the first card';
        return <div className="modal-backdrop" onClick={() => setPlayScope(null)} role="dialog" aria-label="Start studying"><div className="image-picker-modal play-chooser" onClick={(event) => event.stopPropagation()}>
          <div className="modal-title">Start studying</div>
          <p>{playScope === 'folder' ? selectedFolder : 'All folders'}</p>
          <button className="play-option" disabled={!pool.length} onClick={() => startPlay('continue')}><span className="play-option-icon"><PlayIcon /></span><span><strong>Where I left off</strong><small>{resumeText}</small></span></button>
          <button className="play-option" disabled={!pool.length} onClick={() => startPlay('random')}><span className="play-option-icon"><ShuffleIcon /></span><span><strong>Random card</strong><small>{playScope === 'folder' ? `Shuffled from ${selectedFolder}` : 'Shuffled from all folders'}</small></span></button>
          <div className="modal-actions"><button className="soft-button" onClick={() => setPlayScope(null)}>Cancel</button></div>
        </div></div>;
      })()}
      {viewerSrc && <div className="image-viewer" onClick={() => setViewerSrc(undefined)} role="dialog" aria-label="Full screen image"><button className="viewer-close" onClick={() => setViewerSrc(undefined)} aria-label="Close"><CloseIcon /></button><img src={viewerSrc} alt="Full screen card" /></div>}
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
