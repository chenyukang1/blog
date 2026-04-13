## 图论

## 属性图

### 标签 label

在节点上添加标签，就表示该节点属于图中的一个节点子集。 标签在 Neo4j 中非常重要，因为它们为 Cypher 语句提供了一个起点

![Nodes with labels](https://graphacademy.neo4j.com/courses/neo4j-fundamentals/2-property-graphs/1-property-graph/images/node-labels.jpg)

### 属性 properties

属性是键、值对，可根据需要从节点中添加或删除。 属性值可以是单个值，也可以是符合 Cypher 类型系统的值列表

![Nodes with properties](https://graphacademy.neo4j.com/courses/neo4j-fundamentals/2-property-graphs/1-property-graph/images/node-properties.jpg)

### 关系方向 relationship direction

在 Neo4j 中，每个关系在图中都必须有一个方向。 虽然这个方向是必须的，但关系可以在任何一个方向上查询，也可以在查询时完全忽略

### 关系类型 relationship type

neo4j 图形中的每个关系都必须有一个类型。 这样，我们就可以在查询时选择要遍历图的哪一部分

### 关系属性 relationship properties

与节点一样，关系也可以具有属性。 这些属性可以是加权图中的成本或距离，也可以只是为关系提供额外的上下文

## Neo4j 的优势

- Neo4j 是一个原生图数据库，这意味着从数据存储到查询语言的所有设计都考虑到了遍历

- 与其他企业 DBMS 一样，Neo4j 也符合 ACID 标准。 事务中的一组修改要么全部提交，要么全部失败

- 免索引邻接

### 免索引邻接

![RelationalTable1](https://graphacademy.neo4j.com/courses/neo4j-fundamentals/2-property-graphs/2-native-graph/images/RelationalTable1.png)

假如在关系数据库中执行这个查询

```SQL
SELECT PARENT_ID
FROM GROUPS
WHERE ID = (SELECT PARENT_ID
    FROM GROUPS
    WHERE ID = (SELECT PARENT_ID
        FROM GROUPS
        WHERE ID = 3))
```

SQL Server 需要做：

1. 找到最内层子句

2. 为该子句创建执行计划

3. 执行该子句的执行计划

4. 找到下一个最内层的子句

5. 重复步骤2-4

导致：

- 3次计划周期

- 3次索引查找

- 3次数据库读取

#### Neo4j 存储

通过免索引邻接，Neo4j 将节点和关系存储为通过指针相互链接的对象

概念图：

![IFA-1-new](https://graphacademy.neo4j.com/courses/neo4j-fundamentals/2-property-graphs/2-native-graph/images/IFA-1-new.png)

节点和关系存储：

![IFA-2-new](https://graphacademy.neo4j.com/courses/neo4j-fundamentals/2-property-graphs/2-native-graph/images/IFA-2-new.png)

#### Neo4j 检索

```cypher
MATCH (n) <-- (:Group) <-- (:Group) <-- (:Group {id: 3})
RETURN n.id
```

使用 IFA，Neo4j 图形引擎从查询的锚点（id 为 3 的 Group 节点）开始。然后它使用存储在关系和节点对象中的链接来遍历图形模式

![IFA-3-new](https://graphacademy.neo4j.com/courses/neo4j-fundamentals/2-property-graphs/2-native-graph/images/IFA-3-new.png)

要执行此查询，Neo4j 图形引擎需要：

1. 根据指定的锚点规划查询

2. 使用索引来检索锚节点

3. 跟随指针检索所需的结果节点

与关系 DBMS 访问相比，IFA 的优点是：

- 更少的索引查找

- 没有表扫描

- 减少数据的重复

## Cypher

Cypher 是一种专为图形设计的查询语言

- 节点用括号`（）`表示

- 我们用冒号表示标签，例如`（:Person）`

- 节点之间的关系用两个破折号表示，例如`（:Person）--（:Movie）`

- 关系的方向用大于或小于符号 < 或 > 表示，例如` (:Person)-→(:Movie) `

- 关系的类型用两个破折号之间的方括号表示，例如`[:ACTED_IN]`。

- 节点的属性是用类似 JSON 的语法指定的，Neo4j 中的属性是键/值对，例如 `{name: 'Tom Hanks'}`

一个典型的 cypher 模式：

```cypher
(m:Movie {title: 'Cloud Atlas'})<-[:ACTED_IN]-(p:Person)
```

### 读数据

- 从图中检索节点
  
  - 根据标签检索
  
  - 根据属性值检索

- 根据图的模式匹配检索节点和关系

- 过滤查询结果

### 写数据

- 使用 MERGE 在图表中创建节点

- 使用 MERGE 在图表中创建关系

- 为图表中的节点和关系创建、更新和删除属性

- 根据图表中的内容执行有条件的 MERGE 处理

- 从图表中删除节点和关系

## 特性

### 不存在空值

在 Neo4j 中，由于没有表模式或类似的机制来限制可能的属性，因此节点和关系属性的“不存在”和“空”是等价的。也就是说，实际上不存在具有空值的属性；空表示该属性根本不存在

## 参考

https://graphacademy.neo4j.com/courses/neo4j-fundamentals

## 实战

Cypher 语句：
```cypher
UNWIND $rows AS row
MERGE (a:Person {id: row.id})
MERGE (b:Company {name: row.company})
MERGE (a)-[:WORKS_AT {since: row.since}]->(b)
```

**UNWIND 批量插入慢的原因**

- 一条语句可以插入两点一边，之前的做法是先插入所有点，然后条件语句 MATCH 后插入所有边，多了匹配的操作

- 关系复杂/有关系属性，**每一行可能触发多个 MERGE**，还带属性写入

- `MERGE` 性能远低于 `CREATE`，尤其在属性上没有索引时
	- `MERGE` 会先扫描图 → 匹配 → 找不到再创建
	- 对 1000 条数据做 2 个 MERGE 实际上等同于 2000 次读 + 写
	- 如果能确保数据唯一性，考虑用 `CREATE` 提高性能

- 使用 `MERGE` 却没配索引，就会触发全图扫描