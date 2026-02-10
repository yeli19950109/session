#!/usr/bin/env node
/**
 * express-session Proxy 代理演示
 *
 * 这个示例展示了如何使用 Proxy 来跟踪 session 修改,
 * 而不是通过计算 hash 来判断 session 是否被修改。
 */

var express = require('express');
var session = require('../index');

var app = express();

// 配置 session 中间件
app.use(session({
  secret: 'keyboard cat',
  resave: false,
  saveUninitialized: false, // 未修改的 session 不会保存
  cookie: { maxAge: 60000 }
}));

// 演示 1: 未修改的 session
app.get('/unmodified', function(req, res) {
  // 只读取 session,不修改
  var views = req.session.views || 0;
  res.send('Views (not modified): ' + views + '. Session will NOT be saved.');
});

// 演示 2: 修改 session 属性
app.get('/modify', function(req, res) {
  if (!req.session.views) {
    req.session.views = 0;
  }
  req.session.views++;
  res.send('Views: ' + req.session.views + '. Session WILL be saved (modified).');
});

// 演示 3: 修改 cookie 属性
app.get('/cookie', function(req, res) {
  // 修改 cookie 的 maxAge
  req.session.cookie.maxAge = 120000;
  res.send('Cookie maxAge changed to 120s. Session WILL be saved (cookie modified).');
});

// 演示 4: 响应结束后尝试修改 (会抛出错误)
app.get('/locked', function(req, res) {
  req.session.data = 'initial';
  res.send('Session saved.');

  // 尝试在响应结束后修改 session (在实际环境中会失败)
  process.nextTick(function() {
    try {
      req.session.data = 'modified after end';
      console.log('ERROR: Should have thrown an error!');
    } catch (err) {
      console.log('✓ Correctly prevented modification after response ended:');
      console.log('  Error:', err.message);
    }
  });
});

// 演示 5: 删除属性
app.get('/delete', function(req, res) {
  req.session.tempData = 'will be deleted';
  delete req.session.tempData;
  res.send('Property deleted. Session WILL be saved (modified).');
});

// 启动服务器
var PORT = 3000;
var server = app.listen(PORT, function() {
  console.log('');
  console.log('========================================');
  console.log('express-session Proxy 代理演示');
  console.log('========================================');
  console.log('');
  console.log('服务器运行在: http://localhost:' + PORT);
  console.log('');
  console.log('测试端点:');
  console.log('  1. GET /unmodified  - 只读取,不修改 (不保存)');
  console.log('  2. GET /modify      - 修改属性 (会保存)');
  console.log('  3. GET /cookie      - 修改 cookie (会保存)');
  console.log('  4. GET /locked      - 响应后锁定演示');
  console.log('  5. GET /delete      - 删除属性 (会保存)');
  console.log('');
  console.log('特性:');
  console.log('  ✓ 使用 Proxy 跟踪修改,无需计算 hash');
  console.log('  ✓ 响应结束后 session 自动锁定,防止意外修改');
  console.log('  ✓ 更高性能,减少 CPU 开销');
  console.log('');
  console.log('按 Ctrl+C 停止服务器');
  console.log('');
});

// 优雅关闭
process.on('SIGINT', function() {
  console.log('');
  console.log('正在关闭服务器...');
  server.close(function() {
    console.log('服务器已关闭');
    process.exit(0);
  });
});
