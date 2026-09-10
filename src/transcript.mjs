import {appendFile, mkdir, readFile} from 'node:fs/promises'
import {dirname} from 'node:path'
import {randomUUID} from 'node:crypto'

const writes = new Map()
/** Serialize append + ID check so concurrent outbox retries cannot duplicate a message.
 * Content is never an identity: two intentional identical messages remain distinct. */
export function appendTranscript(path, entry) {
  const run = async () => {
    await mkdir(dirname(path), {recursive: true})
    let text = ''
    try {text = await readFile(path, 'utf8')} catch (error) {if (error.code !== 'ENOENT') throw error}
    const messageId = entry.messageId || (entry.requestId ? `chat-${entry.requestId}-${entry.role}` : randomUUID())
    for (const line of text.split('\n')) {
      try {const saved = JSON.parse(line); if (saved.messageId === messageId) return saved} catch {}
    }
    const message = {ts: Date.now(), ...entry, messageId}
    await appendFile(path, `${text.length && !text.endsWith('\n') ? '\n' : ''}${JSON.stringify(message)}\n`)
    return message
  }
  const next = (writes.get(path) || Promise.resolve()).then(run, run)
  writes.set(path, next)
  void next.finally(() => {if (writes.get(path) === next) writes.delete(path)}).catch(() => {})
  return next
}
