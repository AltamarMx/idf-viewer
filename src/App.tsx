import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { FileSource, FileSummary, LoadProgress } from './core/session';
import { ClassObjects } from './features/explorer/ClassObjects';
import { ClassTree } from './features/explorer/ClassTree';
import { Landing } from './features/gallery/Landing';
import { FileOverview } from './features/summary/FileOverview';
import { formatInt } from './ui/format';
import { useTheme } from './ui/useTheme';
import { openInWorker } from './worker/client';

type State =
  | { status: 'idle'; error?: string }
  | { status: 'loading'; name: string; progress: LoadProgress }
  | { status: 'ready'; summary: FileSummary };

type Tab = 'summary' | 'objects';

const STAGE_WEIGHT: Record<LoadProgress['stage'], [number, number]> = {
  reading: [0, 0.1],
  parsing: [0.1, 0.8],
  schema: [0.8, 0.95],
  indexing: [0.95, 1],
};

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [state, setState] = useState<State>({ status: 'idle' });
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('summary');
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

  const summary = state.status === 'ready' ? state.summary : null;

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
          <Panel defaultSize="24" minSize={180} className="pane">
            <ClassTree
              classes={summary.classes}
              selected={selectedClass}
              onSelect={(key) => {
                setSelectedClass(key);
                setTab('objects');
              }}
            />
          </Panel>
          <Separator className="separator" />
          <Panel className="pane">
            <div className="tabs" role="tablist">
              <TabButton id="summary" current={tab} onSelect={setTab}>
                Summary
              </TabButton>
              <TabButton id="objects" current={tab} onSelect={setTab}>
                Objects
              </TabButton>
            </div>
            {tab === 'summary' && <FileOverview summary={summary} />}
            {tab === 'objects' &&
              (selectedClass ? (
                <ClassObjects
                  key={`${summary.fileName}:${selectedClass}`}
                  classKey={selectedClass}
                  summary={summary}
                />
              ) : (
                <div className="content">Choose a class on the left.</div>
              ))}
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
