import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type {
  FileSource,
  FileSummary,
  GeometryView,
  LoadProgress,
  ObjectDetail,
  ObjectRef,
} from './core/session';
import { ClassTree } from './features/explorer/ClassTree';
import { Landing } from './features/gallery/Landing';
import { displayName, downloadIdf, urlParameter, viewerLink } from './features/gallery/remote';
import { Inspector } from './features/inspector/Inspector';
import { ProblemsPanel } from './features/problems/ProblemsPanel';
import { SearchDialog } from './features/search/SearchDialog';
import { SummaryTab } from './features/summary/SummaryTab';
import { ClassTableView } from './features/table/ClassTableView';
import { formatInt } from './ui/format';
import { useTheme } from './ui/useTheme';
import { idf, openInWorker } from './worker/client';

const Viewer3D = lazy(() => import('./features/viewer3d/Viewer3D'));
const SchedulesTab = lazy(() => import('./features/schedules/SchedulesTab'));
const LoadsTab = lazy(() => import('./features/loads/LoadsTab'));
const VentilationTab = lazy(() => import('./features/ventilation/VentilationTab'));
const ConstructionsTab = lazy(() => import('./features/constructions/ConstructionsTab'));
const TextTab = lazy(() => import('./features/text/TextTab'));

type State =
  | { status: 'idle'; error?: string }
  | { status: 'loading'; name: string; progress: LoadProgress }
  | { status: 'ready'; summary: FileSummary };

type Tab =
  | 'summary'
  | '3d'
  | 'table'
  | 'text'
  | 'constructions'
  | 'ventilation'
  | 'schedules'
  | 'loads'
  | 'problems';

const STAGE_WEIGHT: Record<LoadProgress['stage'], [number, number]> = {
  reading: [0, 0.1],
  parsing: [0.1, 0.75],
  schema: [0.75, 0.85],
  indexing: [0.85, 1],
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** The viewer's folder; relative `?url=` addresses (the examples) are resolved against it. */
const BASE = new URL(import.meta.env.BASE_URL, window.location.origin).href;

/** Puts `?url=` in the address bar (or removes it) without adding a history entry. */
function setAddressBar(url: string | null) {
  window.history.replaceState(window.history.state, '', viewerLink(window.location.href, url));
}

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [state, setState] = useState<State>({ status: 'idle' });
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selection, setSelection] = useState<ObjectRef | null>(null);
  const [tab, setTab] = useState<Tab>('summary');
  const [geometry, setGeometry] = useState<GeometryView | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  // The address of the last file opened from a URL, kept for the start page if it fails.
  const [lastUrl, setLastUrl] = useState(() => urlParameter(window.location.search));
  const inputRef = useRef<HTMLInputElement>(null);
  const loadId = useRef(0);
  const startedFromAddress = useRef(false);

  const open = useCallback(
    async (source: FileSource | Promise<FileSource>, name: string, message = 'Reading file') => {
      const id = ++loadId.current;
      setState({ status: 'loading', name, progress: { stage: 'reading', message } });
      try {
        const summary = await openInWorker(await source, (progress) => {
          if (id === loadId.current) setState({ status: 'loading', name, progress });
        });
        if (id !== loadId.current) return;
        setSelectedClass(null);
        setSelectedId(null);
        setSelection(null);
        setGeometry(null);
        setTab('summary');
        setState({ status: 'ready', summary });
      } catch (error) {
        if (id !== loadId.current) return;
        setState({ status: 'idle', error: `Could not open ${name}: ${messageOf(error)}` });
      }
    },
    [],
  );

  // A file from the user's disk or pasted text: the address bar no longer names a file.
  const openLocal = useCallback(
    (source: FileSource | Promise<FileSource>, name: string) => {
      setAddressBar(null);
      setLastUrl(null);
      return open(source, name);
    },
    [open],
  );

  const openLocalFile = useCallback(
    (file: File) =>
      openLocal(
        file.arrayBuffer().then((buffer) => ({ name: file.name, buffer })),
        file.name,
      ),
    [openLocal],
  );

  // A file from a web address (A6), an example included: the address bar gets `?url=`, so
  // the page can be reloaded or shared and opens the same file.
  const openUrl = useCallback(
    (url: string) => {
      setAddressBar(url);
      setLastUrl(url);
      return open(downloadIdf(url, BASE), displayName(url, BASE), 'Downloading');
    },
    [open],
  );

  // `?url=` in the address when the page opens. The ref keeps StrictMode from downloading twice.
  useEffect(() => {
    if (startedFromAddress.current) return;
    startedFromAddress.current = true;
    const url = urlParameter(window.location.search);
    if (url) void openUrl(url);
  }, [openUrl]);

  const summary = state.status === 'ready' ? state.summary : null;

  // Geometry is computed in the worker the first time the 3D tab opens.
  useEffect(() => {
    if (tab !== '3d' || geometry || !summary) return;
    let cancelled = false;
    idf.geometry().then((g) => {
      if (!cancelled) setGeometry(g);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, geometry, summary]);

  // Ctrl/⌘+K opens the search (B4).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && summary) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [summary]);

  // Drop a file anywhere in the window (A1).
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) void openLocalFile(file);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [openLocalFile]);

  const onLoaded = useCallback((detail: ObjectDetail | null) => {
    setSelection(detail ? { id: detail.id, className: detail.className, name: detail.name } : null);
    if (detail) setSelectedClass(detail.classKey);
  }, []);

  const problems = summary?.problemCounts;

  return (
    <div className="app">
      <header className="header">
        <button
          type="button"
          className="brand"
          onClick={() => {
            setAddressBar(null);
            setState({ status: 'idle' });
          }}
          title="Back to the start page"
        >
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          IDF Viewer
        </button>
        {summary && (
          <span className="file-meta" title={summary.fileName}>
            <strong>{summary.fileName}</strong> · {versionLabel(summary)} ·{' '}
            {formatInt(summary.objectCount)} objects
          </span>
        )}
        <div className="header-actions">
          {summary && (
            <button type="button" className="btn search-button" onClick={() => setSearchOpen(true)}>
              Search <kbd>{isMac ? '⌘' : 'Ctrl+'}K</kbd>
            </button>
          )}
          <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
            Open file
          </button>
          <button
            type="button"
            className="btn"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".idf,.IDF,.imf,.txt,.epJSON,.epjson,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void openLocalFile(file);
            e.target.value = '';
          }}
        />
      </header>

      {summary ? (
        <Group orientation="horizontal" className="main">
          <Panel defaultSize="20" minSize={160} className="pane">
            <ClassTree
              classes={summary.classes}
              selected={selectedClass}
              onSelect={(key) => {
                setSelectedClass(key);
                setTab('table');
              }}
            />
          </Panel>
          <Separator className="separator" />
          <Panel minSize={300} className="pane center">
            <div className="tabs" role="tablist">
              <TabButton id="summary" current={tab} onSelect={setTab}>
                Summary
              </TabButton>
              <TabButton id="3d" current={tab} onSelect={setTab}>
                3D
              </TabButton>
              <TabButton id="table" current={tab} onSelect={setTab}>
                Table
              </TabButton>
              <TabButton id="text" current={tab} onSelect={setTab}>
                Text
              </TabButton>
              <TabButton id="constructions" current={tab} onSelect={setTab}>
                Constructions
              </TabButton>
              <TabButton id="ventilation" current={tab} onSelect={setTab}>
                Ventilation
              </TabButton>
              <TabButton id="schedules" current={tab} onSelect={setTab}>
                Schedules
              </TabButton>
              <TabButton id="loads" current={tab} onSelect={setTab}>
                Loads
              </TabButton>
              <TabButton id="problems" current={tab} onSelect={setTab}>
                Problems
                {problems && problems.error + problems.warning > 0 && (
                  <span className={`badge ${problems.error ? 'error' : 'warning'}`}>
                    {formatInt(problems.error + problems.warning)}
                  </span>
                )}
              </TabButton>
            </div>
            <div className="tab-body">
              {tab === 'summary' && (
                <SummaryTab key={summary.fileName} summary={summary} onSelect={setSelectedId} />
              )}
              {tab === '3d' &&
                (geometry ? (
                  <Suspense fallback={<div className="content count">Loading 3D…</div>}>
                    <Viewer3D
                      geometry={geometry}
                      selection={selection}
                      onSelect={setSelectedId}
                      onClear={() => setSelectedId(null)}
                      dark={theme === 'dark'}
                    />
                  </Suspense>
                ) : (
                  <div className="content count">Building geometry…</div>
                ))}
              {tab === 'table' &&
                (selectedClass ? (
                  <ClassTableView
                    classKey={selectedClass}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                ) : (
                  <div className="content">Choose a class on the left.</div>
                ))}
              {tab === 'text' && (
                <Suspense fallback={<div className="content count">Loading…</div>}>
                  <TextTab
                    key={summary.fileName}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    dark={theme === 'dark'}
                  />
                </Suspense>
              )}
              {tab === 'constructions' && (
                <Suspense fallback={<div className="content count">Loading…</div>}>
                  <ConstructionsTab
                    key={summary.fileName}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onShow3D={(id) => {
                      setSelectedId(id);
                      setTab('3d');
                    }}
                  />
                </Suspense>
              )}
              {tab === 'ventilation' && (
                <Suspense fallback={<div className="content count">Loading…</div>}>
                  <VentilationTab
                    key={summary.fileName}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onShow3D={(id) => {
                      setSelectedId(id);
                      setTab('3d');
                    }}
                    dark={theme === 'dark'}
                  />
                </Suspense>
              )}
              {(tab === 'schedules' || tab === 'loads') && (
                <Suspense fallback={<div className="content count">Loading charts…</div>}>
                  {tab === 'schedules' ? (
                    <SchedulesTab
                      key={summary.fileName}
                      dark={theme === 'dark'}
                      onSelect={setSelectedId}
                    />
                  ) : (
                    <LoadsTab
                      key={summary.fileName}
                      dark={theme === 'dark'}
                      onSelect={setSelectedId}
                    />
                  )}
                </Suspense>
              )}
              {tab === 'problems' && <ProblemsPanel onSelect={setSelectedId} />}
            </div>
          </Panel>
          <Separator className="separator" />
          <Panel defaultSize="28" minSize={220} className="pane">
            <Inspector id={selectedId} onSelect={setSelectedId} onLoaded={onLoaded} />
          </Panel>
        </Group>
      ) : (
        <div className="pane">
          <Landing
            error={state.status === 'idle' ? state.error : undefined}
            lastUrl={lastUrl ?? undefined}
            onPickFile={() => inputRef.current?.click()}
            onOpenUrl={(url) => void openUrl(url)}
            onOpenText={(text) => openLocal({ name: 'Pasted text', text }, 'pasted text')}
          />
        </div>
      )}

      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={setSelectedId}
      />
      {state.status === 'loading' && <LoadingOverlay name={state.name} progress={state.progress} />}
      {dragging && <div className="drop-hint">Drop the IDF file to open it</div>}
    </div>
  );
}

function TabButton(props: {
  id: Tab;
  current: Tab;
  onSelect: (tab: Tab) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      className="tab"
      aria-selected={props.current === props.id}
      onClick={() => props.onSelect(props.id)}
    >
      {props.children}
    </button>
  );
}

function LoadingOverlay({ name, progress }: { name: string; progress: LoadProgress }) {
  const [from, to] = STAGE_WEIGHT[progress.stage];
  const overall = from + (to - from) * (progress.fraction ?? 0);
  return (
    <div className="overlay" role="status" aria-live="polite">
      <div className="progress-card">
        <div>
          Opening <strong>{name}</strong>
        </div>
        <div className="count">{progress.message}…</div>
        <div className="progress">
          <div style={{ width: `${Math.round(overall * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

function versionLabel(summary: FileSummary): string {
  const r = summary.resolution;
  const format = summary.format === 'epjson' ? ' · epJSON' : '';
  if (r.kind === 'none') return `no version${format}`;
  return `v${r.fileVersion}${format}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
