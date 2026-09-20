// THROWAWAY: a tracker-agnostic localhost receiver. Source operations stay outside it.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

export async function createReceiver({ port = 30143, token, onChange = () => {} }) {
  const nodes = new Map(), receipts = new Map(), log = [];
  let failNext = false;
  const snapshot = () => ({ nodes: [...nodes.values()], log });
  const server = createServer(async (req, res) => {
    const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(readFileSync(new URL('./view.html', import.meta.url)));
    }
    if (req.method === 'GET' && req.url === '/state') return json(200, snapshot());
    if (req.method !== 'POST' || req.url !== '/events') return json(404, { error: 'Not found' });
    if (req.headers.authorization !== `Bearer ${token}`) return json(401, { error: 'Invalid local token' });
    if (failNext) { failNext = false; req.resume(); log.push({ action: '模拟接收失败', at: new Date().toISOString() }); onChange(snapshot()); return json(503, { error: 'Injected one-shot failure' }); }
    let body = '';
    try {
      for await (const chunk of req) { body += chunk; if (body.length > 150000) throw new Error('Event too large'); }
      const event = JSON.parse(body), { ticket } = event;
      if (typeof event.id !== 'string' || !ticket || !['sourceKey', 'source', 'locator', 'title', 'status'].every(k => typeof ticket[k] === 'string' && ticket[k].length)) throw new Error('Missing ticket identity or fields');
      if (!['open', 'claimed', 'resolved', 'cancelled', 'deleted'].includes(ticket.status)) throw new Error('Invalid status');
      if (ticket.blockers !== undefined && (!Array.isArray(ticket.blockers) || ticket.blockers.some(b => typeof b !== 'string'))) throw new Error('Invalid blockers');
      const serialized = JSON.stringify(ticket);
      if (receipts.has(event.id)) {
        if (receipts.get(event.id) !== serialized) return json(409, { error: 'Same event ID with different content' });
        log.push({ action: '重复通知已忽略', title: ticket.title, at: new Date().toISOString() }); onChange(snapshot());
        return json(200, { applied: false, duplicate: true });
      }
      const previous = nodes.get(ticket.sourceKey);
      // Keep a tombstone so a disappeared source is distinct from an unfinished ticket.
      nodes.set(ticket.sourceKey, { ...ticket, firstSeen: previous?.firstSeen || new Date().toISOString(), deliveries: (previous?.deliveries || 0) + 1 });
      receipts.set(event.id, serialized);
      log.push({ action: ticket.status === 'deleted' ? '记录删除' : previous ? '更新节点' : '新增节点', title: ticket.title, source: ticket.source, at: new Date().toISOString() });
      onChange(snapshot());
      return json(200, { applied: true, key: ticket.sourceKey });
    } catch (error) { return json(400, { error: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, snapshot, failOnce: () => { failNext = true; } };
}
