# 数组 Proxy 实现的正确姿势

## 核心观点 🎯

**Proxy 不能直接"监听 push"**,但可以监听到 push 造成的"结果变化",而且是 100% 可靠的。

**原因**: push/pop/splice/sort/reverse 等数组方法本质都是对数组索引和 length 的 set/delete 操作,Proxy 能拦截这些底层行为。

---

## 一、push 到底触发了什么?

```javascript
arr.push(1)
```

等价于(规范层面):

```javascript
arr[arr.length] = 1        // set 操作
arr.length = arr.length + 1 // set 操作
```

所以 Proxy 会收到:
- `set(target, "2", 1)` - 设置新元素
- `set(target, "length", 3)` - 更新 length

---

## 二、最简单的正确实现 ✅

**只监听 set / deleteProperty**,无需关心具体是 push 还是 splice!

```javascript
function proxyArray(arr, onDirty) {
  return new Proxy(arr, {
    set: function(target, key, value, receiver) {
      // 过滤无意义的 length 重写
      if (key === 'length' && value === target.length) {
        return true;
      }
      
      var oldValue = target[key];
      var result = Reflect.set(target, key, value, receiver);

      // 只有值真正改变时才标记
      if (oldValue !== value) {
        onDirty();
      }
      return result;
    },
    
    deleteProperty: function(target, key) {
      var result = Reflect.deleteProperty(target, key);
      onDirty();
      return result;
    }
  });
}
```

### 行为验证

```javascript
arr.push(1)     // ✅ dirty (触发 set)
arr[0] = 1      // ❌ 不 dirty (值没变)
arr.pop()       // ✅ dirty (触发 delete + set)
arr.length = 0  // ✅ dirty (触发 set)
arr.splice(...) // ✅ dirty (触发一系列 set)
```

---

## 三、为什么不建议单独劫持 push? ❌

**错误方案** (早期 Vue 2 的做法,已淘汰):

```javascript
get: function(target, key) {
  if (key === 'push') {
    return function(...args) {
      target.push(...args);
      onDirty();
    }
  }
}
```

### 问题清单

| 问题 | 原因 |
|------|------|
| 覆盖不全 | 还有 pop、shift、splice、sort、reverse、fill、copyWithin |
| this 错乱 | bind 问题 |
| 破坏原型 | 不支持 Symbol.iterator,会破坏 for..of |
| 性能差 | 每次 get 都包装函数 |
| 难维护 | 需要维护完整的方法列表 |

---

## 四、关键细节: 正确处理 length

### 问题

```javascript
arr.length = arr.length  // 会触发 set,但不是真变更
```

### 解决方案

```javascript
set: function(target, key, value, receiver) {
  // 过滤无意义的 length 重写
  if (key === 'length' && value === target.length) {
    return true;
  }

  var oldValue = target[key];
  var result = Reflect.set(target, key, value, receiver);

  if (oldValue !== value) {
    onDirty();
  }
  return result;
}
```

---

## 五、深层数组 + 对象统一代理 (session 场景)

```javascript
function deepProxy(value, onDirty) {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return new Proxy(value, {
    get: function(target, key, receiver) {
      var res = Reflect.get(target, key, receiver);
      // 递归代理嵌套的对象和数组
      return deepProxy(res, onDirty);
    },
    
    set: function(target, key, value, receiver) {
      // 过滤无意义的 length 重写
      if (key === 'length' && value === target.length) {
        return true;
      }
      
      var oldValue = target[key];
      var result = Reflect.set(target, key, value, receiver);

      if (oldValue !== value) {
        onDirty();
      }
      return result;
    },
    
    deleteProperty: function(target, key) {
      var result = Reflect.deleteProperty(target, key);
      onDirty();
      return result;
    }
  });
}
```

---

## 六、实际效果演示

### 示例 1: push 操作

```javascript
var arr = [1, 2];
arr.push(3);

// Proxy 收到的调用:
// set(arr, "2", 3)        - 新元素
// set(arr, "length", 3)   - 更新 length
```

### 示例 2: pop 操作

```javascript
var arr = [1, 2, 3];
arr.pop();

// Proxy 收到的调用:
// delete(arr, "2")        - 删除最后一个元素
// set(arr, "length", 2)   - 更新 length
```

### 示例 3: splice 操作

```javascript
var arr = ['a', 'b', 'c'];
arr.splice(1, 1, 'x');

// Proxy 收到的调用:
// set(arr, "1", 'x')      - 替换元素
// (可能还有其他内部操作)
```

### 示例 4: 嵌套数组

```javascript
session.data = { items: ['a', 'b'] };
session.data.items.push('c');

// 嵌套代理确保能检测到:
// set(items, "2", 'c')
// set(items, "length", 3)
```

---

## 七、express-session 的完整实现

```javascript
// session/session.js
function createDeepProxy(obj, root) {
  if (proxyCache.has(obj)) {
    return proxyCache.get(obj);
  }
  
  var proxy = new Proxy(obj, {
    get: function(target, prop) {
      var value = target[prop];
      
      // 递归代理嵌套对象和数组
      if (value && typeof value === 'object' && 
          (value.constructor === Object || Array.isArray(value))) {
        return createDeepProxy(value, root);
      }
      
      return value;
    },
    
    set: function(target, prop, value, receiver) {
      // 过滤无意义的 length 重写
      if (prop === 'length' && value === target.length) {
        return true;
      }
      
      var oldValue = target[prop];
      var result = Reflect.set(target, prop, value, receiver);
      
      // 只有值真正改变时才标记为已修改
      if (oldValue !== value && !root._initializing && !root._locked) {
        root._modified = true;
      }
      
      return result;
    },
    
    deleteProperty: function(target, prop) {
      if (prop in target && !root._locked) {
        var result = Reflect.deleteProperty(target, prop);
        if (!root._initializing) {
          root._modified = true;
        }
        return result;
      }
      return true;
    }
  });
  
  proxyCache.set(obj, proxy);
  return proxy;
}
```

---

## 八、测试验证

### 测试用例覆盖

1. ✅ `arr.push('item')` - 添加元素
2. ✅ `arr.pop()` - 删除末尾元素
3. ✅ `arr.shift()` - 删除首元素
4. ✅ `arr.unshift('item')` - 添加到开头
5. ✅ `arr.splice(1, 1)` - 删除元素
6. ✅ `arr[0] = 'x'` - 索引赋值
7. ✅ `arr.sort()` - 排序
8. ✅ `arr.reverse()` - 反转
9. ✅ `nested.items.push('x')` - 嵌套数组
10. ✅ `arr[0].name = 'x'` - 对象数组

### 测试结果

```bash
$ npm test

  169 passing (3s)
  0 failing
```

🎉 所有测试 100% 通过!

---

## 九、性能对比

### 错误方案 (包装方法)

```javascript
// 每次访问都创建新函数
get: function(target, key) {
  if (key === 'push') {
    return function() { /* 包装逻辑 */ }
  }
}
```

**开销**: 每次 `arr.push` 都创建新函数

### 正确方案 (拦截底层操作)

```javascript
// 只拦截 set/delete
set: function(target, key, value) {
  // 直接操作
}
```

**开销**: 零额外开销,只是正常的 Proxy 拦截

---

## 十、总结

### ✅ 正确做法

1. **只监听 set 和 deleteProperty** - 所有数组方法都会触发这些底层操作
2. **过滤无意义的 length 重写** - 避免误报
3. **值比较** - 只有真正改变才标记
4. **递归代理** - 支持嵌套数组和对象

### ❌ 错误做法

1. ~~在 get trap 中包装数组方法~~ - 覆盖不全、性能差、维护难
2. ~~维护数组方法列表~~ - 容易遗漏、不优雅
3. ~~不过滤 length 重写~~ - 产生误报

### 🎯 核心认知

**数组方法 = 底层的 set/delete 操作**

这是 Proxy + Array 最容易踩的坑,也是最优雅的解决方案!

---

## 参考资源

- [ECMAScript 规范 - Array Methods](https://tc39.es/ecma262/#sec-properties-of-the-array-prototype-object)
- [MDN - Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy)
- [Vue 3 Reactivity System](https://github.com/vuejs/core/tree/main/packages/reactivity) - 使用了类似的实现

---

**本实现已在 express-session 中验证,169 个测试 100% 通过!** 🚀
