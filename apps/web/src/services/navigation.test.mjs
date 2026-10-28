import assert from 'node:assert/strict';
import test from 'node:test';
import { currentPagePath, navigationSource, returnLabel, returnTarget, workspaceSections } from './navigation.ts';

test('工作区导航有固定且唯一的可用层级', () => {
  assert.deepEqual(workspaceSections.map(({ id }) => id), ['home', 'files', 'upload', 'shares', 'account']);
  assert.equal(new Set(workspaceSections.map(({ to }) => to)).size, workspaceSections.length);
});

test('详情返回保留站内来源路径及查询参数', () => {
  for (const path of ['/', '/files', '/files/0123456789abcdef01234567?q=海边', '/upload?parentId=0123456789abcdef01234567', '/shares', '/shares/new?targetId=0123456789abcdef01234567', '/shares/0123456789abcdef01234567/edit', '/settings/account', '/preview/0123456789abcdef01234567']) {
    assert.equal(returnTarget(path, '/files'), path);
  }
  assert.equal(currentPagePath('/files', '?q=%E6%B5%B7'), '/files?q=%E6%B5%B7');
  assert.equal(returnLabel('/files?q=海边'), '文件搜索结果');
});

test('多层详情来源安全传播，拒绝自指及站外来源', () => {
  const sharePath = '/shares/new?targetId=0123456789abcdef01234567';
  assert.deepEqual(navigationSource(sharePath.split('?')[0], `?${sharePath.split('?')[1]}`, { from: '/files?q=海边' }), { from: sharePath, previousFrom: '/files?q=海边' });
  assert.deepEqual(navigationSource('/upload', '', { from: '/upload' }), { from: '/upload' });
  assert.deepEqual(navigationSource('/shares', '', { from: '//evil.example' }), { from: '/shares' });
});

test('拒绝外站、协议相对路径及其它未登记的目标', () => {
  for (const source of [undefined, null, '', '//evil.example', 'https://evil.example/', '/\\evil.example', '/login', '/register', '/s/owner/path', '/map', '/files/../login', '/files#fragment', '/files\n/evil', '/files/invalid']) {
    assert.equal(returnTarget(source, '/files'), '/files');
  }
});
