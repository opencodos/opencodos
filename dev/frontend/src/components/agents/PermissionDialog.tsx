import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  FileEdit,
  FilePlus,
  Globe,
  Shield,
  Terminal,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface PermissionDialogProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  onApprove: () => void;
  onDeny: (reason?: string) => void;
  onClose?: () => void;
}

// Dangerous bash patterns that should be highlighted
const DANGEROUS_PATTERNS = [
  /\brm\s+(-rf?|--recursive)/i,
  /\bsudo\b/i,
  /\bchmod\s+[0-7]{3,4}/i,
  /\bchown\b/i,
  /\bkill\s+-9/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b>\s*\/dev\//i,
  /\bformat\b/i,
  /\bdrop\s+database/i,
  /\btruncate\b/i,
  /\bdelete\s+from/i,
  /--force/i,
  /--no-preserve-root/i,
];

// Tool icons and colors
const TOOL_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  Bash: {
    icon: <Terminal className="w-5 h-5" />,
    label: 'Run Command',
    color: 'text-yellow-400',
  },
  Write: {
    icon: <FilePlus className="w-5 h-5" />,
    label: 'Create File',
    color: 'text-green-400',
  },
  Edit: {
    icon: <FileEdit className="w-5 h-5" />,
    label: 'Edit File',
    color: 'text-blue-400',
  },
  WebFetch: {
    icon: <Globe className="w-5 h-5" />,
    label: 'Fetch URL',
    color: 'text-purple-400',
  },
};

function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

function formatFilePath(path: string): React.ReactNode {
  const parts = path.split('/');
  const filename = parts.pop();
  const directory = parts.join('/');

  return (
    <span className="font-mono text-sm">
      <span className="text-gray-500">{directory}/</span>
      <span className="text-white">{filename}</span>
    </span>
  );
}

function truncateContent(content: string, maxLines: number = 10): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`;
}

export function PermissionDialog({
  toolName,
  toolInput,
  onApprove,
  onDeny,
  onClose,
}: PermissionDialogProps) {
  const [showDenyReason, setShowDenyReason] = useState(false);
  const [denyReason, setDenyReason] = useState('');
  const approveButtonRef = useRef<HTMLButtonElement>(null);

  const config = TOOL_CONFIG[toolName] || {
    icon: <Shield className="w-5 h-5" />,
    label: toolName,
    color: 'text-orange-400',
  };

  // Auto-focus approve button on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      approveButtonRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if dialog is active (not typing in input)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        onApprove();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onDeny();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onApprove, onDeny]);

  const handleDeny = () => {
    if (showDenyReason && denyReason.trim()) {
      onDeny(denyReason.trim());
    } else if (showDenyReason) {
      onDeny();
    } else {
      setShowDenyReason(true);
    }
  };

  const handleDenyWithoutReason = () => {
    onDeny();
  };

  // Render tool-specific content
  const renderToolContent = () => {
    switch (toolName) {
      case 'Bash': {
        const command = toolInput.command as string;
        const isDangerous = isDangerousCommand(command);
        const description =
          typeof toolInput.description === 'string' ? toolInput.description : '';

        return (
          <div className="space-y-3">
            {isDangerous && (
              <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-sm text-red-400">
                  This command may be destructive. Review carefully.
                </span>
              </div>
            )}
            <div className="bg-black/50 border border-white/10 rounded-lg p-4 overflow-x-auto">
              <div className="flex items-start gap-2">
                <span className="text-green-400 font-mono text-sm select-none">$</span>
                <pre
                  className={cn(
                    'font-mono text-sm whitespace-pre-wrap break-all',
                    isDangerous ? 'text-red-300' : 'text-gray-200'
                  )}
                >
                  {command}
                </pre>
              </div>
            </div>
            {description && (
              <p className="text-sm text-gray-400 italic">
                {description}
              </p>
            )}
          </div>
        );
      }

      case 'Write': {
        const filePath = toolInput.file_path as string;
        const content = toolInput.content as string;

        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-lg">
              <FilePlus className="w-4 h-4 text-green-400" />
              {formatFilePath(filePath)}
            </div>
            <div className="bg-black/50 border border-white/10 rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-white/5 border-b border-white/10 text-xs text-gray-500">
                Content Preview
              </div>
              <pre className="p-4 font-mono text-xs text-gray-300 overflow-x-auto max-h-64 overflow-y-auto">
                {truncateContent(content, 15)}
              </pre>
            </div>
          </div>
        );
      }

      case 'Edit': {
        const filePath = toolInput.file_path as string;
        const oldString = toolInput.old_string as string;
        const newString = toolInput.new_string as string;

        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <FileEdit className="w-4 h-4 text-blue-400" />
              {formatFilePath(filePath)}
            </div>
            <div className="bg-black/50 border border-white/10 rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-red-500/10 border-b border-white/10 text-xs text-red-400">
                - Remove
              </div>
              <pre className="p-3 font-mono text-xs text-red-300 overflow-x-auto max-h-32 overflow-y-auto bg-red-500/5">
                {truncateContent(oldString, 8)}
              </pre>
            </div>
            <div className="bg-black/50 border border-white/10 rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-green-500/10 border-b border-white/10 text-xs text-green-400">
                + Add
              </div>
              <pre className="p-3 font-mono text-xs text-green-300 overflow-x-auto max-h-32 overflow-y-auto bg-green-500/5">
                {truncateContent(newString, 8)}
              </pre>
            </div>
          </div>
        );
      }

      case 'WebFetch': {
        const url = toolInput.url as string;
        const prompt = toolInput.prompt as string;

        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-3 py-2 bg-purple-500/10 border border-purple-500/30 rounded-lg">
              <Globe className="w-4 h-4 text-purple-400" />
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm text-purple-300 hover:text-purple-200 underline underline-offset-2 truncate"
              >
                {url}
              </a>
            </div>
            {prompt && (
              <div className="bg-black/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-2">Extraction prompt:</p>
                <p className="text-sm text-gray-300">{prompt}</p>
              </div>
            )}
          </div>
        );
      }

      default: {
        // Generic JSON display for unknown tools
        return (
          <div className="bg-black/50 border border-white/10 rounded-lg p-4 overflow-x-auto">
            <pre className="font-mono text-xs text-gray-300 whitespace-pre-wrap">
              {JSON.stringify(toolInput, null, 2)}
            </pre>
          </div>
        );
      }
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent
        className="sm:max-w-lg bg-gray-900 border-white/10"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div
              className={cn(
                'p-2 rounded-lg bg-white/5',
                config.color
              )}
            >
              {config.icon}
            </div>
            <div>
              <span className="text-white">{config.label}</span>
              <span className="text-gray-500 font-normal ml-2">requires approval</span>
            </div>
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Review the following action before allowing it to proceed.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">{renderToolContent()}</div>

        {/* Deny reason input */}
        {showDenyReason && (
          <div className="space-y-2">
            <Input
              placeholder="Reason for denial (optional)"
              value={denyReason}
              onChange={(e) => setDenyReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleDeny();
                }
              }}
              autoFocus
              className="bg-black/30 border-white/10"
            />
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDenyWithoutReason}
                className="text-gray-400"
              >
                Skip reason
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <div className="flex items-center gap-1 text-xs text-gray-500 mr-auto">
            <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-gray-400">Enter</kbd>
            <span>approve</span>
            <span className="mx-1">/</span>
            <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-gray-400">Esc</kbd>
            <span>deny</span>
          </div>
          <Button
            variant="outline"
            onClick={handleDeny}
            className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <X className="w-4 h-4 mr-1" />
            Deny
          </Button>
          <Button
            ref={approveButtonRef}
            onClick={onApprove}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            <Check className="w-4 h-4 mr-1" />
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
