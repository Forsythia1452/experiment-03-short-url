import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'web/public/index.html'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

test('Web 页面含创建表单、列表和统计列', () => {
  assert.match(html, /id="create-form"/);
  assert.match(html, /链接列表/);
  assert.match(html, /访问/);
});
test('前端源码不包含管理密钥变量', () => assert.doesNotMatch(html, /SHLINK_API_KEY|X-Api-Key/));
test('Compose 使用固定 Shlink 和 PostgreSQL 标签', () => {
  assert.match(compose, /SHLINK_TAG:-5\.1\.6/);
  assert.match(compose, /POSTGRES_TAG:-16\.14-alpine/);
});
test('Compose 使用服务名联网而非容器 IP', () => assert.match(compose, /SHLINK_BASE_URL: http:\/\/shlink:8080/));
test('Compose 三个服务均配置健康检查', () => assert.equal((compose.match(/healthcheck:/g) || []).length, 3));
test('Compose 使用命名卷保存数据库', () => {
  assert.match(compose, /shlink-db:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /name: experiment03-shlink-db/);
});
test('Web 容器以非 root 用户运行', () => assert.match(dockerfile, /USER node/));
test('.env 被 Git 忽略', () => assert.match(gitignore, /^\.env$/m));
test('页面具备响应式布局', () => assert.match(html, /@media\(max-width:800px\)/));

