// The glass bar that rises when you tap verses: one button for each kind of study.
import { IconClose, IconNotes, IconPin, IconQuill, IconWords } from './Icons'
import { TOOL_NAMES, runsLabel, type Tool } from './Panel'

const TOOLS: { id: Tool; icon: React.ReactNode }[] = [
  { id: 'mine', icon: <IconNotes /> },
  { id: 'voices', icon: <IconQuill /> },
  { id: 'context', icon: <IconPin /> },
  { id: 'words', icon: <IconWords /> },
]

export function ActionBar({ verses, tool, onTool, onClear }: { verses: number[]; tool: Tool | null; onTool: (t: Tool) => void; onClear: () => void }) {
  return (
    <div className="action-bar" role="toolbar" aria-label={`Study ${runsLabel(verses)}`}>
      <div className="ab-head">
        <span className="ab-ref">{runsLabel(verses)}</span>
        <button className="ab-clear" onClick={onClear} aria-label="Unmark all verses" title="Unmark all"><IconClose size={15} /></button>
      </div>
      <div className="ab-tools">
        {TOOLS.map(t => (
          <button key={t.id} className={`ab-tool ${tool === t.id ? 'is-on' : ''}`} aria-pressed={tool === t.id} onClick={() => onTool(t.id)}>
            {t.icon}<span>{TOOL_NAMES[t.id]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
