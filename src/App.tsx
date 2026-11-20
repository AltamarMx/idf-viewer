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
import { Inspector } from './features/inspector/Inspector';
import { ProblemsPanel } from './features/problems/ProblemsPanel';
import { SearchDialog } from './features/search/SearchDialog';
import { FileOverview } from './features/summary/FileOverview';
import { ClassTableView } from './features/table/ClassTableView';
import { formatInt } from './ui/format';
import { useTheme } from './ui/useTheme';
import { idf, openInWorker } from './worker/client';

const Viewer3D = lazy(() => import('./features/viewer3d/Viewer3D'));

type State =
  | { status: 'idle'; error?: string }
  | { status: 'loading'; name: string; progress: LoadProgress }
  | { status: 'ready'; summary: FileSummary };

type Tab = 'summary' | '3d' | 'table' | 'problems';

const STAGE_WEIGHT: Record<LoadProgress['stage'], [number, number]> = {
  reading: [0, 0.1],
  parsing: [0.1, 0.75],
  schema: [0.75, 0.85],
  indexing: [0.85, 1],
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

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
  const inputRef = useRef<HTMLInputElement>(null);
  const loadId = useRef(0);

  const open = useCallback(async (source: FileSource | Promise<FileSource>, name: string) => {
    const id = ++loadId.current;
    setState({ status: 'loading', name, progress: { stage: 'reading', message: 'Reading file' } });
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
  }, []);

  const openLocalFile = useCallback(
    (file: File) =>
      open(
        file.arrayBuffer().then((buffer) => ({ name: file.name, buffer })),
        file.name,
      ),
    [open],
  );

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
          onClick={() => setState({ status: 'idle' })}
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
          accept=".idf,.IDF,.imf,.txt"
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
              {tab === 'summary' && <FileOverview summary={summary} />}
              {tab === '3d' &&
                (geometry ? (
                  <Suspense fallback={<div className="content count">Loading 3D…</div>}>
                    <Viewer3D
                      geometry={geometry}
                      selection={selection}
                      onSelect={setSelectedId}
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
            onPickFile={() => inputRef.current?.click()}
            onOpenUrl={(url, name) =>
              open(
                fetch(url).then(async (r) => {
                  if (!r.ok) throw new Error(`download failed (${r.status})`);
                  return { name, buffer: await r.arrayBuffer() };
                }),
                name,
              )
            }
            onOpenText={(text) => open({ name: 'Pasted text', text }, 'pasted text')}
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
  if (r.kind === 'none') return 'no version';
  return `v${r.fileVersion}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
