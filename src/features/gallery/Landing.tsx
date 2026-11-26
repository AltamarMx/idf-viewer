import { useEffect, useState } from 'react';
import { formatBytes } from '../../ui/format';

interface ExampleEntry {
  file: string;
  title: string;
  description?: string;
  size: number;
  version?: string;
}

interface Props {
  error?: string;
  /** Address of the last file opened from a URL, if that was the last thing opened. */
  lastUrl?: string;
  onPickFile: () => void;
  /** A web address, or a path relative to the viewer such as `examples/…`. */
  onOpenUrl: (url: string) => void;
  onOpenText: (text: string) => void;
}

const EXAMPLES_URL = `${import.meta.env.BASE_URL}examples/`;

/** Start page: open a local file (A1), a file from a URL (A6) or an example from the gallery. */
export function Landing({ error, lastUrl, onPickFile, onOpenUrl, onOpenText }: Props) {
  const [examples, setExamples] = useState<ExampleEntry[] | null>(null);
  const [pasted, setPasted] = useState('');
  const [address, setAddress] = useState(lastUrl ?? '');

  useEffect(() => {
    let cancelled = false;
    fetch(`${EXAMPLES_URL}index.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: ExampleEntry[]) => {
        if (!cancelled) setExamples(list);
      })
      .catch(() => {
        if (!cancelled) setExamples([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="landing">
      <h1>IDF Viewer</h1>
      <p className="tagline">Explore EnergyPlus input files, from version 8.0 to 26.2.</p>

      {error && <div className="notice error">{error}</div>}

      <div className="dropzone">
        <p>
          <strong>Drop an .idf file anywhere on this page</strong>
        </p>
        <p>
          <button type="button" className="btn primary" onClick={onPickFile}>
            Choose a file…
          </button>
        </p>
        <p className="privacy">
          Your file is read by your browser and is never uploaded to any server.
        </p>
      </div>

      <details className="paste">
        <summary>Or paste IDF text</summary>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder={'Version, 26.2;\n\nZone,\n  Living Room;   !- Name'}
          spellCheck={false}
        />
        <p>
          <button
            type="button"
            className="btn"
            disabled={!pasted.trim()}
            onClick={() => onOpenText(pasted)}
          >
            Open pasted text
          </button>
        </p>
      </details>

      <details className="paste" open={Boolean(error && lastUrl)}>
        <summary>Or open from a URL</summary>
        <form
          className="url-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (address.trim()) onOpenUrl(address.trim());
          }}
        >
          <input
            type="text"
            inputMode="url"
            aria-label="Address of the IDF file"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="https://github.com/user/repository/blob/main/model.idf"
            spellCheck={false}
            autoComplete="off"
          />
          <button type="submit" className="btn" disabled={!address.trim()}>
            Open
          </button>
        </form>
        <p className="privacy">
          Your browser downloads the file directly from that server, which must allow other sites to
          read it (CORS). Links to files on GitHub and Gist work. The page address then opens the
          same file, so you can share it: <code>?url=</code> followed by the file's address.
        </p>
      </details>

      <h3>Examples</h3>
      {examples === null && <p className="count">Loading examples…</p>}
      {examples?.length === 0 && <p className="count">No examples available.</p>}
      {examples && examples.length > 0 && (
        <div className="examples">
          {examples.map((example) => (
            <button
              type="button"
              key={example.file}
              className="example"
              onClick={() => onOpenUrl(`examples/${encodeURIComponent(example.file)}`)}
            >
              <div className="title">{example.title}</div>
              {example.description && <div className="desc">{example.description}</div>}
              <div className="meta">
                {example.version ? `v${example.version} · ` : ''}
                {formatBytes(example.size)}
              </div>
            </button>
          ))}
        </div>
      )}
      <p className="privacy">
        Examples are from the EnergyPlus distribution (
        <a href={`${EXAMPLES_URL}LICENSE-EnergyPlus.txt`}>license</a>).
      </p>
    </div>
  );
}
