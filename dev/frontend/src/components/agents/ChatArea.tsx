import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send,
  Wrench,
  FlaskConical,
  User,
  PenTool,
  Briefcase,
  FileText,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronRight,
  AtSign,
  Wifi,
  WifiOff,
  ShieldAlert,
  Check,
  X,
  ArrowDown,
  Terminal,
  FileEdit,
  FolderSearch,
  Globe,
  Search,
  Square,
  Paperclip,
} from 'lucide-react'
import { agentSessionsAPI, type AgentSessionAttachment } from '@/lib/api'
import {
  useAgentWebSocket,
  type HookEvent,
  type MessageAttachment as WsMessageAttachment,
} from '@/hooks/useAgentWebSocket'

const storageKey = (agentId: string) => `atlas-agent-session-${agentId}`

// === Terminal Artifact Stripping ===

// ANSI escape sequences (with ESC prefix)
const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_])*|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;

// Malformed CSI sequences (without ESC prefix) - these leak through often
const MALFORMED_CSI = /\[[\d;]*[A-Za-z]/g;

// Orphaned ANSI parameters (color codes, cursor positions)
const ORPHANED_ANSI_PARAMS = /(?:^|[^a-zA-Z])(\d{1,3}m|0m|49m|39m|\d{1,3};\d{1,3}[mHJ])/g;

// Spinner and UI characters (Unicode) + ALL box drawing characters
const SPINNER_CHARS = /[✻✶✳✢·✽∴⏺⏵▐▛█▜▌▝▘↑↓⎿�─━│┃┌┐└┘├┤┬┴┼╭╮╰╯╴╵╶╷╸╹╺╻┄┅┆┇┈┉┊┋]/g;

// Cursor movement garbage patterns (only clearly invalid combinations)
// NOTE: Do NOT add common letter pairs like 'ng' - they appear in real words
const CURSOR_GARBAGE = /(?:T[wsi]|wt|sn|tg)+/g;

// All artifact patterns to remove
const ARTIFACT_PATTERNS = [
  // Malformed ANSI/cursor garbage
  MALFORMED_CSI,
  ORPHANED_ANSI_PARAMS,
  CURSOR_GARBAGE,
  // Random digit sequences (leftover ANSI parameters) - handled separately (no lookbehind)
  /\)\d{3,}/g,  // ) followed by digits
  /\d+\)/g,  // digits followed by )
  // Status bar
  /\(esc to interrupt[^)]*\)/gi,
  /\d+\.?\d*k?\s*tokens?/gi,
  /thought for \d+s?\)?/gi,
  /\(shift\+Tab[^)]*\)/gi,
  /running (?:stop ?)?hooks?[^·\n]*/gi,
  /bypass permissions on[^\n]*/gi,
  /ctrl\+o to expand/gi,
  /think[a-z]*\)/gi,  // "Thinking)", "thinki)", etc.
  /inking\)/gi,  // "inking)" when "Th" is erased
  /nking\)/gi,  // "nking)" partial
  /ought for/gi,  // Partial "thought for"
  /cceeded/gi,  // Partial "succeeded"
  /ucceeded/gi,  // Partial "succeeded"
  /uceded/gi,  // Partial "succeeded"
  /earc\(/gi,  // Partial "Search("
  /earch\(/gi,  // Partial "Search("
  /hok\b/gi,  // Partial "hook"
  /suces/gi,  // Partial "success"
  // Hook messages
  /(?:Pre|Post)ToolUse:[^\n]*/g,
  /SessionStart:[^\n]*/g,
  /Callback hook[^\n]*/g,
  /hook succeeded[^\n]*/g,
  /hook suceded[^\n]*/gi,
  /reTolUse/gi,
  // Banner
  /Claude Code v[\d.]+/g,
  /Opus \d+\.\d+/g,
  /Claude Max/g,
  /~\/\.codos\/sessions\/[a-f0-9-]+/g,
  // Thinking indicator (all variations including partial)
  /\bThinking\.{0,3}\b/gi,
  /\bthinking\b/gi,
  /(?:thinking\d*)+/gi,
  /(?:thinki\d*)+/gi,  // Partial "thinki" with numbers
  /thinki\)/gi,  // "thinki)" standalone
  // Processing indicators
  /\b[A-Z][a-z]{2,14}…/g,
  /\b[A-Z][a-z]{2,14}\.{3}/g,
  /([A-Za-z])\1{1,}[A-Za-z]*…/g,
  /[A-Za-z]{1,4}[…\.]+[A-Za-z]{1,4}[…\.]+[A-Za-z]*/g,
  /^\s*[A-Za-z]{3,15}…\s*$/gm,
  /…+/g,  // All ellipsis characters
  // Mixed letter/number garbage from animation frames
  /[A-Za-z]\d[A-Za-z]\d[A-Za-z\d]+/g,  // Ca1an34ei8rt...
  /\d[A-Za-z]\d[A-Za-z][A-Za-z\d]+/g,  // 1a2b3c...
  // Issue 3: Welcome banner
  /Welcome back [A-Z]+!/gi,
  /Recent activity/gi,
  /No recent activity/gi,
  /What's new/gi,
  /Added support for[^\n]*/gi,
  /Fixed shell completion[^\n]*/gi,
  /Fixed API errors[^\n]*/gi,
  /\/release-notes for more/gi,
  /\S+@\S+\.\S+/gi,
  /\bOrganization\b/gi,
  /~\/…\/sessions\/[a-f0-9-]+/gi,
  // Issue 4: Installer message
  /installer\.\s*Run\s*`claude install`[^\n]*/gi,
  /https:\/\/docs\.anthropic\.com\/[^\s]*/gi,
  /getting-started for more options\.?/gi,
  // Read tool output artifacts
  /Read \d+ lines/gi,
  /Read\([^)]+\)/g,
  /Found \d+ files?\s*\(\)/gi,
  // Prompt
  /❯[^\n]*/g,
  // 7m escape for bold/inverse
  /\[7m/g,
  // Internal Claude Code formatting
  /<\/?conversation_history>/gi,
  /<\/?system-reminder>/gi,
  /<\/?antml:[^>]+>/gi,
  // Prompt artifacts
  /\bser\]:/gi,
  /\buser\]:/gi,
  /\bassistant\]:/gi,
  // UI hints
  /ctrl\+g to edit[^\n]*/gi,
  /ctrl\+[a-z] to [^\n]*/gi,
  /shift\+enter[^\n]*/gi,
  // Random ANSI garbage (mixed letters/numbers with no spaces, 10+ chars) - handled separately (no lookbehind)
];

function stripTerminalArtifacts(text: string): string {
  // 1. ANSI codes with ESC prefix
  let clean = text.replace(ANSI_PATTERN, '');

  // 2. Malformed CSI (without ESC prefix) - run early
  clean = clean.replace(MALFORMED_CSI, '');

  // 3. Orphaned ANSI parameters
  clean = clean.replace(ORPHANED_ANSI_PARAMS, '');

  // 4. Cursor garbage patterns
  clean = clean.replace(CURSOR_GARBAGE, '');

  // 5. Spinner/UI chars
  clean = clean.replace(SPINNER_CHARS, '');

  // 6. All artifact patterns (multiple passes for nested artifacts)
  for (let pass = 0; pass < 2; pass++) {
    for (const pattern of ARTIFACT_PATTERNS) {
      clean = clean.replace(pattern, '');
    }
  }

  // 6.5 Lookbehind-free cleanup for digit/garbage patterns
  // Remove 5+ digit sequences not preceded by letters, preserving prefix char.
  clean = clean.replace(/(^|[^a-zA-Z])(\d{5,})/g, '$1');
  // Remove mixed letter/number garbage not preceded by letters, preserving prefix char.
  clean = clean.replace(/(^|[^a-zA-Z])([a-z]{2,4}\d[a-z]{2,4}\d[a-z\d]{5,})/gi, '$1');

  // 7. Clean up orphaned parentheses with just numbers/spaces
  clean = clean.replace(/\(\s*\d*\s*\)/g, '');
  clean = clean.replace(/\[\s*\d*\s*\]/g, '');

  // 8. Remove lines that are just numbers or garbage
  clean = clean
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      // Skip lines that are just numbers
      if (/^\d+$/.test(trimmed)) return false;
      // Skip lines that are just 1-2 characters (likely garbage)
      if (trimmed.length > 0 && trimmed.length <= 2) return false;
      return true;
    })
    .join('\n');

  // 9. Whitespace cleanup
  clean = clean
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .trim();

  return clean;
}

// === Simple Markdown Renderer ===
// Renders markdown: headers, lists, **bold**, *italic*, `code`, [links](url), ```code blocks```

function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  // Split by code blocks first (```...```)
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let keyCounter = 0;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Add text before code block
    if (match.index > lastIndex) {
      parts.push(
        <span key={keyCounter++}>
          {renderBlockMarkdown(text.slice(lastIndex, match.index), keyCounter)}
        </span>
      );
      keyCounter += 100; // Reserve space for nested keys
    }

    // Add code block
    const lang = match[1] || '';
    const code = match[2].trim();
    parts.push(
      <pre
        key={keyCounter++}
        className="bg-black/40 rounded-lg p-3 my-2 overflow-x-auto border border-white/10"
      >
        {lang && (
          <div className="text-xs text-gray-500 mb-2 font-mono">{lang}</div>
        )}
        <code className="text-sm font-mono text-green-400">{code}</code>
      </pre>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(
      <span key={keyCounter++}>
        {renderBlockMarkdown(text.slice(lastIndex), keyCounter)}
      </span>
    );
  }

  return parts.length > 0 ? parts : renderBlockMarkdown(text, 0);
}

// Renders block-level markdown: headers, lists, horizontal rules
function renderBlockMarkdown(text: string, baseKey: number): React.ReactNode {
  if (!text) return null;

  const lines = text.split('\n');
  const parts: React.ReactNode[] = [];
  let keyCounter = baseKey;
  let currentList: { type: 'ul' | 'ol'; items: React.ReactNode[] } | null = null;

  const flushList = () => {
    if (currentList) {
      if (currentList.type === 'ul') {
        parts.push(
          <ul key={keyCounter++} className="list-disc list-inside my-2 space-y-1 text-gray-300">
            {currentList.items}
          </ul>
        );
      } else {
        parts.push(
          <ol key={keyCounter++} className="list-decimal list-inside my-2 space-y-1 text-gray-300">
            {currentList.items}
          </ol>
        );
      }
      currentList = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Horizontal rule: --- or *** or ___
    if (/^[-*_]{3,}\s*$/.test(line)) {
      flushList();
      parts.push(<hr key={keyCounter++} className="border-white/10 my-3" />);
      continue;
    }

    // Table: | col | col | followed by separator |---|---|
    if (/^\|(.+)\|$/.test(line) && i + 1 < lines.length && /^\|[\s\-:|]+\|$/.test(lines[i + 1])) {
      flushList();
      const headerCells = line.split('|').slice(1, -1).map(c => c.trim());
      const sepLine = lines[i + 1];
      const alignments = sepLine.split('|').slice(1, -1).map(c => {
        const t = c.trim();
        if (t.startsWith(':') && t.endsWith(':')) return 'center' as const;
        if (t.endsWith(':')) return 'right' as const;
        return 'left' as const;
      });
      i += 1; // skip separator
      const bodyRows: string[][] = [];
      while (i + 1 < lines.length && /^\|(.+)\|$/.test(lines[i + 1])) {
        i += 1;
        bodyRows.push(lines[i].split('|').slice(1, -1).map(c => c.trim()));
      }
      parts.push(
        <div key={keyCounter++} className="overflow-x-auto my-2">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-white/20">
                {headerCells.map((cell, ci) => (
                  <th
                    key={ci}
                    className="px-3 py-1.5 font-semibold text-gray-200 whitespace-nowrap"
                    style={{ textAlign: alignments[ci] || 'left' }}
                  >
                    {renderInlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri} className="border-b border-white/10">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="px-3 py-1.5 text-gray-300 whitespace-nowrap"
                      style={{ textAlign: alignments[ci] || 'left' }}
                    >
                      {renderInlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Headers: # ## ### #### ##### ######
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      flushList();
      const level = headerMatch[1].length;
      const content = headerMatch[2];
      const headerClasses: Record<number, string> = {
        1: 'text-xl font-bold text-white mt-4 mb-2',
        2: 'text-lg font-semibold text-white mt-3 mb-2',
        3: 'text-base font-semibold text-gray-200 mt-2 mb-1',
        4: 'text-sm font-semibold text-gray-300 mt-2 mb-1',
        5: 'text-sm font-medium text-gray-400 mt-1 mb-1',
        6: 'text-xs font-medium text-gray-500 mt-1 mb-1',
      };
      parts.push(
        <div key={keyCounter++} className={headerClasses[level]} role="heading" aria-level={level}>
          {renderInlineMarkdown(content)}
        </div>
      );
      continue;
    }

    // Bullet list: - or * or +
    const bulletMatch = line.match(/^[\s]*[-*+]\s+(.+)$/);
    if (bulletMatch) {
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(
        <li key={keyCounter++}>{renderInlineMarkdown(bulletMatch[1])}</li>
      );
      continue;
    }

    // Numbered list: 1. 2. 3.
    const numberedMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);
    if (numberedMatch) {
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(
        <li key={keyCounter++}>{renderInlineMarkdown(numberedMatch[1])}</li>
      );
      continue;
    }

    // Regular line - flush any list and render inline
    flushList();
    if (line.trim()) {
      parts.push(
        <span key={keyCounter++}>
          {renderInlineMarkdown(line)}
          {i < lines.length - 1 ? '\n' : ''}
        </span>
      );
    } else if (i < lines.length - 1) {
      // Empty line - preserve as line break
      parts.push(<br key={keyCounter++} />);
    }
  }

  flushList();
  return parts.length > 0 ? parts : text;
}

function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  // Process inline elements: **bold**, *italic*, `code`, [link](url)
  const inlineRegex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let keyCounter = 0;

  while ((match = inlineRegex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // **bold**
      parts.push(
        <strong key={keyCounter++} className="font-semibold text-white">
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      // *italic*
      parts.push(
        <em key={keyCounter++} className="italic text-gray-300">
          {match[4]}
        </em>
      );
    } else if (match[5]) {
      // `code`
      parts.push(
        <code
          key={keyCounter++}
          className="bg-black/40 px-1.5 py-0.5 rounded text-orange-400 font-mono text-xs"
        >
          {match[6]}
        </code>
      );
    } else if (match[7]) {
      // [link](url)
      parts.push(
        <a
          key={keyCounter++}
          href={match[9]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 underline"
        >
          {match[8]}
        </a>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatUserMessageContent(content: string, attachments: AgentSessionAttachment[]): string {
  const trimmed = content.trim()
  if (attachments.length === 0) return trimmed

  const attachmentLines = attachments.map((file) => `- ${file.name} (${formatFileSize(file.size)})`)
  if (!trimmed) {
    return `Attached files:\n${attachmentLines.join('\n')}`
  }
  return `${trimmed}\n\nAttached files:\n${attachmentLines.join('\n')}`
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  agentId?: string
  toolCalls?: ToolCall[]
}

interface ToolCall {
  id: string
  toolUseId?: string  // Unique ID from Claude for matching results
  name: string
  status: 'running' | 'complete' | 'error'
  input: Record<string, unknown>
  output?: unknown
  startTime: number
  endTime?: number
}

const AGENT_META: Record<string, { name: string; icon: React.ReactNode; colors: { bg: string; text: string; border: string; iconBg: string } }> = {
  claude: {
    name: 'Claude Code',
    icon: <Terminal className="w-4 h-4" />,
    colors: {
      bg: 'bg-orange-500/20',
      text: 'text-orange-400',
      border: 'border-orange-500/40',
      iconBg: 'bg-orange-500/30',
    },
  },
  karpathy: {
    name: 'Karpathy',
    icon: <Wrench className="w-4 h-4" />,
    colors: {
      bg: 'bg-blue-500/20',
      text: 'text-blue-400',
      border: 'border-blue-500/40',
      iconBg: 'bg-blue-500/30',
    },
  },
  mckinsey: {
    name: 'McKinsey',
    icon: <FlaskConical className="w-4 h-4" />,
    colors: {
      bg: 'bg-purple-500/20',
      text: 'text-purple-400',
      border: 'border-purple-500/40',
      iconBg: 'bg-purple-500/30',
    },
  },
  hillary: {
    name: 'Hillary',
    icon: <User className="w-4 h-4" />,
    colors: {
      bg: 'bg-green-500/20',
      text: 'text-green-400',
      border: 'border-green-500/40',
      iconBg: 'bg-green-500/30',
    },
  },
  'chief-content': {
    name: 'Chief Content',
    icon: <PenTool className="w-4 h-4" />,
    colors: {
      bg: 'bg-pink-500/20',
      text: 'text-pink-400',
      border: 'border-pink-500/40',
      iconBg: 'bg-pink-500/30',
    },
  },
  cgo: {
    name: 'CGO',
    icon: <Briefcase className="w-4 h-4" />,
    colors: {
      bg: 'bg-cyan-500/20',
      text: 'text-cyan-400',
      border: 'border-cyan-500/40',
      iconBg: 'bg-cyan-500/30',
    },
  },
}


interface ChatAreaProps {
  activeAgent: string
  onAgentSelect: (id: string) => void
}

export function ChatArea({ activeAgent, onAgentSelect }: ChatAreaProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentToolCall, setCurrentToolCall] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<AgentSessionAttachment[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem(storageKey(activeAgent))
      if (stored) {
        const data = JSON.parse(stored)
        return data.sessionId || null
      }
    } catch {
      // Ignore parse errors
    }
    return null
  })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const dragDepthRef = useRef(0)
  const currentAssistantIdRef = useRef<string | null>(null)
  const accumulatedContentRef = useRef<string>('')
  const [autoScroll, setAutoScroll] = useState(true)

  // Auto-start command flag (ref to persist across StrictMode remounts)
  const autoStartTriggeredRef = useRef(false)

  // WebSocket hook for real-time communication
  // MUST be declared before any useEffect that references its values
  const {
    connected,
    events,
    textChunks,
    pendingPermission,
    contextUsage,
    sendMessage: wsSendMessage,
    respondToPermission,
    stopAgent,
    clearEvents,
  } = useAgentWebSocket(sessionId)

  const meta = AGENT_META[activeAgent] || AGENT_META.claude

  // Persist sessionId to localStorage
  useEffect(() => {
    if (sessionId) {
      localStorage.setItem(storageKey(activeAgent), JSON.stringify({
        sessionId,
        agentId: activeAgent,
        timestamp: Date.now()
      }))
    }
  }, [sessionId, activeAgent])

  // Auto-scroll to bottom when new messages arrive or content streams
  const scrollToBottom = useCallback(() => {
    if (autoScroll && messagesContainerRef.current) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
        }
      })
    }
  }, [autoScroll])

  // Handle scroll to detect if user scrolled away from bottom
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100 // 100px threshold
    setAutoScroll(isAtBottom)
  }, [])

  // Scroll when messages change (content updates trigger setMessages)
  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])


  // Initialize session on mount (with StrictMode guard)
  const initializingRef = useRef(false)

  useEffect(() => {
    const initSession = async () => {
      console.log('[ChatArea] initSession called, current sessionId:', sessionId, 'initializing:', initializingRef.current)

      // Prevent double initialization in React StrictMode
      if (initializingRef.current) {
        console.log('[ChatArea] Already initializing, skipping')
        return
      }

      if (sessionId) {
        console.log('[ChatArea] Already have session, skipping creation')
        return
      }

      initializingRef.current = true

      try {
        console.log('[ChatArea] Creating new session...')
        const session = await agentSessionsAPI.createSession('New Chat', activeAgent)
        console.log('[ChatArea] Session created:', session)
        if (session?.id) {
          setSessionId(session.id)
        }
      } catch (error) {
        console.error('[ChatArea] Failed to create session:', error)
      } finally {
        initializingRef.current = false
      }
    }
    initSession()
  }, []) // Empty deps - only run once on mount

  // Load previous messages when sessionId is set
  useEffect(() => {
    if (!sessionId) return

    const loadMessages = async () => {
      try {
        const session = await agentSessionsAPI.getSession(sessionId)
        if (session?.messages && session.messages.length > 0) {
          const loadedMessages: Message[] = session.messages.map((msg: any) => ({
            id: msg.id || `loaded-${Date.now()}-${Math.random()}`,
            role: msg.role as 'user' | 'assistant',
            content: msg.content || '',
            timestamp: new Date(msg.created_at).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit'
            }),
            agentId: msg.agent_id,
            toolCalls: msg.tool_calls?.map((tc: any) => ({
              id: tc.id || `tool-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              name: tc.name,
              status: tc.status || 'complete',
              input: tc.input || {},
              output: tc.output,
              startTime: tc.startTime || Date.now(),
              endTime: tc.endTime,
            })) || []
          }))
          setMessages(loadedMessages)
        }
      } catch (error) {
        console.error('Failed to load messages:', error)
      }
    }

    loadMessages()
  }, [sessionId])

  // Auto-start command after session is ready and connected
  useEffect(() => {
    // Read flag from localStorage
    const autoStartCmd = localStorage.getItem('atlas-autostart')
    if (!autoStartCmd) return

    // Guard conditions
    if (!sessionId) return
    if (!connected) return
    if (autoStartTriggeredRef.current) return
    if (isStreaming) return

    // Clear flag immediately to prevent re-trigger
    localStorage.removeItem('atlas-autostart')
    autoStartTriggeredRef.current = true

    console.log('[ChatArea] Auto-starting command:', `/${autoStartCmd}`)

    // Small delay to ensure UI is settled
    setTimeout(() => {
      // Replicate handleSendMessage logic
      const command = `/${autoStartCmd}`

      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: command,
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      }

      const assistantId = `assistant-${Date.now()}`
      const assistantMessage: Message = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        agentId: activeAgent,
        toolCalls: [],
      }

      setMessages(prev => [...prev, userMessage, assistantMessage])
      currentAssistantIdRef.current = assistantId
      accumulatedContentRef.current = ''
      clearEvents()
      wsSendMessage(command, activeAgent)
      setIsStreaming(true)
    }, 100)
  }, [sessionId, connected, isStreaming, activeAgent, wsSendMessage, clearEvents])

  // Handle text chunk from WebSocket
  const handleTextChunk = useCallback((content: string) => {
    // Skip if this content is already at the end (duplicate chunk)
    if (accumulatedContentRef.current.endsWith(content) && content.length > 0) {
      return;
    }

    // Skip if this content is already contained in what we have (repeat)
    if (accumulatedContentRef.current.includes(content) && content.length > 10) {
      return;
    }

    accumulatedContentRef.current += content

    // Update the current assistant message with terminal artifacts stripped
    if (currentAssistantIdRef.current) {
      const cleanContent = stripTerminalArtifacts(accumulatedContentRef.current)
      setMessages(prev => prev.map(msg =>
        msg.id === currentAssistantIdRef.current
          ? { ...msg, content: cleanContent }
          : msg
      ))
    }
  }, [])

  // Handle hook events from WebSocket
  const handleHookEvent = useCallback((event: HookEvent) => {
    const { hookEvent, toolName, toolInput } = event

    switch (hookEvent) {
      case 'PreToolUse':
        // Show tool indicator
        setCurrentToolCall(toolName || 'Unknown tool')
        setIsStreaming(true)

        // Auto-create assistant message if none exists (tool call before any text)
        if (!currentAssistantIdRef.current && toolName) {
          const newAssistantId = `assistant-${Date.now()}`
          const newMessage: Message = {
            id: newAssistantId,
            role: 'assistant',
            content: '',
            timestamp: new Date().toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit'
            }),
            agentId: activeAgent,
            toolCalls: [],
          }
          setMessages(prev => [...prev, newMessage])
          currentAssistantIdRef.current = newAssistantId
          accumulatedContentRef.current = ''
        }

        // Add tool call to current assistant message
        if (currentAssistantIdRef.current && toolName) {
          const toolCall: ToolCall = {
            id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            toolUseId: event.toolUseId,  // Track Claude's unique ID for matching
            name: toolName,
            status: 'running',
            input: toolInput || {},
            startTime: Date.now(),
          }

          setMessages(prev => prev.map(msg =>
            msg.id === currentAssistantIdRef.current
              ? { ...msg, toolCalls: [...(msg.toolCalls || []), toolCall] }
              : msg
          ))
        }
        break

      case 'PostToolUse':
        // Update tool call status based on event.toolStatus (complete or error)
        setCurrentToolCall(null)

        if (currentAssistantIdRef.current) {
          const finalStatus = event.toolStatus === 'error' ? 'error' : 'complete'
          setMessages(prev => prev.map(msg => {
            if (msg.id !== currentAssistantIdRef.current) return msg
            const toolCalls = (msg.toolCalls || []).map(t =>
              // Match by toolUseId (unique) instead of name (can have duplicates)
              t.toolUseId === event.toolUseId
                ? { ...t, status: finalStatus as 'complete' | 'error', output: event.toolResponse, endTime: Date.now() }
                : t
            )
            return { ...msg, toolCalls }
          }))
        }
        break

      case 'Stop':
        // Mark message as complete
        setIsStreaming(false)
        setCurrentToolCall(null)
        currentAssistantIdRef.current = null
        accumulatedContentRef.current = ''
        break

      case 'Notification':
        // Could show a toast or log notification
        console.log('[Notification]', event.message)
        break

      case 'Error':
        // Show error and stop streaming
        console.error('[Agent Error]', event.message)
        setIsStreaming(false)
        setCurrentToolCall(null)
        currentAssistantIdRef.current = null
        accumulatedContentRef.current = ''
        // Add error as an assistant message so the user can see it
        setMessages(prev => [...prev, {
          id: `error-${Date.now()}`,
          role: 'assistant' as const,
          content: `**Error:** ${event.message || 'An unknown error occurred'}`,
          timestamp: new Date().toISOString(),
        }])
        break
    }
  }, [activeAgent])

  // Track processed events to avoid re-processing
  const processedEventsRef = useRef(0)
  const processedChunksRef = useRef(0)

  // Reset streaming state when session changes or connection is re-established
  // This prevents isStreaming from getting stuck if a previous message never completed
  const prevConnectedRef = useRef(false)
  const prevSessionIdRef = useRef(sessionId)
  const streamingStartTimeRef = useRef<number | null>(null)

  useEffect(() => {
    // Reset when switching sessions
    if (sessionId !== prevSessionIdRef.current) {
      console.log('[ChatArea] Session changed, resetting state', { old: prevSessionIdRef.current, new: sessionId })
      setIsStreaming(false)
      setCurrentToolCall(null)
      setAttachments([])
      setUploadError(null)
      setIsUploading(false)
      setIsDragActive(false)
      dragDepthRef.current = 0
      currentAssistantIdRef.current = null
      accumulatedContentRef.current = ''
      streamingStartTimeRef.current = null
      // Clear events from previous session to prevent contamination
      clearEvents()
      // Reset processed counters so new events are processed fresh
      processedEventsRef.current = 0
      processedChunksRef.current = 0
      prevSessionIdRef.current = sessionId
    }
  }, [sessionId, clearEvents])

  useEffect(() => {
    // Reset when reconnecting (was disconnected, now connected)
    if (connected && !prevConnectedRef.current) {
      console.log('[ChatArea] Reconnected, resetting streaming state')
      setIsStreaming(false)
      setCurrentToolCall(null)
      streamingStartTimeRef.current = null
    }
    prevConnectedRef.current = connected
  }, [connected])

  // Track when streaming starts and add safety timeout
  useEffect(() => {
    if (isStreaming) {
      if (!streamingStartTimeRef.current) {
        streamingStartTimeRef.current = Date.now()
        console.log('[ChatArea] Streaming started')
      }
    } else {
      streamingStartTimeRef.current = null
    }
  }, [isStreaming])

  // Safety timeout: reset isStreaming if stuck for more than 2 minutes
  useEffect(() => {
    if (!isStreaming) return

    const checkTimeout = setInterval(() => {
      const startTime = streamingStartTimeRef.current
      if (startTime && Date.now() - startTime > 120000) {
        console.warn('[ChatArea] Streaming stuck for >2 min, forcing reset')
        setIsStreaming(false)
        setCurrentToolCall(null)
        streamingStartTimeRef.current = null
      }
    }, 10000) // Check every 10 seconds

    return () => clearInterval(checkTimeout)
  }, [isStreaming])

  // Skip initial events/chunks to avoid processing stale data on mount
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!initializedRef.current) {
      // On first mount, skip any existing events/chunks to avoid stale state
      console.log('[ChatArea] Initial mount, skipping existing events:', events.length, 'chunks:', textChunks.length)
      processedEventsRef.current = events.length
      processedChunksRef.current = textChunks.length
      initializedRef.current = true
    }
  }, [events.length, textChunks.length])

  // Process text chunks when they arrive
  useEffect(() => {
    if (!initializedRef.current) return // Don't process before initialization

    // Only process new chunks
    const newChunks = textChunks.slice(processedChunksRef.current)
    if (newChunks.length > 0) {
      console.log('[ChatArea] Processing', newChunks.length, 'new text chunks')
    }
    for (const chunk of newChunks) {
      handleTextChunk(chunk.content)
    }
    processedChunksRef.current = textChunks.length
  }, [textChunks, handleTextChunk])

  // Process hook events when they arrive
  useEffect(() => {
    if (!initializedRef.current) return // Don't process before initialization

    // Only process new events
    const newEvents = events.slice(processedEventsRef.current)
    if (newEvents.length > 0) {
      console.log('[ChatArea] Processing', newEvents.length, 'new events:', newEvents.map(e => e.hookEvent))
    }
    for (const event of newEvents) {
      handleHookEvent(event)
    }
    processedEventsRef.current = events.length
  }, [events, handleHookEvent])


  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInput(value)

    // Show agent picker when typing @
    if (value.endsWith('@')) {
      setShowAgentPicker(true)
    } else if (!value.includes('@')) {
      setShowAgentPicker(false)
    }
  }

  const handleAgentPickerSelect = (agentId: string) => {
    onAgentSelect(agentId)
    setInput(input.replace(/@$/, ''))
    setShowAgentPicker(false)
    inputRef.current?.focus()
  }

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    if (!sessionId) {
      setUploadError('Session not ready yet. Try again in a moment.')
      return
    }

    setIsUploading(true)
    setUploadError(null)

    const uploaded: AgentSessionAttachment[] = []
    const failed: string[] = []

    for (const file of files) {
      try {
        const result = await agentSessionsAPI.uploadAttachment(sessionId, file)
        uploaded.push(result)
      } catch (error) {
        console.error('Failed to upload attachment:', file.name, error)
        failed.push(file.name)
      }
    }

    if (uploaded.length > 0) {
      setAttachments((prev) => [...prev, ...uploaded])
    }

    if (failed.length > 0) {
      setUploadError(`Failed to upload: ${failed.join(', ')}`)
    }

    setIsUploading(false)
  }, [sessionId])


  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      if (!sessionId) {
        setUploadError('Session not ready yet. Try again in a moment.')
        e.target.value = ''
        return
      }
      void uploadFiles(files)
    }
    e.target.value = ''
  }, [uploadFiles, sessionId])

  const handleAttachmentRemove = useCallback((attachmentId: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.attachment_id !== attachmentId))
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current += 1
    setIsDragActive(true)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setIsDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = 0
    setIsDragActive(false)

    const files = Array.from(e.dataTransfer.files || [])
    if (files.length > 0) {
      void uploadFiles(files)
    }
  }, [uploadFiles])

  const handleInputPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = []
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }

    if (files.length > 0) {
      e.preventDefault()
      void uploadFiles(files)
    }
  }, [uploadFiles])

  const handleSendMessage = useCallback(() => {
    const trimmedInput = input.trim()
    console.log('[ChatArea] handleSendMessage called', {
      input: trimmedInput,
      attachmentCount: attachments.length,
      isStreaming,
      isUploading,
      sessionId,
      connected,
    })
    if ((!trimmedInput && attachments.length === 0) || isStreaming || isUploading || !sessionId || !connected) {
      console.log('[ChatArea] Message blocked:', {
        hasInput: !!trimmedInput,
        attachmentCount: attachments.length,
        isStreaming,
        isUploading,
        hasSession: !!sessionId,
        connected,
      })
      return
    }

    const wsAttachments: WsMessageAttachment[] = attachments.map((attachment) => ({
      attachment_id: attachment.attachment_id,
      name: attachment.name,
      path: attachment.path,
      mime: attachment.mime,
      size: attachment.size,
    }))

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: formatUserMessageContent(trimmedInput, attachments),
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    }

    // Add user message to chat
    setMessages(prev => [...prev, userMessage])

    // Create assistant message placeholder
    const assistantId = `assistant-${Date.now()}`
    const assistantMessage: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      agentId: activeAgent,
      toolCalls: [],
    }
    setMessages(prev => [...prev, assistantMessage])

    // Track current assistant message
    currentAssistantIdRef.current = assistantId
    accumulatedContentRef.current = ''

    // Clear previous events and send via WebSocket
    clearEvents()
    console.log('[ChatArea] Sending message via WebSocket:', trimmedInput)
    wsSendMessage(trimmedInput, activeAgent, wsAttachments)
    console.log('[ChatArea] Message sent')

    setInput('')
    setAttachments([])
    setUploadError(null)
    setIsStreaming(true)
  }, [input, attachments, isStreaming, isUploading, sessionId, connected, activeAgent, wsSendMessage, clearEvents])

  // Stop agent handler
  const handleStop = useCallback(() => {
    console.log('[ChatArea] Stopping agent')
    stopAgent()
    setIsStreaming(false)
    setCurrentToolCall(null)
  }, [stopAgent])

  // Keyboard shortcut: Escape or Ctrl+C to stop
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isStreaming && (e.key === 'Escape' || (e.ctrlKey && e.key === 'c'))) {
        e.preventDefault()
        handleStop()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isStreaming, handleStop])

  // Permission dialog handlers
  const handleApprovePermission = useCallback(() => {
    if (pendingPermission) {
      respondToPermission(pendingPermission.toolUseId, true)
    }
  }, [pendingPermission, respondToPermission])

  const handleDenyPermission = useCallback(() => {
    if (pendingPermission) {
      respondToPermission(pendingPermission.toolUseId, false, 'User denied permission')
    }
  }, [pendingPermission, respondToPermission])

  return (
    <main className="flex-1 flex flex-col min-w-0 relative">
      {/* Permission Dialog */}
      {pendingPermission && (
        <PermissionDialog
          toolName={pendingPermission.toolName}
          toolInput={pendingPermission.toolInput}
          onApprove={handleApprovePermission}
          onDeny={handleDenyPermission}
          agentColors={meta.colors}
        />
      )}

      {/* Agent Header */}
      <div className="h-12 border-b border-white/10 flex items-center justify-between px-4 shrink-0 bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <div className={`p-1.5 rounded-md ${meta.colors.iconBg}`}>
            <span className={meta.colors.text}>{meta.icon}</span>
          </div>
          <span className="text-white font-medium">{meta.name}</span>
          {/* Connection Status Indicator */}
          <div className="flex items-center gap-1.5 ml-2">
            {connected ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-green-400" />
                <span className="text-xs text-green-400">Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-red-400" />
                <span className="text-xs text-red-400">Disconnected</span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5 text-xs text-gray-500">
          <div className="flex items-center gap-2">
            {isStreaming && (
              <>
                <button
                  onClick={handleStop}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-500/20 hover:bg-red-500/30 text-red-400 transition"
                  title="Stop agent (Esc or Ctrl+C)"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>{currentToolCall ? `Stop (${currentToolCall})` : 'Stop'}</span>
                </button>
                <span className="text-gray-600">|</span>
              </>
            )}
            <span>
              {messages.length} messages
              {contextUsage && (() => {
                const used = contextUsage.inputTokens + contextUsage.outputTokens
                const limit = contextUsage.contextLimit
                const pct = Math.round((used / limit) * 100)
                const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
                return <span className="font-mono"> · {fmt(used)} / {fmt(limit)} tokens ({pct}%)</span>
              })()}
            </span>
          </div>
          {contextUsage && (() => {
            const used = contextUsage.inputTokens + contextUsage.outputTokens
            const limit = contextUsage.contextLimit
            const pct = Math.min(100, Math.round((used / limit) * 100))
            const color = pct < 50 ? 'bg-green-500' : pct < 80 ? 'bg-yellow-500' : pct < 95 ? 'bg-orange-500' : 'bg-red-500'
            return (
              <div className="w-32 h-0.5 bg-white/10 rounded-full overflow-hidden">
                <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
              </div>
            )
          })()}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {messages.map((msg) => {
          const agentMeta = msg.agentId ? AGENT_META[msg.agentId] : null
          return (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] min-w-0 ${msg.role === 'user' ? 'order-1' : ''}`}>
                {/* Message Header */}
                {msg.role === 'assistant' && agentMeta && (
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={`p-1 rounded ${agentMeta.colors.iconBg}`}>
                      <span className={agentMeta.colors.text}>{agentMeta.icon}</span>
                    </div>
                    <span className={`text-sm font-medium ${agentMeta.colors.text}`}>
                      {agentMeta.name}
                    </span>
                    <span className="text-xs text-gray-600">{msg.timestamp}</span>
                  </div>
                )}
                {msg.role === 'user' && (
                  <div className="flex items-center justify-end gap-2 mb-1.5">
                    <span className="text-xs text-gray-600">{msg.timestamp}</span>
                    <span className="text-sm text-gray-400">You</span>
                  </div>
                )}

                {/* Tool Calls - shown first (chronological order) */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mb-2 space-y-1.5">
                    {msg.toolCalls.map((tool) => (
                      <ToolCallCard key={tool.id} tool={tool} agentColors={agentMeta?.colors} />
                    ))}
                  </div>
                )}

                {/* Message Content - shown after tool calls */}
                {msg.content && (
                  <div
                    className={`rounded-2xl px-4 py-3 ${
                      msg.role === 'user'
                        ? 'bg-orange-500/20 text-white rounded-tr-md'
                        : `bg-white/[0.03] text-gray-200 rounded-tl-md border-l-2 ${agentMeta?.colors.border || 'border-white/20'}`
                    }`}
                  >
                    <div className="text-sm whitespace-pre-wrap leading-relaxed overflow-x-auto">
                      {renderMarkdown(msg.content)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {/* Thinking Indicator - Show when streaming but no content yet */}
        {isStreaming && messages.length > 0 && messages[messages.length - 1].role === 'assistant' && !messages[messages.length - 1].content && (
          <div className="flex justify-start">
            <div className="max-w-[80%]">
              <div className="flex items-center gap-2 mb-1.5">
                <div className={`p-1.5 rounded-lg ${meta.colors.iconBg} ai-active-${activeAgent}`}>
                  <span className={meta.colors.text}>{meta.icon}</span>
                </div>
                <span className={`text-sm font-medium ${meta.colors.text}`}>
                  {meta.name}
                </span>
                <span className="text-xs text-gray-500">
                  {currentToolCall ? `using ${currentToolCall}...` : 'is thinking...'}
                </span>
              </div>
              <div className={`rounded-2xl rounded-tl-md px-5 py-4 bg-white/[0.03] border-l-2 ${meta.colors.border} backdrop-blur-sm`}>
                <div className={`flex items-center gap-2 ${meta.colors.text}`}>
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom button - shows when user has scrolled up */}
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true)
            if (messagesContainerRef.current) {
              messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
            }
          }}
          className="absolute bottom-24 right-8 p-2 bg-gray-800 hover:bg-gray-700 border border-white/10 rounded-full shadow-lg transition-all z-10"
          title="Scroll to bottom"
        >
          <ArrowDown className="w-4 h-4 text-gray-300" />
        </button>
      )}

      {/* Input Area */}
      <div className="p-4 border-t border-white/10">
        <div className="relative">
          {/* Agent Picker Dropdown */}
          {showAgentPicker && (
            <div className="absolute bottom-full left-0 mb-2 w-72 bg-gray-900/95 backdrop-blur-sm border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
              <div className="p-3 border-b border-white/10">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Switch Agent</p>
              </div>
              <div className="p-2">
                {Object.entries(AGENT_META).map(([id, agent]) => {
                  const isActive = activeAgent === id
                  return (
                    <button
                      key={id}
                      onClick={() => handleAgentPickerSelect(id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition ${
                        isActive
                          ? `${agent.colors.bg} ${agent.colors.text}`
                          : 'text-gray-300 hover:bg-white/5'
                      }`}
                    >
                      <div className={`p-1.5 rounded-lg ${isActive ? agent.colors.iconBg : 'bg-white/10'}`}>
                        <span className={isActive ? agent.colors.text : 'text-gray-400'}>{agent.icon}</span>
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-sm font-medium">{agent.name}</p>
                      </div>
                      {isActive && (
                        <span className={`text-xs ${agent.colors.text} font-medium`}>Active</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Input Container */}
          <div
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`bg-white/5 border rounded-2xl transition ${
              connected
                ? 'border-white/10 focus-within:border-orange-500/50'
                : 'border-red-500/30 opacity-50'
            } ${isDragActive ? 'border-orange-400/70 bg-orange-500/10' : ''}`}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onPaste={handleInputPaste}
              placeholder={connected ? `Message @${meta.name.toLowerCase()}...` : 'Reconnecting...'}
              rows={1}
              disabled={!connected}
              className="w-full bg-transparent text-white placeholder-gray-500 px-4 py-3 pr-12 resize-none focus:outline-none text-sm disabled:cursor-not-allowed"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendMessage()
                }
              }}
            />

            {(attachments.length > 0 || isDragActive || uploadError) && (
              <div className="px-3 pb-2 space-y-2">
                {isDragActive && (
                  <div className="text-xs text-orange-300">
                    Drop files to attach
                  </div>
                )}

                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attachments.map((attachment) => (
                      <div
                        key={attachment.attachment_id}
                        className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-xs"
                      >
                        <FileText className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-gray-200 max-w-[220px] truncate">{attachment.name}</span>
                        <span className="text-gray-500">{formatFileSize(attachment.size)}</span>
                        <button
                          onClick={() => handleAttachmentRemove(attachment.attachment_id)}
                          className="text-gray-400 hover:text-red-400 transition"
                          title="Remove attachment"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {uploadError && (
                  <div className="text-xs text-red-400">{uploadError}</div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between px-3 pb-2">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowAgentPicker(!showAgentPicker)}
                  disabled={!connected}
                  className={`flex items-center gap-1.5 text-xs transition px-2 py-1 rounded-lg ${meta.colors.text} hover:${meta.colors.bg} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <AtSign className="w-3.5 h-3.5" />
                  <span className="font-medium">{meta.name}</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
                <div className="relative">
                  <button
                    type="button"
                    disabled={isUploading}
                    className="flex items-center gap-1.5 text-xs text-gray-300 transition px-2 py-1 rounded-lg hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Attach files"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    <span className="font-medium">{isUploading ? 'Uploading...' : 'Attach'}</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileInputChange}
                    className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                  />
                </div>
              </div>
              {isStreaming ? (
                <button
                  onClick={handleStop}
                  className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition"
                  title="Stop (Esc)"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              ) : (
                <button
                  disabled={(!input.trim() && attachments.length === 0) || !connected || isUploading}
                  onClick={handleSendMessage}
                  className={`p-2 ${meta.colors.iconBg} hover:opacity-80 disabled:bg-gray-700 disabled:text-gray-500 ${meta.colors.text} rounded-lg transition`}
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

interface ToolCallCardProps {
  tool: ToolCall
  agentColors?: {
    bg: string
    text: string
    border: string
    iconBg: string
  }
}

function ToolCallCard({ tool, agentColors: _agentColors }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const isRunning = tool.status === 'running'

  // Tool-specific styling
  const getToolStyle = (name: string) => {
    const styles: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
      Bash: { icon: <Terminal className="w-3.5 h-3.5" />, color: 'text-green-400', bg: 'bg-green-500/10' },
      Read: { icon: <FileText className="w-3.5 h-3.5" />, color: 'text-blue-400', bg: 'bg-blue-500/10' },
      Write: { icon: <FileEdit className="w-3.5 h-3.5" />, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
      Edit: { icon: <FileEdit className="w-3.5 h-3.5" />, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
      Glob: { icon: <FolderSearch className="w-3.5 h-3.5" />, color: 'text-purple-400', bg: 'bg-purple-500/10' },
      Grep: { icon: <Search className="w-3.5 h-3.5" />, color: 'text-purple-400', bg: 'bg-purple-500/10' },
      WebFetch: { icon: <Globe className="w-3.5 h-3.5" />, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
      WebSearch: { icon: <Globe className="w-3.5 h-3.5" />, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
    }
    return styles[name] || { icon: <FileText className="w-3.5 h-3.5" />, color: 'text-gray-400', bg: 'bg-gray-500/10' }
  }

  // Get relevant input summary
  const getInputSummary = () => {
    const input = tool.input || {}
    switch (tool.name) {
      case 'Read': case 'Write': case 'Edit':
        return input.file_path as string
      case 'Bash':
        return input.command as string
      case 'Glob':
        return input.pattern as string
      case 'Grep':
        return `/${input.pattern}/`
      case 'WebFetch':
        return input.url as string
      case 'WebSearch':
        return input.query as string
      default: {
        const first = Object.values(input)[0]
        return typeof first === 'string' ? first : JSON.stringify(first)
      }
    }
  }

  const style = getToolStyle(tool.name)
  const inputSummary = getInputSummary()
  const duration = tool.endTime && tool.startTime ? ((tool.endTime - tool.startTime) / 1000).toFixed(1) : null
  const hasOutput = tool.output !== undefined && tool.output !== null

  return (
    <div className={`tool-card rounded-xl border ${isRunning ? 'border-white/20' : 'border-white/5'}`}>
      <button
        onClick={() => hasOutput && setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
      >
        <div className={`p-1.5 rounded-md ${style.bg}`}>
          <span className={style.color}>{style.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-medium ${style.color}`}>{tool.name}</p>
          <p className="text-xs font-mono text-gray-500 truncate">{inputSummary}</p>
        </div>
        <div className="flex items-center gap-2">
          {duration && <span className="text-xs text-gray-500">{duration}s</span>}
          {tool.status === 'running' && <Loader2 className={`w-4 h-4 ${style.color} animate-spin`} />}
          {tool.status === 'complete' && <CheckCircle2 className="w-4 h-4 text-green-400" />}
          {tool.status === 'error' && <span className="text-xs text-red-400">error</span>}
          {hasOutput && (expanded ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />)}
        </div>
      </button>
      {expanded && hasOutput && (
        <div className="px-3 pb-3 border-t border-white/5">
          <pre className="text-xs font-mono text-gray-400 mt-2 bg-black/20 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
            {typeof tool.output === 'string' ? tool.output.slice(0, 2000) : JSON.stringify(tool.output, null, 2).slice(0, 2000)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ==================== Permission Dialog ====================

interface PermissionDialogProps {
  toolName: string
  toolInput?: Record<string, unknown>
  onApprove: () => void
  onDeny: () => void
  agentColors?: {
    bg: string
    text: string
    border: string
    iconBg: string
  }
}

function PermissionDialog({
  toolName,
  toolInput,
  onApprove,
  onDeny,
  agentColors,
}: PermissionDialogProps) {
  const textClass = agentColors?.text || 'text-orange-400'
  const bgClass = agentColors?.bg || 'bg-orange-500/20'
  const borderClass = agentColors?.border || 'border-orange-500/40'

  // Format tool input for display
  const formatToolInput = (input?: Record<string, unknown>) => {
    if (!input) return null

    const entries = Object.entries(input).filter(([, value]) => value !== undefined)
    if (entries.length === 0) return null

    return entries.map(([key, value]) => {
      const displayValue = typeof value === 'string'
        ? value.length > 100 ? value.substring(0, 100) + '...' : value
        : JSON.stringify(value, null, 2)

      return (
        <div key={key} className="mb-2">
          <span className="text-xs text-gray-400 font-medium">{key}:</span>
          <pre className="text-xs text-gray-300 font-mono mt-1 bg-black/20 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto">
            {displayValue}
          </pre>
        </div>
      )
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className={`w-full max-w-md bg-gray-900 border ${borderClass} rounded-2xl shadow-2xl overflow-hidden`}>
        {/* Header */}
        <div className={`px-5 py-4 ${bgClass} border-b ${borderClass} flex items-center gap-3`}>
          <div className={`p-2 rounded-lg bg-black/20`}>
            <ShieldAlert className={`w-5 h-5 ${textClass}`} />
          </div>
          <div>
            <h3 className="text-white font-medium">Permission Required</h3>
            <p className="text-xs text-gray-400">The agent wants to use a tool</p>
          </div>
        </div>

        {/* Content */}
        <div className="p-5">
          <div className={`rounded-xl px-4 py-3 ${bgClass} border ${borderClass} mb-4`}>
            <p className="text-xs text-gray-400 mb-1">Tool</p>
            <p className={`text-sm font-mono font-medium ${textClass}`}>{toolName}</p>
          </div>

          {toolInput && Object.keys(toolInput).length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-gray-400 mb-2">Parameters</p>
              <div className="bg-black/30 rounded-xl p-3 max-h-48 overflow-y-auto">
                {formatToolInput(toolInput)}
              </div>
            </div>
          )}

          <p className="text-xs text-gray-400 text-center">
            Do you want to allow this action?
          </p>
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 flex gap-3">
          <button
            onClick={onDeny}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition"
          >
            <X className="w-4 h-4" />
            <span className="text-sm font-medium">Deny</span>
          </button>
          <button
            onClick={onApprove}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20 transition"
          >
            <Check className="w-4 h-4" />
            <span className="text-sm font-medium">Approve</span>
          </button>
        </div>
      </div>
    </div>
  )
}
