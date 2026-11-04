import { useEffect, useMemo, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { Card, ImageMode, LibraryData, StoredImage } from './types';
import { getAllImages, loadLibrary, saveImage, saveLibrary } from './storage';
import { convertImage, imageModeLabel } from './imageCodec';
import { bleManager } from './ble/BleManager';
import type { DeviceInfo, StorageInfo } from './ble/protocol';
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

function GlassesMark() {
  return (
    <svg className="glasses-mark" viewBox="0 0 150 65" role="img" aria-label="OllO glasses">
      <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h53v36a9 9 0 0 1-9 9H14a9 9 0 0 1-9-9z" />
        <path d="M92 12h53v36a9 9 0 0 1-9 9h-35a9 9 0 0 1-9-9z" />
        <path d="M58 23h34" />
      </g>
      <circle cx="31" cy="38" r="6" fill="currentColor" />
      <circle cx="119" cy="38" r="6" fill="currentColor" />
    </svg>
  );
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
  const [studyBack, setStudyBack] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState('');
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const [imageMode, setImageMode] = useState<ImageMode>('gray2');
  const [imageTarget, setImageTarget] = useState<CardSide>('front');
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>(bleManager.state);
  const [connectionMessage, setConnectionMessage] = useState('Not connected');
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | undefined>(bleManager.info);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | undefined>(bleManager.storage);
  const [syncProgress, setSyncProgress] = useState({ done: 0, total: 0, label: 'Ready to synchronize' });
  const [syncBusy, setSyncBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const loaded = await loadLibrary();
      const storedImages = await getAllImages();
      if (!mounted) return;
      setLibrary(loaded);
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
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
  const studyCards = folderCards;
  const activeStudyCard = studyCards[studyIndex];
  const activeEditorImageId = editorCard ? (editorSide === 'front' ? editorCard.frontImageId : editorCard.backImageId) : undefined;
  const activeEditorImage = activeEditorImageId ? images.get(activeEditorImageId) : undefined;
  const allImageRecords = [...images.values()];
  const referencedImageIds = new Set(library?.cards.flatMap((card) => [card.frontImageId, card.backImageId].filter((id): id is number => typeof id === 'number')) ?? []);
  const referencedImages = allImageRecords.filter((image) => referencedImageIds.has(image.id));
  const syncedCounts = library?.lastSyncedCounts ?? { cards: 0, images: 0, folders: 0 };
  const freeBytes = storageInfo ? Math.max(0, storageInfo.totalBytes - storageInfo.usedBytes) : undefined;

  function updateLibrary(updater: (previous: LibraryData) => LibraryData) {
    setLibrary((previous) => {
      if (!previous) return previous;
      const next = updater(previous);
      void saveLibrary(next);
      return next;
    });
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
    setEditorCard({ ...card });
    setEditorSide('front');
    setScreen('editor');
  }

  function saveEditor() {
    if (!editorCard || !library) return;
    const folder = editorCard.folder.trim() || 'OllO';
    if (byteLength(folder) > 20) {
      setNotice('Folder names must be 20 UTF-8 bytes or fewer.');
      return;
    }
    if (byteLength(editorCard.front) > 100 || byteLength(editorCard.back) > 100) {
      setNotice('Each card side must be 100 UTF-8 bytes or fewer for the current glasses protocol.');
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

  function rateCard(rating: 1 | 2 | 3 | 4) {
    if (!activeStudyCard) return;
    updateLibrary((previous) => ({ ...previous, cards: previous.cards.map((card) => card.id === activeStudyCard.id ? { ...card, rating } : card) }));
  }

  async function processSelectedImage(file?: File) {
    if (!file || !editorCard) return;
    try {
      const converted = await convertImage(file, imageMode);
      await saveImage(converted);
      setImages((previous) => new Map(previous).set(converted.id, converted));
      setEditorCard((previous) => previous ? {
        ...previous,
        [imageTarget === 'front' ? 'frontImageId' : 'backImageId']: converted.id
      } : previous);
      setShowImagePicker(false);
      setNotice(`${imageModeLabel(imageMode)} image added`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Image conversion failed.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
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
    else if (screen === 'study' || screen === 'editor') setScreen('folder');
    else setScreen('home');
  }

  if (!library) return <main className="loading-screen"><GlassesMark /><p>Preparing OllO…</p></main>;

  return (
    <main className="app-shell">
      <header className="topbar">
        {screen !== 'home' ? <button className="icon-button back-button" onClick={navigateBack} aria-label="Go back">←</button> : <button className={`icon-button ${bookmarksOnly ? 'active' : ''}`} onClick={() => setBookmarksOnly((value) => !value)} aria-label="Show bookmarks">▮</button>}
        {screen === 'home' ? (
          <div className="top-actions">
            {showSearch && <input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search folders and cards" autoFocus />}
            <button className="icon-button" onClick={() => { setShowSearch((value) => !value); if (showSearch) setSearch(''); }} aria-label="Search">⌕</button>
            <button className="pill-button" onClick={() => setScreen('sync')}>sync</button>
          </div>
        ) : (
          <>
            <div className="page-heading">{screen === 'folder' ? selectedFolder : screen === 'study' ? 'STUDY' : screen === 'editor' ? 'EDIT' : screen === 'sync' ? 'sync' : 'SETTINGS'}</div>
            {screen === 'folder' && <button className="pill-button" onClick={() => setScreen('sync')}>sync</button>}
            {screen === 'editor' && <button className="icon-button danger" onClick={deleteCurrentCard} aria-label="Delete card">▤</button>}
          </>
        )}
      </header>

      {screen === 'home' && (
        <section className="home-screen">
          <div className="motivation-row">
            <div className="quote">{library.settings.motivationalQuote}</div>
            <GlassesMark />
          </div>
          <div className="folder-list">
            {homeFolders.length === 0 ? <div className="empty-state">No folders yet. Add your first flashcard.</div> : homeFolders.map((folder) => {
              const count = library.cards.filter((card) => card.folder === folder).length;
              return <button className="folder-tile" key={folder} onClick={() => openFolder(folder)}><strong>{folder}</strong><span>{count} {count === 1 ? 'card' : 'cards'}</span></button>;
            })}
          </div>
          <div className="home-bottom-actions">
            <button className="floating-play" onClick={() => { if (folders.length) { setSelectedFolder(folders[0]); setStudyIndex(0); setStudyBack(false); setScreen('study'); } }} aria-label="Start studying">▶</button>
            <button className="floating-add" onClick={() => {
              const folder = window.prompt('Folder name for the new card', selectedFolder || 'OllO')?.trim();
              if (!folder) return;
              if (byteLength(folder) > 20) { setNotice('Folder names must be 20 UTF-8 bytes or fewer.'); return; }
              startNewCard(folder);
            }} aria-label="Add flashcard">＋</button>
          </div>
        </section>
      )}

      {screen === 'folder' && (
        <section className="folder-screen">
          <div className="folder-management-card">
            <div className="folder-management-top"><strong>{selectedFolder}</strong><div className="row-actions"><button className="text-icon muted" onClick={renameFolder} aria-label="Rename folder">✎</button><button className="text-icon danger" onClick={deleteFolder} aria-label="Delete folder">▤</button></div></div>
            <div className="folder-management-bottom"><span>{folderCards.length} cards</span><span className="synced-label">{library.lastSyncedAt ? 'Synced' : 'Not synced'}</span></div>
          </div>
          <div className="folder-card-list">
            {folderCards.map((card) => <button className="flashcard-preview" key={card.id} onClick={() => { setSelectedCardId(card.id); setStudyIndex(folderCards.findIndex((item) => item.id === card.id)); setStudyBack(false); setScreen('study'); }}>
              {card.frontImageId && images.get(card.frontImageId) ? <img src={images.get(card.frontImageId)?.preview} alt="Card front" /> : <span>{card.front || 'Untitled card'}</span>}
            </button>)}
          </div>
          <div className="home-bottom-actions"><button className="floating-play" onClick={() => { setStudyIndex(0); setStudyBack(false); setScreen('study'); }} aria-label="Study folder">▶</button><button className="floating-add" onClick={() => startNewCard(selectedFolder)} aria-label="Add flashcard">＋</button></div>
        </section>
      )}

      {screen === 'study' && (
        <section className="study-screen">
          {activeStudyCard ? <>
            <div className="study-top-actions"><button className={`round-action ${activeStudyCard.bookmarked ? 'selected' : ''}`} onClick={() => toggleBookmark(activeStudyCard.id)} aria-label="Bookmark card">▮</button><button className="round-action" onClick={() => openEditor(activeStudyCard)} aria-label="Edit card">✎</button></div>
            <button className="study-card" onClick={() => setStudyBack((value) => !value)}>
              {((studyBack ? activeStudyCard.backImageId : activeStudyCard.frontImageId) && images.get((studyBack ? activeStudyCard.backImageId : activeStudyCard.frontImageId)!)) ? <img src={images.get((studyBack ? activeStudyCard.backImageId : activeStudyCard.frontImageId)!)?.preview} alt="Flashcard" /> : <span>{studyBack ? activeStudyCard.back : activeStudyCard.front}</span>}
            </button>
            <div className="study-navigation"><button onClick={() => { setStudyIndex((value) => Math.max(0, value - 1)); setStudyBack(false); }} aria-label="Previous card">←</button><button onClick={() => setStudyBack((value) => !value)} aria-label="Flip card">↶</button><button onClick={() => { setStudyIndex((value) => Math.min(studyCards.length - 1, value + 1)); setStudyBack(false); }} aria-label="Next card">→</button></div>
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
          <div className="editor-side-tabs"><button className={editorSide === 'front' ? 'selected' : ''} onClick={() => setEditorSide('front')}>FRONT</button><button className={editorSide === 'back' ? 'selected' : ''} onClick={() => setEditorSide('back')}>BACK</button></div>
          <label className="field-label">Folder<input className="text-field compact" value={editorCard.folder} onChange={(event) => setEditorCard({ ...editorCard, folder: event.target.value })} maxLength={40} /></label>
          <textarea className="card-editor-text" placeholder={editorSide === 'front' ? 'Write the question…' : 'Write the answer…'} value={editorCard[editorSide]} onChange={(event) => setEditorCard({ ...editorCard, [editorSide]: event.target.value })} />
          <div className="editor-counter">{byteLength(editorCard[editorSide])} / 100 bytes · supported by current glasses firmware</div>
          {activeEditorImage && <div className="editor-image-preview"><img src={activeEditorImage.preview} alt="Selected card image" /><div><strong>{imageModeLabel(activeEditorImage.mode)}</strong><span>{activeEditorImage.width} × {activeEditorImage.height}</span><button className="text-link danger" onClick={removeEditorImage}>Remove image</button></div></div>}
          <div className="editor-actions"><button className="soft-button" onClick={() => { setImageTarget(editorSide); setShowImagePicker(true); }}>Add image</button><button className="soft-button flip-editor" onClick={() => setEditorSide((value) => value === 'front' ? 'back' : 'front')}>↶</button></div>
          <button className="primary-button save-button" onClick={saveEditor}>SAVE CARD</button>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => void processSelectedImage(event.target.files?.[0])} />
          {showImagePicker && <div className="modal-backdrop" onClick={() => setShowImagePicker(false)}><div className="image-picker-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title">Add image</div>
            <p>Choose how OllO should encode this image.</p>
            <div className="mode-options">
              {(['mono', 'gray2', 'rgb565'] as ImageMode[]).map((mode) => <button key={mode} className={imageMode === mode ? 'mode-option selected' : 'mode-option'} onClick={() => setImageMode(mode)}><span className={`mode-dot ${mode}`} /><span>{imageModeLabel(mode)}</span>{imageMode === mode && <b>✓</b>}</button>)}
            </div>
            <p className="mode-hint">Grayscale is four-tone (2-bit). RGB565 is stored in color format, but the current glasses renderer converts it to a dithered monochrome display.</p>
            <div className="modal-actions"><button className="soft-button" onClick={() => setShowImagePicker(false)}>Cancel</button><button className="primary-button" onClick={() => fileInput.current?.click()}>Choose image</button></div>
          </div></div>}
        </section>
      )}

      {screen === 'sync' && (
        <section className="sync-screen">
          <div className="device-panel">
            <div className="device-heading"><div className="bluetooth-symbol">ᛒ</div><div><strong>OllO Glasses</strong><span className={connection === 'connected' ? 'device-connected' : 'device-disconnected'}>Status: {connection === 'connected' ? 'CONNECTED' : connection === 'connecting' ? 'CONNECTING' : 'DISCONNECTED'}</span></div></div>
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
          <label className="settings-field"><span>Motivational quote</span><textarea value={library.settings.motivationalQuote} onChange={(event) => updateLibrary((previous) => ({ ...previous, settings: { ...previous.settings, motivationalQuote: event.target.value } }))} /></label>
          <label className="settings-field"><span>Default image mode</span><select value={library.settings.defaultImageMode} onChange={(event) => { const mode = event.target.value as ImageMode; setImageMode(mode); updateLibrary((previous) => ({ ...previous, settings: { ...previous.settings, defaultImageMode: mode } })); }}><option value="mono">Black & white</option><option value="gray2">Grayscale · 4 tones</option><option value="rgb565">Color · RGB565</option></select></label>
          <button className="soft-button forget-device" onClick={() => { bleManager.forgetDevice(); setNotice('Saved glasses forgotten.'); }}>Forget saved glasses</button>
          <p className="settings-footnote">OllO does not currently include firmware update controls.</p>
        </section>
      )}

      {screen === 'home' && <button className="settings-shortcut" onClick={() => setScreen('settings')} aria-label="Settings">⚙</button>}
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
