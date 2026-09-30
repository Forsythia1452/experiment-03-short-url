import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, validateAlias, validateExpiry, validateLongUrl } from '../web/server.js';

async function fixture(rateLimit = 100) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'short-url-'));
  const instance = createServer({ demoMode: true, dbPath: path.join(dir, 'test.db'), publicUrl: 'http://127.0.0.1', rateLimit });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const address = instance.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  instance.store.publicUrl = base;
  return {
    ...instance, base, dir,
    async close() {
      await new Promise((resolve) => instance.server.close(resolve));
      instance.store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

async function post(base, body) {
  return fetch(`${base}/api/short-urls`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

test('接受 HTTP 和 HTTPS 长网址', () => {
  assert.equal(validateLongUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(validateLongUrl('http://example.com'), 'http://example.com/');
});

test('拒绝 javascript 协议', () => assert.throws(() => validateLongUrl('javascript:alert(1)'), /HTTP/));
test('拒绝空输入和无效网址', () => {
  assert.throws(() => validateLongUrl(''), /请输入/);
  assert.throws(() => validateLongUrl('not-a-url'), /格式/);
});
test('拒绝超过 2048 字符的网址', () => assert.throws(() => validateLongUrl(`https://x.test/${'a'.repeat(2040)}`), /2048/));
test('短码规则允许字母数字下划线和连字符', () => assert.equal(validateAlias('news_2026-x'), 'news_2026-x'));
test('短码少于四位会失败', () => assert.throws(() => validateAlias('abc'), /4-30/));
test('有效期必须晚于当前时间', () => assert.throws(() => validateExpiry('2020-01-01T00:00:00Z'), /未来/));

test('创建短链返回 201 和完整字段', async () => {
  const f = await fixture();
  try {
    const r = await post(f.base, { longUrl: 'https://example.com/news', customSlug: 'news2026' });
    assert.equal(r.status, 201);
    const body = await r.json();
    assert.equal(body.shortCode, 'news2026');
    assert.equal(body.longUrl, 'https://example.com/news');
    assert.match(body.shortUrl, /\/s\/news2026$/);
  } finally { await f.close(); }
});

test('未指定短码时自动生成', async () => {
  const f = await fixture();
  try {
    const r = await post(f.base, { longUrl: 'https://example.com/auto' });
    const body = await r.json();
    assert.equal(r.status, 201);
    assert.match(body.shortCode, /^[A-Za-z0-9_-]{6}$/);
  } finally { await f.close(); }
});

test('重复短码返回 409', async () => {
  const f = await fixture();
  try {
    await post(f.base, { longUrl: 'https://a.example', customSlug: 'repeat' });
    const r = await post(f.base, { longUrl: 'https://b.example', customSlug: 'repeat' });
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /存在/);
  } finally { await f.close(); }
});

test('列表包含已创建短链', async () => {
  const f = await fixture();
  try {
    await post(f.base, { longUrl: 'https://example.com/list', customSlug: 'list-one' });
    const r = await fetch(`${f.base}/api/short-urls`);
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].shortCode, 'list-one');
  } finally { await f.close(); }
});

test('真实 GET 返回 302 并累计访问次数', async () => {
  const f = await fixture();
  try {
    await post(f.base, { longUrl: 'https://example.com/target', customSlug: 'go-target' });
    const redirect = await fetch(`${f.base}/s/go-target`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), 'https://example.com/target');
    await fetch(`${f.base}/s/go-target`, { redirect: 'manual' });
    const stats = await (await fetch(`${f.base}/api/short-urls/go-target/visits`)).json();
    assert.equal(stats.count, 2);
    assert.equal(stats.visits.length, 2);
  } finally { await f.close(); }
});

test('未知短码返回 404', async () => {
  const f = await fixture();
  try { assert.equal((await fetch(`${f.base}/s/missing`, { redirect: 'manual' })).status, 404); }
  finally { await f.close(); }
});

test('过期短链返回 410', async () => {
  const f = await fixture();
  try {
    f.store.db.prepare('INSERT INTO links(code,long_url,created_at,valid_until) VALUES(?,?,?,?)').run('expired', 'https://example.com', new Date().toISOString(), '2020-01-01T00:00:00.000Z');
    assert.equal((await fetch(`${f.base}/s/expired`, { redirect: 'manual' })).status, 410);
  } finally { await f.close(); }
});

test('创建频率超限返回 429', async () => {
  const f = await fixture(1);
  try {
    assert.equal((await post(f.base, { longUrl: 'https://a.example' })).status, 201);
    assert.equal((await post(f.base, { longUrl: 'https://b.example' })).status, 429);
  } finally { await f.close(); }
});

test('数据库关闭重开后短链和访问数保留', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'short-persist-'));
  const dbPath = path.join(dir, 'persist.db');
  let f = createServer({ demoMode: true, dbPath, publicUrl: 'http://127.0.0.1', rateLimit: 100 });
  await new Promise((resolve) => f.server.listen(0, '127.0.0.1', resolve));
  let base = `http://127.0.0.1:${f.server.address().port}`; f.store.publicUrl = base;
  await post(base, { longUrl: 'https://example.com/keep', customSlug: 'keep-data' });
  await fetch(`${base}/s/keep-data`, { redirect: 'manual' });
  await new Promise((resolve) => f.server.close(resolve)); f.store.close();
  f = createServer({ demoMode: true, dbPath, publicUrl: 'http://127.0.0.1', rateLimit: 100 });
  await new Promise((resolve) => f.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${f.server.address().port}`; f.store.publicUrl = base;
  try {
    const body = await (await fetch(`${base}/api/short-urls`)).json();
    assert.equal(body.data[0].shortCode, 'keep-data');
    assert.equal(body.data[0].visitsCount, 1);
  } finally {
    await new Promise((resolve) => f.server.close(resolve)); f.store.close(); fs.rmSync(dir, { recursive: true, force: true });
  }
});

