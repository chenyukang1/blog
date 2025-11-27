---
date: 2025-09-04
category:
  - 中间件
tag:
  - 分布式
  - 限流
---

# Sentinel限流牛逼在哪

Sentinel 是阿里巴巴开源的一款流量控制组件，专注于分布式系统的流量控制、熔断降级和系统保护。它提供了丰富的功能和灵活的扩展性，能够帮助开发者轻松应对高并发场景下的流量管理需求

## 核心功能

1. **流量控制**：支持多种限流策略（如 QPS、线程数等），并提供基于调用关系的流量控制能力
2. **熔断降级**：根据响应时间、异常比例等指标，自动熔断不稳定的服务，保护系统的稳定性
3. **系统保护**：通过监控系统的关键指标（如 CPU 使用率、内存占用等），动态调整流量，避免系统过载
4. **实时监控**：提供控制台，实时查看流量数据和规则配置，方便运维和调试
5. **扩展性强**：支持自定义规则和扩展点，满足复杂场景的需求

## 基本原理

在 Sentinel 里面，所有的资源都对应一个资源名称以及一个 Entry。Entry 可以通过对主流框架的适配自动创建，也可以通过注解的方式或调用 API 显式创建；每一个 Entry 创建的时候，同时也会创建一系列功能插槽（slot chain）。这些插槽有不同的职责，例如:
- NodeSelectorSlot 负责收集资源的路径，并将这些资源的调用路径，以树状结构存储起来，用于根据调用路径来限流降级；
- ClusterBuilderSlot 则用于存储资源的统计信息以及调用者信息，例如该资源的 RT, QPS, thread count 等等，这些信息将用作为多维度限流，降级的依据；
- FlowSlot 则用于根据预设的限流规则以及前面 slot 统计的状态，来进行流量控制；
- AuthoritySlot 则根据配置的黑白名单和调用来源信息，来做黑白名单控制；
- DegradeSlot 则通过统计信息以及预设的规则，来做熔断降级；
- SystemSlot 则通过系统的状态，例如 load1 等，来控制总的入口流量；

总体框架如下：

![sentinel框架](https://raw.githubusercontent.com/chenyukang1/pic/pic/img/image.png)

Sentinel 将 ProcessorSlot 作为 SPI 接口进行扩展（1.7.2 版本以前 SlotChainBuilder 作为 SPI），使得 Slot Chain 具备了扩展的能力。您可以自行加入自定义的 slot 并编排 slot 间的顺序，从而可以给 Sentinel 添加自定义的功能

## 源码解析

不妨以官网给出的例子为起点，一步步看限流的基本原理

```java
// 1.5.0 版本开始可以利用 try-with-resources 特性
// 资源名可使用任意有业务语义的字符串，比如方法名、接口名或其它可唯一标识的字符串。
try (Entry entry = SphU.entry("resourceName")) {
  // 被保护的业务逻辑
  // do something here...
} catch (BlockException ex) {
  // 资源访问阻止，被限流或被降级
  // 在此处进行相应的处理操作
}
```
这种编程式的方式侵入性较大，比较常用的方式是集成 SpringBoot，通过 `@SentinelResource` 注解开启对方法的限流。`@SentinelResource` 注解的方式实际上是注解 + AOP，最终还是走到 `com.alibaba.csp.sentinel.SphU#entry`

```java
   public static Entry entry(String name) throws BlockException {
        return Env.sph.entry(name, EntryType.OUT, 1, OBJECTS0);
    }
```

默认的参数是 EntryType.OUT，1，前者代表出流量，后者代表本次调用中的请求数，可由业务自定义

在这个方法中会去组装 slot chain，然后进行调用，组装的过程中用到了 SPI，允许用户扩展自己的插槽。默认的 slot chain 继承了 `AbstractLinkedProcessorSlot`，它提供两个关键的方法，`fireEntry` 用于触发下一个 slot，`transformEntry` 触发当前 slot；另一个设计的精妙之处是这个 slot chain 通过实现了 `ProcessorSlot` 作为一个虚拟的头节点

```java
public abstract class AbstractLinkedProcessorSlot<T> implements ProcessorSlot<T> {

    private AbstractLinkedProcessorSlot<?> next = null;

    @Override
    public void fireEntry(Context context, ResourceWrapper resourceWrapper, Object obj, int count, boolean prioritized, Object... args)
        throws Throwable {
        if (next != null) {
            next.transformEntry(context, resourceWrapper, obj, count, prioritized, args);
        }
    }

    @SuppressWarnings("unchecked")
    void transformEntry(Context context, ResourceWrapper resourceWrapper, Object o, int count, boolean prioritized, Object... args)
        throws Throwable {
        T t = (T)o;
        entry(context, resourceWrapper, t, count, prioritized, args);
    }

    @Override
    public void fireExit(Context context, ResourceWrapper resourceWrapper, int count, Object... args) {
        if (next != null) {
            next.exit(context, resourceWrapper, count, args);
        }
    }

    public AbstractLinkedProcessorSlot<?> getNext() {
        return next;
    }

    public void setNext(AbstractLinkedProcessorSlot<?> next) {
        this.next = next;
    }

}
```

好的，现在 slot chain 开始依次触发 slot 了，不妨看看这些 slot 都有什么职责

### NodeSelectorSlot

负责收集资源的路径，并将这些资源的调用路径，以树状结构存储起来，用于根据调用路径来限流降级

``` java
    /**
     * {@link DefaultNode}s of the same resource in different context.
     */
    private volatile Map<String, DefaultNode> map = new HashMap<String, DefaultNode>(10);

    @Override
    public void entry(Context context, ResourceWrapper resourceWrapper, Object obj, int count, boolean prioritized, Object.. args) throws Throwable {
    DefaultNode node = map.get(context.getName());
    if (node == null) {
        synchronized (this) {
            node = map.get(context.getName());
            if (node == null) {
                node = new DefaultNode(resourceWrapper, null);
                HashMap<String, DefaultNode> cacheMap = new HashMap<String, DefaultNode>(map.size());
                cacheMap.putAll(map);
                cacheMap.put(context.getName(), node);
                map = cacheMap;
                // Build invocation tree
                ((DefaultNode) context.getLastNode()).addChild(node);
            }
        }
    }
    }
```

这段代码不难理解，但是有两个细节的问题：
1. 为什么这里更新 map 不用相对简单高效的 concurrenthashmap，而是用了相对复杂的 hashmap + DCL（双重检查锁）？
   我在 [github issue](https://github.com/alibaba/Sentinel/issues/144) 上找到了类似的提问，附上作者的回答：
   这里的 chainMap 只有在应用程序启动之初才会发生变化，之后就会保持稳定。因此，我们使用 copy on write，以获得更高的并发性能

   仔细想想确实是这样，一旦这些规则加载进来之后几乎就不会变了，后面的判断 if (node == null) 几乎都会是 false，也就连锁都不用加了
2. 为什么直接在原来的 map 上 put 不行，而是要 copy on write？
   因为 hashmap 的底层数据结构 Node<K,V>[] table 并没有被 volatile 修饰，所以 get 操作不能保证可见性，而 concurrenthashmap 的 底层数据结构才有 volatile 修饰。因此只能每次去修改 map 指向的内存，然后用 volatile 修饰 map，保证每次 get 都能看到最新的 map

### ClusterBuilderSlot

用于存储资源的统计信息以及调用者信息，例如该资源的 RT, QPS, thread count 等等，这些信息将用作为多维度限流，降级的依据

```java
    /**
     * <p>
     * Remember that same resource({@link ResourceWrapper#equals(Object)}) will share
     * the same {@link ProcessorSlotChain} globally, no matter in witch context. So if
     * code goes into {@link #entry(Context, ResourceWrapper, DefaultNode, int, boolean, Object...)},
     * the resource name must be same but context name may not.
     * </p>
     * <p>
     * To get total statistics of the same resource in different context, same resource
     * shares the same {@link ClusterNode} globally. All {@link ClusterNode}s are cached
     * in this map.
     * </p>
     * <p>
     * The longer the application runs, the more stable this mapping will
     * become. so we don't concurrent map but a lock. as this lock only happens
     * at the very beginning while concurrent map will hold the lock all the time.
     * </p>
     */
    private static volatile Map<ResourceWrapper, ClusterNode> clusterNodeMap = new HashMap<>();

    private static final Object lock = new Object();

    private volatile ClusterNode clusterNode = null;

    @Override
    public void entry(Context context, ResourceWrapper resourceWrapper, DefaultNode node, int count,
                      boolean prioritized, Object... args)
        throws Throwable {
        if (clusterNode == null) {
            synchronized (lock) {
                if (clusterNode == null) {
                    // Create the cluster node.
                    clusterNode = new ClusterNode(resourceWrapper.getName(), resourceWrapper.getResourceType());
                    HashMap<ResourceWrapper, ClusterNode> newMap = new HashMap<>(Math.max(clusterNodeMap.size(), 16));
                    newMap.putAll(clusterNodeMap);
                    newMap.put(node.getId(), clusterNode);

                    clusterNodeMap = newMap;
                }
            }
        }
        node.setClusterNode(clusterNode);

        /*
         * if context origin is set, we should get or create a new {@link Node} of
         * the specific origin.
         */
        if (!"".equals(context.getOrigin())) {
            Node originNode = node.getClusterNode().getOrCreateOriginNode(context.getOrigin());
            context.getCurEntry().setOriginNode(originNode);
        }

        fireEntry(context, resourceWrapper, node, count, prioritized, args);
    }

```

ClusterNode 继承自 StatisticNode，保存了一系列统计信息。相同的资源会共享一个 ProcessorSlotChain，所以为了得到同一个资源的所有统计数据，相同的资源共享同一个 ClusterNode，这是由单例保证的，而所有 ClusterNode 都缓存在 clusterNodeMap 中，这是由 static 关键字保证的
注意上一步的 DefaultNode 是和 context name 绑定的，而 node.setClusterNode(clusterNode) 这步会把相同资源的同一个 ClusterNode 都设置进去

### StatisticSlot

```java
    @Override
    public void entry(Context context, ResourceWrapper resourceWrapper, DefaultNode node, int count,
                      boolean prioritized, Object... args) throws Throwable {
        try {
            // Do some checking.
            fireEntry(context, resourceWrapper, node, count, prioritized, args);

            // Request passed, add thread count and pass count.
            node.increaseThreadNum();
            node.addPassRequest(count);

            if (context.getCurEntry().getOriginNode() != null) {
                // Add count for origin node.
                context.getCurEntry().getOriginNode().increaseThreadNum();
                context.getCurEntry().getOriginNode().addPassRequest(count);
            }

            if (resourceWrapper.getEntryType() == EntryType.IN) {
                // Add count for global inbound entry node for global statistics.
                Constants.ENTRY_NODE.increaseThreadNum();
                Constants.ENTRY_NODE.addPassRequest(count);
            }

            // Handle pass event with registered entry callback handlers.
            for (ProcessorSlotEntryCallback<DefaultNode> handler : StatisticSlotCallbackRegistry.getEntryCallbacks()) {
                handler.onPass(context, resourceWrapper, node, count, args);
            }
        } catch (PriorityWaitException ex) {
            node.increaseThreadNum();
            if (context.getCurEntry().getOriginNode() != null) {
                // Add count for origin node.
                context.getCurEntry().getOriginNode().increaseThreadNum();
            }

            if (resourceWrapper.getEntryType() == EntryType.IN) {
                // Add count for global inbound entry node for global statistics.
                Constants.ENTRY_NODE.increaseThreadNum();
            }
            // Handle pass event with registered entry callback handlers.
            for (ProcessorSlotEntryCallback<DefaultNode> handler : StatisticSlotCallbackRegistry.getEntryCallbacks()) {
                handler.onPass(context, resourceWrapper, node, count, args);
            }
        } catch (BlockException e) {
            // Blocked, set block exception to current entry.
            context.getCurEntry().setBlockError(e);

            // Add block count.
            node.increaseBlockQps(count);
            if (context.getCurEntry().getOriginNode() != null) {
                context.getCurEntry().getOriginNode().increaseBlockQps(count);
            }

            if (resourceWrapper.getEntryType() == EntryType.IN) {
                // Add count for global inbound entry node for global statistics.
                Constants.ENTRY_NODE.increaseBlockQps(count);
            }

            // Handle block event with registered entry callback handlers.
            for (ProcessorSlotEntryCallback<DefaultNode> handler : StatisticSlotCallbackRegistry.getEntryCallbacks()) {
                handler.onBlocked(e, context, resourceWrapper, node, count, args);
            }

            throw e;
        } catch (Throwable e) {
            // Unexpected internal error, set error to current entry.
            context.getCurEntry().setError(e);

            throw e;
        }
    }
```

第一步先调用了 fireEntry，让后面的 slot 先执行，这样会把整个链跑完，也把实际的方法也执行完，再执行后面的统计。如果后面的方法都正常跑完了，就做累加操作：
- 累加线程数：这里没有用比较常用的 Atomic 类做累加，而是用了另一个高性能数据结构 LongAdder
- 累加通过的请求数：使用了高性能的滑动窗口 LeapArray

#### LongAdder

LongAdder 是什么？

LongAdder 是 Java 8 引入的一个高性能计数器，属于 java.util.concurrent.atomic 包。与 AtomicLong 不同的是：
- AtomicLong.incrementAndGet() 每次更新都涉及 CAS（Compare-And-Swap）操作，在高并发下容易出现性能瓶颈（大量线程竞争同一个变量）
- LongAdder 采用 分段计数（cell 分片）：
  - 把计数器分成多个独立的槽（cells），多个线程并发时命中不同槽
  - 最终统计时通过求和所有槽的值来得到总值

为什么 Sentinel 使用 LongAdder？
- 在 Sentinel 中，比如统计资源访问的 QPS、异常次数、通过次数、阻止次数等指标，使用频率极高，且是热点操作。Sentinel 设计目标是对性能要求极高，要能承受每秒数万甚至百万级别请求，而 AtomicLong 在高 QPS 场景下并不适合用于统计指标
- 虽然 LongAdder.sum() 并不是强一致操作，但 Sentinel 不是交易系统，不要求绝对精确值，属于完全可接受的误差范围

再看请求数累加，StatisticNode 存储了三种类型的实时统计数据指标：
- 秒级指标：一秒拆分出两个滑动窗口，LeapArray 实现
- 分钟级指标：一分钟拆分出 60 个滑动窗口，即一秒一个窗口，LeapArray 实现
- 线程数：LongAdder 累加

#### 滑动窗口

为什么限流要使用滑动窗口？不妨先看一种最简单的固定窗口算法

(![固定窗口](https://raw.githubusercontent.com/chenyukang1/pic/pic/img/image-1.png)

每个窗口都有一个计数器（counter）用于统计流量，如果 counter + 本次申请的请求数 > 预设的 QPS，则拒绝请求

固定窗口很简单，但是也有很大的问题

![固定窗口](https://raw.githubusercontent.com/chenyukang1/pic/pic/img/image-2.png)

假设我们规定 QPS 不能超过 100，如上图所示 r1 和 r2 两个时间点分别来了 60 个请求， QPS 已经大于 100 了。此时应该触发限流了，但是固定窗口算法傻傻的只关注自己窗口的流量，感知不到 QPS 已经超了

滑动窗口算法

![滑动窗口](https://raw.githubusercontent.com/chenyukang1/pic/pic/img/image-3.png)

该算法将单位时间切成了多个窗口，每次计算 QPS 时，计算 当前窗口 + 过去几个窗口 的流量总和，这样就避免了固定窗口的问题 （具体使用几个窗口，取决于窗口大小和单位时间大小。例如上图，每个窗口大小为 500 ms，以 1 s 为单位时间做限流，每次使用 current + last 即可）

Sentinel 的限流思路就是滑动窗口，首先根据当前时间戳，找到对应的几个 window，根据 所有 window 中的流量总和 + 当前申请的流量数 决定能否通过。LeapArray 的实现较复杂，感兴趣可以自己研究，这里不再详述

### FlowSlot

这个 slot 主要根据预设的资源的统计信息，按照固定的次序，依次生效。如果一个资源对应两条或者多条流控规则，则会根据如下次序依次检验，直到全部通过或者有一个规则生效为止:
- 指定应用生效的规则，即针对调用方限流的
- 调用方为 other 的规则
- 调用方为 default 的规则

## 参考

https://sentinelguard.io/zh-cn/docs/basic-api-resource-rule.html
https://zhuanlan.zhihu.com/p/383064126