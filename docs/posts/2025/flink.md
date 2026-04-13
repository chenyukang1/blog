## Flink 分层 API

![[外链图片转存失败,源站可能有防盗链机制,建议将图片保存下来直接上传(img-sD2aHoNE-1612775779487)(/Users/bytedance/Desktop/nJou61.jpg)]](https://ask.qcloudimg.com/http-save/yehe-8223537/277f03f3973da7ca43db8391215576b2.jpg)

- ProcessFunction：可以处理一或两条输入数据流中的单个事件或者归入一个特定窗口内的多个事件。它提供了对于时间和状态的细粒度控制。开发者可以在其中任意地修改状态，也能够注册定时器用以在未来的某一时刻触发回调函数。因此，你可以利用 ProcessFunction 实现许多有状态的事件驱动应用所需要的基于单个事件的复杂业务逻辑

- DataStream API：为许多通用的流处理操作提供了处理原语。这些操作包括窗口、逐条记录的转换操作，在处理事件时进行外部数据库查询等。DataStream API 支持 Java 和 Scala 语言，预先定义了例如 map()、reduce()、aggregate() 等函数。你可以通过扩展实现预定义接口或使用 Java、Scala 的 lambda 表达式实现自定义的函数

- SQL & Table API：Flink 支持两种关系型的 API，Table API 和 SQL。这两个 API 都是批处理和流处理统一的 API，这意味着在无边界的实时数据流和有边界的历史记录数据流上，关系型 API 会以相同的语义执行查询，并产生相同的结果。Table API和SQL借助了 Apache Calcite来进行查询的解析，校验以及优化。它们可以与DataStream和DataSet API无缝集成，并支持用户自定义的标量函数，聚合函数以及表值函数。Flink 的关系型 API 旨在简化数据分析、数据流水线和 ETL 应用的定义

## 流处理

![Program Dataflow](https://nightlies.apache.org/flink/flink-docs-release-1.20/fig/learn-flink/program_dataflow.svg)

## 流执行环境

在应用程序中进行的数据流API调用构建了一个附加到StreamExecutionEnvironment的作业图。当调用env.execute()时，此图被打包并发送到JobManager, JobManager将作业并行化，并将其切片分发给任务管理器执行。作业的每个并行切片将在一个任务槽中执行

![Flink runtime: client, job manager, task managers](https://nightlies.apache.org/flink/flink-docs-release-1.20/fig/distributed-runtime.svg)

## 流式分析

### Event Time

对于一台机器而言，“时间”自然就是指系统时间。但我们知道，Flink 是一个分布式处理系统。分布式架构最大的特点，就是节点彼此独立、互不影响，这带来了更高的吞吐量和容错性；但有利必有弊，最大的问题也来源于此

在分布式系统中，节点“各自为政”，是没有统一时钟的，数据和控制信息都通过网络进行传输。比如现在有一个任务是窗口聚合，我们希望将每个小时的数据收集起来进行统计处理。而对于并行的窗口子任务，它们所在节点不同，系统时间也会有差异；当我们希望统计 8 点 ~ 9 点的数据时，对并行任务来说其实并不是“同时”的，收集到的数据也会有误差。那既然一个集群中有 JobManager 作为管理者，是不是让它统一向所有 TaskManager 发送同步时钟信号就行了呢？这也是不行的。因为网络传输会有延迟，而且这延迟是不确定的，所以 JobManager 发出的同步信号无法同时到达所有节点。**想要拥有一个全局统一的时钟，在分布式系统里是做不到的**

另一个麻烦的问题是，在流式处理的过程中，数据是在不同的节点间不停流动的，这同样
也会有网络传输的延迟。这样一来，当上下游任务需要跨节点传输数据时，它们对于“时间”的理解也会有所不同。例如，上游任务在 8 点 59 分 59 秒发出一条数据，到下游要做窗口计算时已经是 9 点零 1 秒了，那这条数据到底该不该被收到 8 点 ~ 9 点的窗口呢？所以，当我们希望对数据按照时间窗口来进行收集计算时，“时间”到底以谁为标准就非常重要了

我们重新梳理一下流式数据处理的过程。在事件发生之后，生成的数据被收集起来，首先进入分布式消息队列，然后被 Flink 系统中的 Source 算子读取消费，进而向下游的转换算子（窗口算子）传递，最终由窗口算子进行计算处理

很明显，这里有两个非常重要的时间点：一个是数据产生的时间，我们把它叫作“事件时间”（Event Time）；另一个是数据真正被处理的时刻，叫作“处理时间”（Processing Time）

Flink 明确支持三种不同的时间概念:

- event time 事件时间：由产生(或存储)该事件的设备所记录的事件发生的时间

- ingestion time 摄取时间：Flink 在摄取事件时记录的时间戳

- processing time 处理时间：管道中特定操作符处理事件的时间

### Watermark

**我们应该把时钟也以数据的形式传递出去**，告诉下游任务当前时间的进展；而且这个时钟的传递不会因为窗口聚合之类的运算而停滞。一种简单的想法是，在数据流中加入一个时钟标记，记录当前的事件时间；这个标记可以直接广播到下游，当下游任务收到这个标记，就可以更新自己的时钟了。由于类似于水流中用来做标志的记号，在 Flink 中，这种用来衡量事件时间（Event Time）进展的标记，就被称作“水位线”（Watermark）

具体实现上，水位线可以看作一条特殊的数据记录，它是插入到数据流中的一个标记点，主要内容就是一个时间戳，用来指示当前的事件时间。而它插入流中的位置，就应该是在某个数据到来之后；这样就可以从这个数据中提取时间戳，作为当前水位线的时间戳了

![73d8c9be8b2a4960a39693770de0ac9a.png](https://ucc.alicdn.com/pic/developer-ecology/s6u6iclhbos2i_0bd8a42caea641e4a611fdc63e4950e9.png?x-oss-process=image%2Fresize%2Cw_1400%2Fformat%2Cwebp)

- WaterMarks 水位：定义何时停止等待更早的事件

Flink 中的事件时间处理取决于 watermark 生成器，这些 watermark 生成器将带有时间戳的特殊元素插入到流中，称为 watermark。时间 t 的 watermark 表示流现在（可能）在时间 t 之前完成

当 Flink 中的运算符接收到 watermark 时，它明白早于该时间的消息已经完全抵达计算引擎，即假设不会再有时间小于水位线的事件到达。这个假设是触发窗口计算的基础，**只有水位线越过窗口对应的结束时间，窗口才会关闭和进行计算**

### Window

对于 Flink，如果来一条消息计算一条，这样是可以的，但是这样计算是非常频繁而且消耗资源，如果想做一些统计这是不可能的。所以对于 Spark 和 Flink 都产生了窗口计算。比如我们想看到过去一分钟、过去半小时的访问数据，这时候我们就需要窗口

**window**：window 是处理无界流的关键，window 将流拆分为一个个有限大小的`bucket`，可以在每一个`bucket`中进行计算

**start_time, end_time**：每个 window 都会有一个前开后闭的开始时间和结束时间，这个时间是系统时间

窗口有如下组件：

**Window Assigner**：窗口分配器用来决定某个元素被分配到哪个/哪些窗口中去

**Trigger**：触发器，决定了一个窗口何时能够被计算或清除。触发策略可能类似于“当窗口中的元素数量大于4”时，或“当水位线通过窗口结束时”

**Evictor**：它可以在 触发器触发后 & 应用函数之前和/或之后从窗口中删除元素

#### 窗口生命周期

只要属于此窗口的第一个元素到达，就会创建一个窗口，当时间（事件或处理时间）超过其结束时间戳加上用户指定的允许延迟时，窗口将被完全删除

> ```java
> 使用基于事件时间的窗口策略，每5分钟创建一个不重叠（或翻滚）的窗口并允许延迟1分钟。假定目前是12:00。
> 
> 当具有落入该间隔的时间戳的第一个元素到达时，Flink将为12:00到12:05之间的间隔创建一个新窗口，当水位线（watermark）到12:06时间戳时将删除它
> ```

使用 Flink 计算窗口分析取决于两个主要抽象：

- 将事件分配给窗口（根据需要创建新的窗口对象）的窗口分配器

- 应用于分配给窗口的事件的窗口函数

#### 窗口分配器

![Window assigners](https://nightlies.apache.org/flink/flink-docs-release-1.20/fig/window-assigners.svg)

- Tumbling time windows 滚动时间窗口
  每分钟页面浏览量
  
  `TumblingEventTimeWindows.of(Time.minutes(1))`

- Sliding time windows 滑动时间窗口
  每10秒计算一次每分钟页面浏览量
  `SlidingEventTimeWindows.of(Time.minutes(1), Time.seconds(10))`

- Session windows
  每次会话的页面浏览量，每次会话之间至少间隔 30 分钟`EventTimeSessionWindows.withGap(Time.minutes(30))`

#### 窗口函数

- ProcessWindowFunction：批量调用，ProcessWindowFunction 将传递一个包含窗口内容的 Iterable

- ReduceFunction/AggregateFunction：增量调用 ReduceFunction 或 AggregateFunction，ReduceFunction 或 AggregateFunction 在每个事件分配给窗口时都会被调用

- 两者结合：结合使用这两种方法，即在窗口被触发时，将 ReduceFunction 或 AggregateFunction 的预汇总结果提供给 ProcessWindowFunction

## 实战

### 创建Flink工程

```bash
mvn archetype:generate \
    -DarchetypeGroupId=org.apache.flink \
    -DarchetypeArtifactId=flink-quickstart-java \
    -DarchetypeVersion=1.6.1 \
    -DgroupId=my-flink-project \
    -DartifactId=my-flink-project \
    -Dversion=0.1 \
    -Dpackage=com.cyk.flink \
    -DinteractiveMode=false
```

### 跑Flink任务

```bash
flink run -c com.cyk.flink.SocketTextStreamWordCount /Users/user/IdeaProjects/my-flink-project/target/my-flink-project-0.1.jar
```
