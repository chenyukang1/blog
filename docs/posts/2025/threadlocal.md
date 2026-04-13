ThreadLoacl 提供线程本地变量的能力，实现线程间的数据隔离。只要线程存活并且该 ThreadLocal 实例可以被访问，每个线程实际上持有线程本地变量的隐式引用

## ThreadLocal 实现原理

实际上理清了 Thread、ThreadLocal、ThreadlocalMap 三者之间的关系，也就理解了 ThreadLocal 的实现原理

![](https://raw.githubusercontent.com/chenyukang1/pic/pic/img/1189489-20200726134817220-1510031517.png)

Thread 类中有 ThreadLocalMap 类型的成员变量 threadLocals

```java  
/* ThreadLocal values pertaining to this thread. This map is maintained by the ThreadLocal class. */
ThreadLocal.ThreadLocalMap threadLocals = null;
```

ThreadLocalMap 可以理解为当前线程持有的所有 ThreadLocal 对象集合。每个 Thread 实例持有一个 ThreadLocalMap 类型的变量 threadLocals，当线程初始化的时候，threadLocals 初始化为 null

```java
// ThreadLocal#set
public void set(T value) {  
    Thread t = Thread.currentThread();  
    ThreadLocalMap map = getMap(t);  
    if (map != null) {  
        map.set(this, value);  
    } else {  
        createMap(t, value);  
    }  
}
```

当我们声明了一个 ThreadLocal 实例然后 set 值时，首先找到当前线程，把值放进该线程的 ThreadLocalMap 中

```java
static class ThreadLocalMap {

	static class Entry extends WeakReference<ThreadLocal<?>> {  

	    /** The value associated with this ThreadLocal. */  
	    Object value;  

	    Entry(ThreadLocal<?> k, Object v) {  
	        super(k);  
	        value = v;  
	    }  
	}

	/**  
	 * The table, resized as necessary. * table.length MUST always be a power of two. */
	private Entry[] table;

}
```

ThreadLocalMap 本质上是一个 Entry 哈希表，key 是 ThreadLocal，value 是 ThreadLocal 关联的 value。Entry 通过继承 WeakReference，为所有的 ThreadLocal 变量创建了弱引用

被弱引用指向的对象在下次 GC 就会被回收，也就是说只要我们程序代码中对 ThreadLocal 实例的强引用没了，这个实例就会被 GC 掉。这个设计是避免内存泄漏，试想下不使用弱引用为什么会发生内存泄漏？因为 ThreadLocalMap 实例的引用被 Thread 持有，而该线程的 ThreadLocal 实例引用被 ThreadLocalMap 持有，那么在线程仍然存活但不再引用 ThreadLocal 实例时，这部分内存实际上没法被 GC 掉，因为仍然被 ThreadLocalMap 的 Entry 引用着，因此弱引用就被设计来解决这个问题

既然 ThreadLocalMap 本质上是一个 Entry 哈希表，它又是怎么解决哈希冲突的呢？ ThreadLocalMap 没有像传统 HashMap 一样用链表/红黑树解决哈希冲突，是因为它根本不追求通用哈希结构的高性能，而是追求**轻量、内存紧凑**，并依靠 **线性探测（开放地址法）** 来解决冲突：插入时，如果碰到冲突，就往后找空位放；查找时，如果在预期下标没找到，就必须往后继续找

```java
private Entry getEntryAfterMiss(ThreadLocal<?> key, int i, Entry e) {
    Entry[] tab = table;
    int len = tab.length;

    while (e != null) {
        ThreadLocal<?> k = e.get();
        if (k == key)
            return e;
        if (k == null)
            expungeStaleEntry(i);
        else
            i = nextIndex(i, len);
        e = tab[i];
    }
    return null;
}
```

在一次哈希查找失败后，会进入 getEntryAfterMiss 方法，继续往后探测：
1. 如果 `e.get() == key`，说明找到了目标 `ThreadLocal`，返回 entry
2. 如果 `e.get() == null`，说明 key 已经被 GC 回收了，调用 `expungeStaleEntry(i)` 清理无效 entry
3. 否则，发生哈希冲突，调用 `nextIndex(i, len)` 移动到下一个槽位，继续探测
4. 如果遇到 `null`，说明整个探测链结束，返回 `null`

### 弱引用不能完全解决问题

ThreadLocalMap 为了解决内存泄漏，Entry.key 使用了弱引用指向 ThreadLocal 实例，当 ThreadLocal 没有强引用时，会被 GC 回收，但是 Entry.value 还在。因为`Entry` 这个对象本身，仍然保存在 ThreadLocalMap.table 数组里，挂在 **当前线程的 threadLocals 字段** 上。只要线程活着，这个 ThreadLocalMap 就活着，整个 value 就“泄漏”在当前线程的生命周期里。如果这是个 **线程池线程**，它不会轻易销毁，那 value 就会一直占着内存，这就是 ThreadLocal 内存泄漏的根源

JDK 也考虑到了这个情况，每次调用`get()` / `set()` / `remove()` 时，ThreadLocalMap 都会顺便清理掉 key = null 的过期 entry（`expungeStaleEntry(i)`）。但如果不再访问这个 ThreadLocal，清理逻辑就不会触发，value 就一直泄漏

因此，避免内存泄漏的最佳实践是使用完手动调用 remove() 方法，手动清理。但是这不是和 Java “自动内存管理”的初衷相悖了吗？其实这样设计也是权衡过的：

- 如果 value 也用弱引用
	业务数据可能莫名其妙丢失（GC 一来数据没了，线程里取出来是 `null`，很难排查）
- 如果不用弱引用
	key 被 GC 了，Map 永远残留 entry，更严重的内存泄漏
- 折中方案
	- key 用弱引用 → 至少 ThreadLocal 本身不会泄漏
	- value 用强引用 → 保证业务数据稳定
	- 调用点触发清理 → 每次 `get/set/remove` 都顺便清理过期 entry

InheritableThreadLocal 怎么实现父子变量传递

### 线程启动流程

Thread#start0

| 步骤               | 说明                                                                                |
| ---------------- | --------------------------------------------------------------------------------- |
| ✅ 检查线程状态         | 如果线程已经启动，抛出 `IllegalThreadStateException`                                         |
| ✅ 创建本地线程结构       | 分配线程栈、注册线程控制块等                                                                    |
| ✅ 调用 OS 系统 API   | 比如调用 `pthread_create()`（在 Linux/macOS 上）或 `_beginthreadex()`（Windows）来创建一个真正的系统线程 |
| ✅ 注册到 JVM 的线程调度器 | 把新线程加入到 JVM 的线程管理结构中                                                              |
| ✅ 设置线程状态         | 从 `NEW` -> `RUNNABLE`，进入线程就绪队列                                                    |
| ✅ 执行 run() 方法    | 当调度器调度该线程时，会自动执行该线程的 `run()` 方法内容                                                 |
