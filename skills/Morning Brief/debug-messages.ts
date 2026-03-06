import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

const VAULT_PATH = process.env.VAULT_PATH || '';
const INBOX_PATH = join(VAULT_PATH, '1 - Inbox (Last 7 days)');
const dmsPath = join(INBOX_PATH, 'Telegram/DMs');

function getRecentFiles(dir: string, days: number): string[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const files: { path: string; mtime: number }[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isFile() && entry.endsWith('.md')) {
        if (stat.mtimeMs > cutoff) {
          files.push({ path: fullPath, mtime: stat.mtimeMs });
        }
      }
    }
  } catch {}
  return files.sort((a, b) => b.mtime - a.mtime).map(f => f.path);
}

const files = getRecentFiles(dmsPath, 7);
console.log('Processing', files.length, 'files\n');

for (const file of files.slice(0, 10)) {
  const content = readFileSync(file, 'utf-8');
  const contactName = basename(file).replace('.md', '').replace(/_/g, ' ');

  const lines = content.split('\n');
  const parsedMessages: any[] = [];
  let currentDate: string | undefined;
  let currentSender: 'them' | 'me' | null = null;
  let currentText: string[] = [];
  let lastMessageTime: string | undefined;

  for (const line of lines) {
    // Check for date header: ## YYYY-MM-DD
    const dateMatch = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      currentDate = dateMatch[1];
      continue;
    }

    const headerMatch = line.match(/^###\s+(\d{1,2}:\d{2})\s*-\s*(.+?)\s*\((@\w+)\)/);

    if (headerMatch) {
      if (currentSender && currentText.length > 0) {
        parsedMessages.push({ sender: currentSender, text: currentText.join(' ').trim().slice(0, 40), timestamp: lastMessageTime });
      }
      const time = headerMatch[1];
      lastMessageTime = currentDate ? `${time} on ${currentDate}` : time;
      const senderName = headerMatch[2].toLowerCase();
      const ownerNames = (process.env.OWNER_NAMES || 'the user').toLowerCase().split(',');
      currentSender = ownerNames.some(n => senderName.includes(n.trim())) ? 'me' : 'them';
      currentText = [];
    } else if (currentSender && line.trim() && !line.startsWith('#') && !line.startsWith('---')) {
      currentText.push(line.trim());
    }
  }

  if (currentSender && currentText.length > 0) {
    parsedMessages.push({ sender: currentSender, text: currentText.join(' ').trim().slice(0, 40), timestamp: lastMessageTime });
  }

  console.log(contactName, '- msgs:', parsedMessages.length, '- recent:', parsedMessages[0]?.timestamp || 'none');
  if (parsedMessages.length > 0) {
    console.log('  First msg:', parsedMessages[0].sender, '-', parsedMessages[0].text);
  }
}
