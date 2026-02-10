/*!
 * Connect - session - Session
 * Copyright(c) 2010 Sencha Inc.
 * Copyright(c) 2011 TJ Holowaychuk
 * MIT Licensed
 */

'use strict';

/**
 * Expose Session.
 */

module.exports = Session;

/**
 * Create a new `Session` with the given request and `data`.
 *
 * @param {IncomingRequest} req
 * @param {Object} data
 * @api private
 */

function Session(req, data) {
  var target = this;

  Object.defineProperty(target, 'req', {
    value: req,
    enumerable: false,
    writable: false,
    configurable: false
  });

  Object.defineProperty(target, 'id', {
    value: req.sessionID,
    enumerable: false,
    writable: false,
    configurable: false
  });

  // 内部状态标记
  Object.defineProperty(target, '_modified', {
    value: false,
    writable: true,
    enumerable: false,
    configurable: true
  });

  Object.defineProperty(target, '_locked', {
    value: false,
    writable: true,
    enumerable: false,
    configurable: true
  });

  // 标记是否正在初始化,初始化期间不触发修改标记
  Object.defineProperty(target, '_initializing', {
    value: true,
    writable: true,
    enumerable: false,
    configurable: true
  });

  if (typeof data === 'object' && data !== null) {
    // merge data into this, ignoring prototype properties
    for (var prop in data) {
      if (!(prop in target)) {
        target[prop] = data[prop]
      }
    }
  }

  // 标记用于 cookie 代理缓存
  var cookieProxy = null;

  // 创建 Proxy 来拦截属性修改
  var proxy = new Proxy(target, {
    get: function(obj, prop) {
      var value = obj[prop];

      // 如果获取 cookie 对象,返回一个代理(但不监听修改)
      // 与原始 hash 实现保持一致:忽略 cookie 的修改
      // cookie 的修改不应该触发 session 保存
      if (prop === 'cookie' && value && typeof value === 'object') {
        if (!cookieProxy || cookieProxy._target !== value) {
          cookieProxy = new Proxy(value, {
            get: function(cookieObj, cookieProp) {
              return cookieObj[cookieProp];
            },
            set: function(cookieObj, cookieProp, cookieValue) {
              // cookie 修改不触发 session _modified 标记
              // 这与原始 hash 实现一致(hash 计算时忽略 cookie)
              cookieObj[cookieProp] = cookieValue;
              return true;
            }
          });
          cookieProxy._target = value;
        }
        return cookieProxy;
      }

      return value;
    },

    set: function(obj, prop, value) {
      // 如果 session 已锁定,阻止修改
      if (obj._locked && prop !== '_locked' && prop !== '_modified' && prop !== '_initializing') {
        throw new Error('Cannot modify session after response has ended');
      }

      // 初始化期间不触发修改标记
      if (!obj._initializing) {
        // 忽略内部属性、req、id、cookie 的修改标记
        if (prop !== '_modified' && prop !== '_locked' &&
            prop !== 'req' && prop !== 'id' && prop !== 'cookie') {
          obj._modified = true;
        }

        // 设置新的 cookie 对象时清除缓存,但不标记为已修改
        // cookie 的修改不应该影响 session 的初始化状态
        if (prop === 'cookie' && obj[prop] !== value) {
          cookieProxy = null; // 清除缓存
        }
      }

      obj[prop] = value;
      return true;
    },

    deleteProperty: function(obj, prop) {
      // 如果 session 已锁定,阻止删除
      if (obj._locked) {
        throw new Error('Cannot modify session after response has ended');
      }

      // 标记为已修改
      if (prop !== '_modified' && prop !== '_locked' &&
          prop !== 'req' && prop !== 'id' && prop !== 'cookie') {
        obj._modified = true;
      }

      delete obj[prop];
      return true;
    },

    has: function(obj, prop) {
      return prop in obj;
    },

    ownKeys: function(obj) {
      return Reflect.ownKeys(obj);
    },

    getOwnPropertyDescriptor: function(obj, prop) {
      return Object.getOwnPropertyDescriptor(obj, prop);
    }
  });

  // 初始化完成,后续修改将触发 _modified 标记
  target._initializing = false;

  return proxy;
}

/**
 * Update reset `.cookie.maxAge` to prevent
 * the cookie from expiring when the
 * session is still active.
 *
 * @return {Session} for chaining
 * @api public
 */

defineMethod(Session.prototype, 'touch', function touch() {
  return this.resetMaxAge();
});

/**
 * Reset `.maxAge` to `.originalMaxAge`.
 *
 * @return {Session} for chaining
 * @api public
 */

defineMethod(Session.prototype, 'resetMaxAge', function resetMaxAge() {
  this.cookie.maxAge = this.cookie.originalMaxAge;
  return this;
});

/**
 * Save the session data with optional callback `fn(err)`.
 *
 * @param {Function} fn
 * @return {Session} for chaining
 * @api public
 */

defineMethod(Session.prototype, 'save', function save(fn) {
  this.req.sessionStore.set(this.id, this, fn || function(){});
  return this;
});

/**
 * Re-loads the session data _without_ altering
 * the maxAge properties. Invokes the callback `fn(err)`,
 * after which time if no exception has occurred the
 * `req.session` property will be a new `Session` object,
 * although representing the same session.
 *
 * @param {Function} fn
 * @return {Session} for chaining
 * @api public
 */

defineMethod(Session.prototype, 'reload', function reload(fn) {
  var req = this.req
  var store = this.req.sessionStore

  store.get(this.id, function(err, sess){
    if (err) return fn(err);
    if (!sess) return fn(new Error('failed to load session'));
    store.createSession(req, sess);
    fn();
  });
  return this;
});

/**
 * Destroy `this` session.
 *
 * @param {Function} fn
 * @return {Session} for chaining
 * @api public
 */

defineMethod(Session.prototype, 'destroy', function destroy(fn) {
  delete this.req.session;
  this.req.sessionStore.destroy(this.id, fn);
  return this;
});

/**
 * Regenerate this request's session.
 *
 * @param {Function} fn
 * @return {Session} for chaining
 * @api public
 */

defineMethod(Session.prototype, 'regenerate', function regenerate(fn) {
  this.req.sessionStore.regenerate(this.req, fn);
  return this;
});

/**
 * Helper function for creating a method on a prototype.
 *
 * @param {Object} obj
 * @param {String} name
 * @param {Function} fn
 * @private
 */
function defineMethod(obj, name, fn) {
  Object.defineProperty(obj, name, {
    configurable: true,
    enumerable: false,
    value: fn,
    writable: true
  });
};
