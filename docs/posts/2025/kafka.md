## Kafka Consumer

基本消费循环
```java
while (running) {
  ConsumerRecords<K, V> records = consumer.poll(Long.MAX_VALUE);
  process(records); // application-specific processing
  consumer.commitSync();
}
```
### poll 请求做了什么

在 Java consumer 中没有后台线程，`poll()`API 驱动所有 I/O：
- 加入消费组然后重平衡
- 周期发送心跳
- 周期提交位点（如果打开 autocommit）
- 对被分配的分区发送和接收 fetch 请求

单线程模型是被故意设计的，因此所有 I/O 都发生在调用`poll()`的线程中
因为单线程模型，当线程在处理`poll()`请求中的记录时，是不能发送心跳的。这意味着如果循环终止或者记录处理有延迟，导致下次迭代前会话超时，都会让当前消费者退出消费组
由于位点提交在`poll()`中处理，因此永远不会提交未经处理的消息偏移，保证了“at least once”语意

max.poll.records 配置了每次`poll()`返回记录数的上限，需要和`poll()`的 timeout 参数结合使用
### 推和拉两种模式怎么实现

Kafka 只支持主动拉，拉模型更适合高并发、多消费组

### spring 如何封装推和拉两种模式

### 最佳实践

- 在完成使用 consumer 的时候，必须总是主动调用`close()`
	- 保证 socket 关闭，然后清理内部状态
	- 立即触发消费组重平衡，保证原先分配给 consumer 的分区重新分配给其他消费者。否则 broker 要等到心跳超时后触发重平衡
- 最简单和最可靠的手动提交位点的方式就是使用同步提交`commitSync()`，这个方法会阻塞直到成功提交
- 保证心跳不超时
	- 第一种方式是保证消费线程有足够的时间消费消息。调整session.timeout.ms，保证这次循环到下次循环处理完这批消息不会心跳超时；考虑订阅的 topic 有多少分区，调整max.partition.fetch.bytes限制一批消息的数量
	- 第二种方式是使用另一个线程消费，然后做流量控制保证消费速度跟得上。例如，把消息放入阻塞队列，除非消费速度跟得上投递速度（这种情况用不着另一个线程），否则会阻塞
### 参考
https://docs.confluent.io/kafka-clients/java/current/overview.html#basic-usage