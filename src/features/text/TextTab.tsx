/**
 * Text view (B6): the IDF as written, with syntax colors, in sync with the
 * inspector. Selecting an object scrolls to its lines; clicking an object in
 * the text opens it in the inspector. Read-only; Ctrl/⌘+F searches.
 */
import {
  HighlightStyle,
  StreamLanguage,
  type StringStream,
  syntaxHighlighting,
} from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import {
  Compartment,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef, useState } from 'react';
import type { TextView } from '../../core/session';
import { idf } from '../../worker/client';

interface Props {
  selectedId: number | null;
  onSelect: (id: number) => void;
  dark: boolean;
}

interface IdfState {
  /** Inside an object, after its class name. */
  inObject: boolean;
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eEdD][-+]?\d+)?$/;

/** Colors: class names, numbers, "!" comments and "!-" field notes. */
const idfLanguage = StreamLanguage.define<IdfState>({
  name: 'idf',
  startState: () => ({ inObject: false }),
  token(stream: StringStream, state: IdfState) {
    if (stream.eatSpace()) return null;
    if (stream.match('!-')) {
      stream.skipToEnd();
      return 'meta';
    }
    if (stream.peek() === '!') {
      stream.skipToEnd();
      return 'comment';
    }
    const ch = stream.next();
    if (ch === ';') {
      state.inObject = false;
      return 'punctuation';
    }
    if (ch === ',') {
      state.inObject = true;
      return 'punctuation';
    }
    stream.match(/^[^,;!]*/);
    if (!state.inObject) return 'keyword';
    return NUMBER.test(stream.current().trim()) ? 'number' : null;
  },
  copyState: (s) => ({ ...s }),
});

const lightColors = HighlightStyle.define([
  { tag: tags.keyword, color: '#1f6fb2', fontWeight: '600' },
  { tag: tags.number, color: '#0b7a5a' },
  { tag: tags.comment, color: '#7a8591', fontStyle: 'italic' },
  { tag: tags.meta, color: '#9aa3ad' },
  { tag: tags.punctuation, color: '#56616d' },
]);

const darkColors = HighlightStyle.define([
  { tag: tags.keyword, color: '#6cb4ee', fontWeight: '600' },
  { tag: tags.number, color: '#7fd4b0' },
  { tag: tags.comment, color: '#8a96a3', fontStyle: 'italic' },
  { tag: tags.meta, color: '#6f7b87' },
  { tag: tags.punctuation, color: '#9aa6b2' },
]);

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.5' },
  '.cm-gutters': {
    background: 'var(--surface-2)',
    color: 'var(--text-2)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-selected-object': { background: 'var(--accent-soft)' },
  '.cm-content': { caretColor: 'var(--text)' },
});

const themed = (dark: boolean) => [
  syntaxHighlighting(dark ? darkColors : lightColors),
  EditorView.theme({}, { dark }),
];

/** Lines of the selected object, highlighted. */
const setObjectLines = StateEffect.define<{ from: number; to: number } | null>();

const objectLines = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setObjectLines)) continue;
      if (!effect.value) {
        next = Decoration.none;
        continue;
      }
      const builder = new RangeSetBuilder<Decoration>();
      const line = Decoration.line({ class: 'cm-selected-object' });
      for (let n = effect.value.from; n <= effect.value.to; n++) {
        const pos = tr.state.doc.line(n).from;
        builder.add(pos, pos, line);
      }
      next = builder.finish();
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Id of the object whose lines contain `line`, or null (between objects). */
function objectAt(view: TextView, line: number): number | null {
  const { starts, ends } = view;
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((starts[mid] as number) <= line) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 && line <= (ends[found] as number) ? found : null;
}

export default function TextTab({ selectedId, onSelect, dark }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const [text, setText] = useState<TextView | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  /** The selection came from a click in the text: do not scroll. */
  const clickedRef = useRef<number | null>(null);
  const themeRef = useRef(new Compartment());
  const darkRef = useRef(dark);
  darkRef.current = dark;

  useEffect(() => {
    idf.textView().then(setText);
  }, []);

  // Create the editor once the text arrives.
  useEffect(() => {
    const parent = containerRef.current;
    if (!parent || !text) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: text.text,
        extensions: [
          lineNumbers(),
          highlightSpecialChars(),
          drawSelection(),
          EditorState.readOnly.of(true),
          idfLanguage,
          themeRef.current.of(themed(darkRef.current)),
          search({ top: true }),
          highlightSelectionMatches(),
          keymap.of(searchKeymap),
          objectLines,
          editorTheme,
          EditorView.domEventHandlers({
            click(event, v) {
              // A drag selects text; only a plain click selects an object.
              if (!v.state.selection.main.empty) return false;
              const pos = v.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos === null) return false;
              const id = objectAt(text, v.state.doc.lineAt(pos).number);
              if (id !== null) {
                clickedRef.current = id;
                onSelectRef.current(id);
              }
              return false;
            },
          }),
        ],
      }),
    });
    editorRef.current = view;
    return () => {
      view.destroy();
      editorRef.current = null;
    };
  }, [text]);

  useEffect(() => {
    editorRef.current?.dispatch({ effects: themeRef.current.reconfigure(themed(dark)) });
  }, [dark]);

  // Follow the inspector: highlight the object and bring it into view.
  useEffect(() => {
    const view = editorRef.current;
    if (!view || !text) return;
    if (selectedId === null || selectedId >= text.starts.length) {
      view.dispatch({ effects: setObjectLines.of(null) });
      return;
    }
    const from = text.starts[selectedId] as number;
    const to = Math.min(text.ends[selectedId] as number, view.state.doc.lines);
    const fromClick = clickedRef.current === selectedId;
    clickedRef.current = null;
    view.dispatch({
      effects: [
        setObjectLines.of({ from, to }),
        ...(fromClick
          ? []
          : [
              EditorView.scrollIntoView(view.state.doc.line(from).from, {
                y: 'start',
                yMargin: 40,
              }),
            ]),
      ],
    });
  }, [selectedId, text]);

  if (!text) return <div className="content count">Reading the file…</div>;
  return (
    <div className="text-view">
      <p className="count text-hint">
        The file as written. Click an object to inspect it; {isMac() ? '⌘' : 'Ctrl+'}F searches.
      </p>
      <div ref={containerRef} className="text-editor" />
    </div>
  );
}

function isMac() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}
